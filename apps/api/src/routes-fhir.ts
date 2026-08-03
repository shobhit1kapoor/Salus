import type { FastifyInstance } from "fastify";
import { fhirBundleSchema } from "@salus/contracts";
import { z } from "zod";
import { audit, withUser } from "./db.js";
import { requirePatientRole, requireUser } from "./request.js";
import { can } from "@salus/security";
import { activePurposeGrant, privacyTraceId, protectText, recordProtectionReceipt, unprotectText } from "./privacy.js";
import { hasRecentMfa } from "./auth.js";

const paramsSchema = z.object({ patientId: z.string().uuid() });

export async function fhirRoutes(app: FastifyInstance) {
  app.get("/v1/patients/:patientId/fhir", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = paramsSchema.parse(request.params);
    const query = z.object({ purpose: z.enum(["records_administration", "emergency_support"]), reason: z.string().min(8).max(500) }).parse(request.query);
    const traceId = privacyTraceId();
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await activePurposeGrant(db, patientId, query.purpose, "export")) return reply.code(403).send({ code: "PURPOSE_NOT_AUTHORIZED" });
      if (!await hasRecentMfa(request)) return reply.code(403).send({ code: "RECENT_MFA_REQUIRED", message: "FHIR export requires recent MFA." });
      const patient = (await db.query<{ preferred_name_protected: string | null; date_of_birth_protected: string | null }>("SELECT preferred_name_protected,date_of_birth_protected FROM patients WHERE id=$1", [patientId])).rows[0];
      if (!patient?.preferred_name_protected) return reply.code(409).send({ code: "PROTECTED_PROFILE_UNAVAILABLE" });
      const profile = {
        preferredName: await unprotectText(patient.preferred_name_protected, traceId, query.purpose),
        dateOfBirth: patient.date_of_birth_protected ? await unprotectText(patient.date_of_birth_protected, traceId, query.purpose) : undefined
      };
      const medications = await db.query<{ id: string; name: string; dosage: string; route: string; status: string }>("SELECT id,name,dosage,route,status FROM medications WHERE patient_id=$1", [patientId]);
      const appointments = await db.query<{ id: string; starts_at: Date; status: string; reason: string | null }>("SELECT id,starts_at,status,reason FROM appointments WHERE patient_id=$1", [patientId]);
      const bundle = {
        resourceType: "Bundle", type: "collection", timestamp: new Date().toISOString(),
        entry: [
          { fullUrl: `urn:uuid:${patientId}`, resource: { resourceType: "Patient", id: patientId, name: [{ use: "usual", text: profile.preferredName }], birthDate: profile.dateOfBirth } },
          ...medications.rows.map((m) => ({ fullUrl: `urn:uuid:${m.id}`, resource: { resourceType: "MedicationStatement", id: m.id, status: m.status === "verified" ? "active" : "unknown", subject: { reference: `Patient/${patientId}` }, medicationCodeableConcept: { text: m.name }, dosage: [{ text: `${m.dosage}, ${m.route}` }] } })),
          ...appointments.rows.map((a) => ({ fullUrl: `urn:uuid:${a.id}`, resource: { resourceType: "Appointment", id: a.id, status: a.status === "scheduled" ? "booked" : "cancelled", start: a.starts_at.toISOString(), description: a.reason ?? undefined, participant: [{ actor: { reference: `Patient/${patientId}` }, status: "accepted" }] } }))
        ]
      };
      const protectedReason = await protectText(query.reason, traceId, query.purpose);
      await db.query("INSERT INTO reveal_events(patient_id,actor_id,resource_type,fields,purpose,reason_protected,decision,trace_id) VALUES($1,$2,'fhir_export',ARRAY['profile','medications','appointments'],$3,$4,'allowed',$5)", [patientId, user.id, query.purpose, protectedReason.canonicalProtected, traceId]);
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "fhir.export", purpose: query.purpose, status: "revealed", stages: [{ stage: "authorize", outcome: "passed", detail: "purpose, export scope, and recent MFA" }, { stage: "reveal", outcome: "passed", detail: "explicit FHIR export" }, { stage: "egress", outcome: "passed", detail: "no-store response" }] });
      reply.header("Cache-Control", "no-store, private, max-age=0").header("Pragma", "no-cache");
      return bundle;
    });
  });

  app.post("/v1/patients/:patientId/fhir/validate", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = paramsSchema.parse(request.params); const bundle = fhirBundleSchema.parse(request.body);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      const supported = new Set(["Patient", "RelatedPerson", "CarePlan", "Condition", "AllergyIntolerance", "MedicationStatement", "MedicationRequest", "Observation", "Appointment", "Practitioner", "Organization", "DocumentReference", "Task", "Consent"]);
      const issues = bundle.entry.flatMap((entry, index) => supported.has(entry.resource.resourceType) ? [] : [{ severity: "error", expression: `Bundle.entry[${index}]`, diagnostics: `Unsupported resource ${entry.resource.resourceType}` }]);
      return { resourceType: "OperationOutcome", issue: issues.length ? issues : [{ severity: "information", code: "informational", diagnostics: "Bundle structure and supported resource types are valid for Salus preview." }] };
    });
  });

  app.post("/v1/patients/:patientId/fhir/import", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = paramsSchema.parse(request.params);
    const { mode } = z.object({ mode: z.enum(["preview", "apply"]).default("preview") }).parse(request.query);
    const bundle = fhirBundleSchema.parse(request.body);
    const traceId = privacyTraceId();
    const protectedBundle = await protectText(JSON.stringify(bundle), traceId, "records_administration");
    const safeBundle = fhirBundleSchema.parse(JSON.parse(protectedBundle.aiSafeText));
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await activePurposeGrant(db, patientId, "records_administration", "documents")) return reply.code(403).send({ code: "PURPOSE_NOT_AUTHORIZED" });
      const supported = new Set(["Patient", "MedicationStatement", "MedicationRequest", "Observation", "Appointment", "Task", "Consent"]);
      const issues: Array<{ severity: "error" | "warning"; expression: string; diagnostics: string }> = [];
      const resources = safeBundle.entry.map((entry) => entry.resource as Record<string, unknown>);
      resources.forEach((resource, index) => {
        const type = String(resource.resourceType ?? "");
        if (!supported.has(type)) issues.push({ severity: "warning", expression: `Bundle.entry[${index}]`, diagnostics: `Resource ${type || "unknown"} will be skipped.` });
        if (type === "Patient" && resource.id && resource.id !== patientId) issues.push({ severity: "error", expression: `Bundle.entry[${index}].resource.id`, diagnostics: "FHIR Patient id does not match the authorized Salus patient." });
        const reference = ((resource.subject ?? resource.patient) as { reference?: unknown } | undefined)?.reference;
        if (typeof reference === "string" && ![patientId, `Patient/${patientId}`, `urn:uuid:${patientId}`].includes(reference)) issues.push({ severity: "error", expression: `Bundle.entry[${index}].resource.subject`, diagnostics: "Resource references a different patient." });
      });
      const counts = Object.fromEntries([...supported].map((type) => [type, resources.filter((resource) => resource.resourceType === type).length]));
      if (mode === "preview") {
        await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "fhir.preview", purpose: "records_administration", status: "protected", provider: protectedBundle.provider, entityCounts: protectedBundle.entityCounts, stages: [{ stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed" }, { stage: "egress", outcome: "passed", detail: "counts and validation issues only" }] });
        return { mode, counts, issues, canApply: !issues.some((issue) => issue.severity === "error"), protectionTraceId: traceId };
      }
      if (issues.some((issue) => issue.severity === "error")) return reply.code(400).send({ code: "FHIR_PATIENT_MISMATCH", issues });
      await db.query("INSERT INTO fhir_exchanges(patient_id,direction,canonical_protected,resource_counts,trace_id,created_by) VALUES($1,'import',$2,$3,$4,$5)", [patientId, protectedBundle.canonicalProtected, JSON.stringify(counts), traceId, user.id]);
      const applied = { observations: 0, medications: 0, appointments: 0, tasks: 0, consents: 0 };
      for (const resource of resources) {
        const type = String(resource.resourceType);
        if (type === "Observation") {
          const code = ((resource.code as { text?: unknown } | undefined)?.text ?? "FHIR observation").toString();
          const value = resource.valueString ?? (resource.valueQuantity as { value?: unknown; unit?: unknown } | undefined)?.value;
          const unit = (resource.valueQuantity as { unit?: unknown } | undefined)?.unit;
          const summary = `${code}: ${value ?? "recorded"}${unit ? ` ${unit}` : ""}`.slice(0, 4000);
          const occurredAt = typeof resource.effectiveDateTime === "string" ? resource.effectiveDateTime : typeof resource.issued === "string" ? resource.issued : new Date().toISOString();
          await db.query("INSERT INTO timeline_events(patient_id,occurred_at,category,summary,source,created_by) VALUES($1,$2,'note',$3,'document',$4)", [patientId, occurredAt, summary, user.id]); applied.observations += 1;
        }
        if (type === "MedicationStatement" || type === "MedicationRequest") {
          const medication = resource.medicationCodeableConcept as { text?: unknown } | undefined; const dosage = Array.isArray(resource.dosage) ? resource.dosage[0] as { text?: unknown } : undefined;
          const name = String(medication?.text ?? "Imported medication").slice(0, 160); const dosageText = String(dosage?.text ?? "Review imported dosage").slice(0, 120);
          await db.query("INSERT INTO medications(patient_id,name,normalized_name,dosage,route,schedule,instructions,status,created_by) VALUES($1,$2,$3,$4,'Review required','Imported from FHIR','Imported as a proposal; caregiver verification required.','proposed',$5)", [patientId, name, name.toLocaleLowerCase(), dosageText, user.id]); applied.medications += 1;
        }
        if (type === "Appointment" && typeof resource.start === "string") {
          await db.query("INSERT INTO appointments(patient_id,starts_at,reason,status,created_by) VALUES($1,$2,$3,'scheduled',$4)", [patientId, resource.start, String(resource.description ?? "FHIR appointment").slice(0, 1000), user.id]); applied.appointments += 1;
        }
        if (type === "Task") {
          const description = String(resource.description ?? (resource.code as { text?: unknown } | undefined)?.text ?? "FHIR task").slice(0, 280);
          const dueAt = ((resource.restriction as { period?: { end?: unknown } } | undefined)?.period?.end); await db.query("INSERT INTO tasks(patient_id,title,due_at,assigned_to,created_by) VALUES($1,$2,$3,$4,$4)", [patientId, description, typeof dueAt === "string" ? dueAt : null, user.id]); applied.tasks += 1;
        }
        if (type === "Consent") {
          const status = resource.status === "inactive" || resource.status === "rejected" ? "revoked" : "granted";
          await db.query("INSERT INTO consent_records(patient_id,consent_type,status,recorded_by,evidence) VALUES($1,'FHIR import',$2,$3,$4)", [patientId, status, user.id, `FHIR Consent/${String(resource.id ?? "unknown")}`]); applied.consents += 1;
        }
      }
      await audit(db, user.id, "fhir.imported", "fhir_bundle", undefined, patientId, { applied, warningCount: issues.length });
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "fhir.import", purpose: "records_administration", status: "protected", provider: protectedBundle.provider, entityCounts: protectedBundle.entityCounts, stages: [{ stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed" }, { stage: "persist", outcome: "passed", detail: "AI-safe resource views only" }, { stage: "egress", outcome: "passed" }] });
      return { mode, applied, issues, protectionTraceId: traceId };
    });
  });
}
