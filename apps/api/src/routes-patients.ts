import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { carePurposeSchema, chatMessageSchema, createTaskSchema, createTimelineEventSchema, documentAppointmentFactSchema, documentMedicationFactSchema, documentTaskFactSchema, documentTimelineFactSchema, medicationSchema, type CaregiverRole, type CarePurpose, type CareScope, type ProtectionStage } from "@salus/contracts";
import { assessDiagnosisInstruction, assessEmergency, assessInstructionSafety, assessMedicationInstruction, can, safeStorageKey, unsupportedCurrentMeasurement, unsupportedNamedProtocol } from "@salus/security";
import { audit, one, withUser, type Db } from "./db.js";
import { requirePatientRole, requireUser } from "./request.js";
import { createGroundedReply, embed, ProviderUnavailableError } from "./ai.js";
import { deletePrivateObject, getPrivateObject, putPrivateObject } from "./storage.js";
import { enqueueDocument, enqueueVoice } from "./queue.js";
import { scanForMalware } from "./clamav.js";
import { hasRecentMfa, hashAuthToken } from "./auth.js";
import { env } from "./env.js";
import { sendMail } from "./mail.js";
import { activePurposeGrant, privacyTraceId, protectText, recordProtectionReceipt, scanGuardrail, unprotectText, validateEgress, PrivacyUnavailableError } from "./privacy.js";

const patientParams = z.object({ patientId: z.string().uuid() });
const allowedFiles = new Set(["application/pdf", "text/plain", "image/png", "image/jpeg", "audio/webm", "audio/wav", "audio/ogg", "audio/mpeg"]);

type ApprovedDocumentFact = { id: string; field: string; proposed_value: unknown };

function safeProtectedJson<T>(value: string): T {
  try { return JSON.parse(value) as T; }
  catch { throw new PrivacyUnavailableError("Protected structured content could not be validated."); }
}
function validateMaterializableFact(fact: ApprovedDocumentFact) {
  if (fact.field === "medication") return documentMedicationFactSchema.parse(fact.proposed_value);
  if (fact.field === "appointment") return documentAppointmentFactSchema.parse(fact.proposed_value);
  if (fact.field === "task") return documentTaskFactSchema.parse(fact.proposed_value);
  if (fact.field === "timeline_event") return documentTimelineFactSchema.parse(fact.proposed_value);
  return null;
}

async function requirePurposeScope(db: Db, reply: FastifyReply, patientId: string, purpose: CarePurpose, scope: CareScope) {
  if (await activePurposeGrant(db, patientId, purpose, scope)) return true;
  reply.code(403).send({ code: "PURPOSE_SCOPE_DENIED", purpose, scope });
  return false;
}

async function materializeDocumentFact(db: Db, fact: ApprovedDocumentFact, patientId: string, documentId: string, actorId: string, role: CaregiverRole) {
  const value = validateMaterializableFact(fact);
  if (!value) return null;
  let resource: { id: string; type: string };
  if (fact.field === "timeline_event") {
    const timeline = documentTimelineFactSchema.parse(value);
    const row = await one<{ id: string }>(db, `INSERT INTO timeline_events(patient_id,occurred_at,category,summary,source,created_by,source_document_id,source_fact_id)
      VALUES($1,$2,$3,$4,'document',$5,$6,$7) ON CONFLICT (source_fact_id) WHERE source_fact_id IS NOT NULL DO UPDATE SET summary=EXCLUDED.summary RETURNING id`, [patientId, timeline.occurredAt, timeline.category, timeline.summary, actorId, documentId, fact.id]);
    resource = { id: row!.id, type: "timeline_event" };
  } else if (fact.field === "appointment") {
    const appointment = documentAppointmentFactSchema.parse(value);
    const row = await one<{ id: string }>(db, `INSERT INTO appointments(patient_id,starts_at,provider_name,location,reason,created_by,source_document_id,source_fact_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (source_fact_id) WHERE source_fact_id IS NOT NULL DO UPDATE SET starts_at=EXCLUDED.starts_at,provider_name=EXCLUDED.provider_name,location=EXCLUDED.location,reason=EXCLUDED.reason RETURNING id`, [patientId, appointment.startsAt, appointment.providerName ?? null, appointment.location ?? null, appointment.reason ?? null, actorId, documentId, fact.id]);
    resource = { id: row!.id, type: "appointment" };
  } else if (fact.field === "task") {
    const task = documentTaskFactSchema.parse(value);
    const row = await one<{ id: string }>(db, `INSERT INTO tasks(patient_id,title,due_at,reminder_at,assigned_to,created_by,source_document_id,source_fact_id)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7) ON CONFLICT (source_fact_id) WHERE source_fact_id IS NOT NULL DO UPDATE SET title=EXCLUDED.title,due_at=EXCLUDED.due_at,reminder_at=EXCLUDED.reminder_at RETURNING id`, [patientId, task.title, task.dueAt ?? null, task.reminderAt ?? null, actorId, documentId, fact.id]);
    resource = { id: row!.id, type: "task" };
  } else {
    const medication = documentMedicationFactSchema.parse(value);
    const existing = await one<{ id: string; dosage: string; status: string }>(db, "SELECT id,dosage,status FROM medications WHERE patient_id=$1 AND normalized_name=lower($2) ORDER BY created_at DESC LIMIT 1", [patientId, medication.name]);
    if (existing && existing.dosage.toLocaleLowerCase() === medication.dosage.toLocaleLowerCase() && existing.status === "verified") {
      resource = { id: existing.id, type: "medication" };
    } else {
      const verifyMedication = can(role, "medication_verify") && !medication.conflict;
      const row = await one<{ id: string }>(db, `INSERT INTO medications(patient_id,name,normalized_name,dosage,route,schedule,instructions,status,verified_at,verified_by,created_by,source_document_id,source_fact_id)
        VALUES($1,$2,lower($2),$3,$4,$5,$6,$7,CASE WHEN $7='verified' THEN now() ELSE NULL END,CASE WHEN $7='verified' THEN $8::uuid ELSE NULL END,$8,$9,$10)
        ON CONFLICT (source_fact_id) WHERE source_fact_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name,dosage=EXCLUDED.dosage,route=EXCLUDED.route,schedule=EXCLUDED.schedule,instructions=EXCLUDED.instructions RETURNING id`, [patientId, medication.name, medication.dosage, medication.route, medication.schedule, medication.instructions ?? null, verifyMedication ? "verified" : "proposed", actorId, documentId, fact.id]);
      resource = { id: row!.id, type: "medication" };
    }
  }
  await db.query("UPDATE document_facts SET materialized_resource_type=$1,materialized_resource_id=$2 WHERE id=$3 AND patient_id=$4 AND document_id=$5", [resource.type, resource.id, fact.id, patientId, documentId]);
  return resource;
}

export async function patientRoutes(app: FastifyInstance) {
  app.get("/v1/push/config", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    return { enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY : undefined };
  });

  app.post("/v1/push/subscriptions", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return reply.code(503).send({ code: "PUSH_NOT_CONFIGURED" });
    const body = z.object({ endpoint: z.string().url().max(2048), keys: z.object({ p256dh: z.string().min(20).max(500), auth: z.string().min(8).max(200) }) }).parse(request.body);
    return withUser(user.id, async (db) => {
      const subscription = await one(db, `INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,revoked_at=NULL RETURNING id`, [user.id, body.endpoint, body.keys.p256dh, body.keys.auth]);
      await audit(db, user.id, "push_subscription.enabled", "push_subscription", (subscription as { id: string }).id);
      return reply.code(201).send({ enabled: true });
    });
  });

  app.delete("/v1/push/subscriptions", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(request.body);
    return withUser(user.id, async (db) => {
      const result = await db.query("UPDATE push_subscriptions SET revoked_at=now() WHERE user_id=$1 AND endpoint=$2 AND revoked_at IS NULL RETURNING id", [user.id, endpoint]);
      if (result.rows[0]) await audit(db, user.id, "push_subscription.disabled", "push_subscription", result.rows[0].id);
      return reply.code(204).send();
    });
  });

  app.get("/v1/notifications", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    return withUser(user.id, async (db) => (await db.query(`SELECT n.id,n.patient_id AS "patientId",n.task_id AS "taskId",'Care reminder'::text AS title,'Protected health profile'::text AS "patientName",n.status,n.attempted_at AS "createdAt",n.read_at AS "readAt" FROM notification_deliveries n WHERE n.recipient_id=$1 AND n.channel='in_app' ORDER BY n.attempted_at DESC LIMIT 100`, [user.id])).rows);
  });

  app.post("/v1/notifications/:notificationId/read", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { notificationId } = z.object({ notificationId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      const row = await one(db, `UPDATE notification_deliveries SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND recipient_id=$2 AND channel='in_app' RETURNING id,read_at AS "readAt"`, [notificationId, user.id]);
      return row ?? reply.code(404).send({ code: "NOTIFICATION_NOT_FOUND" });
    });
  });

  app.get("/v1/patients", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    return withUser(user.id, async (db) => {
      const result = await db.query(`SELECT p.id,p.preferred_name AS "preferredName",p.date_of_birth AS "dateOfBirth",p.pronouns,p.language,p.timezone,m.role,p.archived_at AS "archivedAt"
        FROM patients p JOIN patient_members m ON m.patient_id=p.id AND m.user_id=$1 AND m.revoked_at IS NULL WHERE p.deleted_at IS NULL ORDER BY p.preferred_name`, [user.id]);
      return result.rows;
    });
  });

  app.post("/v1/patients", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    return reply.code(410).send({ code: "USE_HEALTH_PROFILES", message: "Create a privacy-first health profile through POST /v1/profiles." });
  });

  app.get("/v1/patients/:patientId/dashboard", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    const { purpose } = z.object({ purpose: carePurposeSchema.default("daily_care") }).parse(request.query);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId);
      if (!role) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, purpose, "profile")) return;
      const [canReadTimeline, canReadMedications, canReadFollowUps] = await Promise.all([
        activePurposeGrant(db, patientId, purpose, "timeline"),
        activePurposeGrant(db, patientId, purpose, "medications"),
        activePurposeGrant(db, patientId, purpose, "follow_ups")
      ]);
      const patient = await one(db, `SELECT id,CASE WHEN profile_type='self' THEN 'My health' WHEN relationship IS NOT NULL THEN relationship||' health profile' ELSE 'Protected health profile' END AS "preferredName",NULL::date AS "dateOfBirth",NULL::text AS pronouns,language,timezone FROM patients WHERE id=$1 AND deleted_at IS NULL`, [patientId]);
      const [medications, appointments, tasks, timeline] = await Promise.all([
        canReadMedications ? db.query(`SELECT id,name,dosage,route,schedule,status FROM medications WHERE patient_id=$1 AND status IN ('verified','active','proposed') ORDER BY CASE WHEN status IN ('verified','active') THEN 0 ELSE 1 END,name`, [patientId]) : Promise.resolve({ rows: [] }),
        canReadFollowUps ? db.query(`SELECT id,starts_at AS "startsAt",provider_name AS "providerName",reason,status FROM appointments WHERE patient_id=$1 AND starts_at>=now()-interval '1 day' ORDER BY starts_at LIMIT 10`, [patientId]) : Promise.resolve({ rows: [] }),
        canReadFollowUps ? db.query(`SELECT id,title,due_at AS "dueAt",reminder_at AS "reminderAt",status FROM tasks WHERE patient_id=$1 AND status='open' ORDER BY due_at NULLS LAST LIMIT 20`, [patientId]) : Promise.resolve({ rows: [] }),
        canReadTimeline ? db.query(`SELECT id,occurred_at AS "occurredAt",category,summary,source FROM timeline_events WHERE patient_id=$1 AND superseded_at IS NULL ORDER BY occurred_at DESC LIMIT 12`, [patientId]) : Promise.resolve({ rows: [] })
      ]);
      const allowedScopes = [canReadTimeline && "timeline", canReadMedications && "medications", canReadFollowUps && "follow_ups"].filter(Boolean);
      return { patient: patient ? { ...patient, role } : patient, purpose, allowedScopes, medications: medications.rows, appointments: appointments.rows, tasks: tasks.rows, timeline: timeline.rows };
    });
  });

  app.post("/v1/patients/:patientId/timeline", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params); const body = createTimelineEventSchema.parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!can(role, "write")) return reply.code(403).send({ code: "FORBIDDEN" });
      if (!await requirePurposeScope(db, reply, patientId, "daily_care", "timeline")) return;
      const traceId = privacyTraceId(); const protectedSummary = await protectText(body.summary, traceId, "daily_care");
      const row = await one(db, `INSERT INTO timeline_events(patient_id,occurred_at,category,summary,summary_protected,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)
        RETURNING id,occurred_at AS "occurredAt",category,summary,source`, [patientId, body.occurredAt, body.category, protectedSummary.aiSafeText, protectedSummary.canonicalProtected, body.source, user.id]);
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "timeline.create", purpose: "daily_care", status: "protected", stages: [{ stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: protectedSummary.durationMs }], entityCounts: protectedSummary.entityCounts, provider: protectedSummary.provider });
      await audit(db, user.id, "timeline.created", "timeline_event", (row as { id: string }).id, patientId, { protectionTraceId: traceId });
      return reply.code(201).send(row);
    });
  });

  app.get("/v1/patients/:patientId/timeline", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    const query = z.object({ category: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(request.query);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "daily_care", "timeline")) return;
      const result = await db.query(`SELECT id,version_of AS "versionOf",occurred_at AS "occurredAt",category,summary,source,created_at AS "createdAt"
        FROM timeline_events WHERE patient_id=$1 AND superseded_at IS NULL AND ($2::text IS NULL OR category=$2)
        AND ($3::timestamptz IS NULL OR occurred_at >= $3) AND ($4::timestamptz IS NULL OR occurred_at <= $4) ORDER BY occurred_at DESC LIMIT 500`,
        [patientId, query.category ?? null, query.from ?? null, query.to ?? null]);
      return result.rows;
    });
  });

  app.post("/v1/patients/:patientId/medications", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params); const body = medicationSchema.parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "medication_support", "medications")) return;
      const traceId = privacyTraceId(); const protectedMedication = await protectText(JSON.stringify(body), traceId, "medication_support");
      const safe = safeProtectedJson<typeof body>(protectedMedication.aiSafeText);
      const row = await one(db, `INSERT INTO medications(patient_id,name,normalized_name,dosage,route,schedule,instructions,details_protected,created_by)
        VALUES($1,$2,lower($2),$3,$4,$5,$6,$7,$8) RETURNING id,name,dosage,route,schedule,status`, [patientId, safe.name, safe.dosage, safe.route, safe.schedule, safe.instructions ?? null, protectedMedication.canonicalProtected, user.id]);
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "medication.propose", purpose: "medication_support", status: "protected", stages: [{ stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: protectedMedication.durationMs }], entityCounts: protectedMedication.entityCounts, provider: protectedMedication.provider });
      await audit(db, user.id, "medication.proposed", "medication", (row as { id: string }).id, patientId, { protectionTraceId: traceId });
      return reply.code(201).send(row);
    });
  });

  app.post("/v1/patients/:patientId/medications/:medicationId/verify", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ medicationId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "medication_verify")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "medication_support", "medications")) return;
      const row = await one<{ id: string; status: string }>(db, `UPDATE medications SET status='verified',verified_at=now(),verified_by=$1 WHERE id=$2 AND patient_id=$3 AND status IN ('proposed','active') RETURNING id,status`, [user.id, params.medicationId, params.patientId]);
      if (!row) {
        const existing = await one<{ id: string; status: string }>(db, "SELECT id,status FROM medications WHERE id=$1 AND patient_id=$2", [params.medicationId, params.patientId]);
        if (existing?.status === "verified") return existing;
        return reply.code(409).send({ code: "NOT_PROPOSED" });
      }
      await audit(db, user.id, "medication.verified", "medication", params.medicationId, params.patientId);
      return row;
    });
  });

  app.post("/v1/patients/:patientId/appointments", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    const body = z.object({ startsAt: z.string().datetime(), providerName: z.string().max(160).optional(), location: z.string().max(300).optional(), reason: z.string().max(1000).optional() }).parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "appointment_preparation", "follow_ups")) return;
      const traceId = privacyTraceId(); const protectedAppointment = await protectText(JSON.stringify(body), traceId, "appointment_preparation");
      const safe = safeProtectedJson<typeof body>(protectedAppointment.aiSafeText);
      const row = await one(db, `INSERT INTO appointments(patient_id,starts_at,provider_name,location,reason,details_protected,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)
        RETURNING id,starts_at AS "startsAt",provider_name AS "providerName",location,reason,status`, [patientId, body.startsAt, safe.providerName ?? null, safe.location ?? null, safe.reason ?? null, protectedAppointment.canonicalProtected, user.id]);
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "appointment.create", purpose: "appointment_preparation", status: "protected", stages: [{ stage: "authorize", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: protectedAppointment.durationMs }], entityCounts: protectedAppointment.entityCounts, provider: protectedAppointment.provider });
      await audit(db, user.id, "appointment.created", "appointment", (row as { id: string }).id, patientId, { protectionTraceId: traceId }); return reply.code(201).send(row);
    });
  });

  app.post("/v1/patients/:patientId/tasks", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params); const body = createTaskSchema.parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "daily_care", "follow_ups")) return;
      const traceId = privacyTraceId(); const protectedTitle = await protectText(body.title, traceId, "daily_care");
      const row = await one(db, `INSERT INTO tasks(patient_id,title,title_protected,due_at,reminder_at,assigned_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)
        RETURNING id,title,due_at AS "dueAt",reminder_at AS "reminderAt",status`, [patientId, protectedTitle.aiSafeText, protectedTitle.canonicalProtected, body.dueAt ?? null, body.reminderAt ?? null, body.assignedTo ?? user.id, user.id]);
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "follow_up.create", purpose: "daily_care", status: "protected", stages: [{ stage: "authorize", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: protectedTitle.durationMs }], entityCounts: protectedTitle.entityCounts, provider: protectedTitle.provider });
      await audit(db, user.id, "task.created", "task", (row as { id: string }).id, patientId, { protectionTraceId: traceId }); return reply.code(201).send(row);
    });
  });

  app.post("/v1/patients/:patientId/tasks/:taskId/complete", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ taskId: z.string().uuid() }).parse(request.params);
    const { purpose } = z.object({ purpose: carePurposeSchema.default("daily_care") }).parse(request.query);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, purpose, "follow_ups")) return;
      const row = await one(db, `UPDATE tasks SET status='completed',completed_at=now(),completed_by=$1 WHERE id=$2 AND patient_id=$3 AND status='open' RETURNING id,status`, [user.id, params.taskId, params.patientId]);
      if (!row) return reply.code(409).send({ code: "TASK_NOT_OPEN" }); return row;
    });
  });

  app.post("/v1/patients/:patientId/tasks/:taskId/snooze", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ taskId: z.string().uuid() }).parse(request.params);
    const { purpose } = z.object({ purpose: carePurposeSchema.default("daily_care") }).parse(request.query);
    const body = z.object({ until: z.string().datetime() }).parse(request.body);
    if (new Date(body.until).getTime() <= Date.now()) return reply.code(400).send({ code: "SNOOZE_MUST_BE_FUTURE" });
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, purpose, "follow_ups")) return;
      const row = await one(db, `UPDATE tasks SET reminder_at=$1,last_reminded_at=NULL WHERE id=$2 AND patient_id=$3 AND status='open' RETURNING id,reminder_at AS "reminderAt",status`, [body.until, params.taskId, params.patientId]);
      if (!row) return reply.code(409).send({ code: "TASK_NOT_OPEN" });
      await audit(db, user.id, "task.snoozed", "task", params.taskId, params.patientId, { until: body.until });
      return row;
    });
  });

  app.post("/v1/patients/:patientId/documents", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "documents")) return;
      const file = await request.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
      if (!file || !allowedFiles.has(file.mimetype) || file.mimetype.startsWith("audio/")) return reply.code(415).send({ code: "UNSUPPORTED_FILE" });
      const buffer = await file.toBuffer(); await scanForMalware(buffer);
      const traceId = privacyTraceId(); const protectedFilename = await protectText(file.filename, traceId, "records_administration");
      const documentId = randomUUID(); const key = safeStorageKey(patientId, documentId, "protected-upload");
      await db.query(`INSERT INTO documents(id,patient_id,storage_key,original_filename,original_filename_protected,content_type,byte_size,status,uploaded_by,protection_trace_id) VALUES($1,$2,$3,$4,$5,$6,$7,'uploading',$8,$9)`, [documentId, patientId, key, protectedFilename.aiSafeText, protectedFilename.canonicalProtected, file.mimetype, buffer.length, user.id, traceId]);
      await putPrivateObject(key, buffer, file.mimetype);
      try {
        await db.query("UPDATE documents SET status='processing',updated_at=now() WHERE id=$1", [documentId]);
        await enqueueDocument(documentId, patientId, user.id);
        await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "document.upload", purpose: "records_administration", status: "protected", stages: [{ stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: protectedFilename.durationMs }], entityCounts: protectedFilename.entityCounts, provider: protectedFilename.provider });
        await audit(db, user.id, "document.uploaded", "document", documentId, patientId, { contentType: file.mimetype, bytes: buffer.length, protectionTraceId: traceId });
      } catch (error) {
        await deletePrivateObject(key).catch(() => undefined);
        throw error;
      }
      return reply.code(202).send({ id: documentId, status: "processing" });
    });
  });

  app.get("/v1/patients/:patientId/documents", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "documents")) return;
      const result = await db.query(`SELECT d.id,d.original_filename AS "filename",d.content_type AS "contentType",d.byte_size AS "byteSize",d.status,d.failure_reason AS "failureReason",d.created_at AS "createdAt",count(f.id) FILTER (WHERE f.status='proposed')::int AS "proposedFactCount" FROM documents d LEFT JOIN document_facts f ON f.document_id=d.id AND f.patient_id=d.patient_id WHERE d.patient_id=$1 AND d.status<>'deleted' GROUP BY d.id ORDER BY d.created_at DESC`, [patientId]);
      return result.rows;
    });
  });

  app.get("/v1/patients/:patientId/documents/:documentId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ documentId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, params.patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "records_administration", "documents")) return;
      const document = await one(db, `SELECT id,original_filename AS "filename",content_type AS "contentType",byte_size AS "byteSize",status,extracted_text AS "extractedText",failure_reason AS "failureReason",created_at AS "createdAt" FROM documents WHERE id=$1 AND patient_id=$2 AND status<>'deleted'`, [params.documentId, params.patientId]);
      if (!document) return reply.code(404).send({ code: "DOCUMENT_NOT_FOUND" });
      const facts = await db.query(`SELECT id,source_chunk_id AS "sourceChunkId",field,proposed_value AS "proposedValue",status,reviewed_at AS "reviewedAt",materialized_resource_type AS "materializedResourceType",materialized_resource_id AS "materializedResourceId" FROM document_facts WHERE document_id=$1 AND patient_id=$2 ORDER BY created_at,id`, [params.documentId, params.patientId]);
      return { document, facts: facts.rows };
    });
  });

  app.post("/v1/patients/:patientId/voice", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "daily_care", "assistant")) return;
      const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
      if (!file || !file.mimetype.startsWith("audio/")) return reply.code(415).send({ code: "AUDIO_REQUIRED" });
      const buffer = await file.toBuffer(); await scanForMalware(buffer);
      const id = randomUUID(); const key = `patients/${patientId}/voice/${id}/recording`;
      await putPrivateObject(key, buffer, file.mimetype);
      try {
        await db.query("INSERT INTO voice_events(id,patient_id,storage_key,content_type,created_by) VALUES($1,$2,$3,$4,$5)", [id, patientId, key, file.mimetype, user.id]);
        await enqueueVoice(id, patientId, user.id);
      } catch (error) {
        await deletePrivateObject(key).catch(() => undefined);
        throw error;
      }
      return reply.code(202).send({ id, status: "processing" });
    });
  });

  app.get("/v1/patients/:patientId/assistant/messages", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "daily_care", "assistant")) return;
      const result = await db.query(`SELECT m.id,m.role,m.content,m.citations,m.created_at AS "createdAt" FROM chat_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.patient_id=$1 AND c.kind='assistant' ORDER BY m.created_at LIMIT 200`, [patientId]);
      return result.rows;
    });
  });

  app.post("/v1/legacy-disabled/patients/:patientId/assistant/messages", async (_request, reply) => reply.code(410).send({ code: "PROTECTED_ASSISTANT_REQUIRED" }));

  app.patch("/v1/patients/:patientId/archive", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "delete")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      await db.query("UPDATE patients SET archived_at=now(),updated_at=now() WHERE id=$1", [patientId]);
      await audit(db, user.id, "patient.archived", "patient", patientId, patientId); return { archived: true };
    });
  });

  app.delete("/v1/patients/:patientId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    const { confirmation } = z.object({ confirmation: z.string().min(1).max(120) }).parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (role !== "owner") return reply.code(403).send({ code: "OWNER_REQUIRED" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      const confirmationProtected = await protectText(confirmation, privacyTraceId(), "records_administration");
      const patient = await one<{ identity_fingerprint: string | null }>(db, "SELECT identity_fingerprint FROM patients WHERE id=$1 FOR UPDATE", [patientId]);
      if (!patient || confirmationProtected.fingerprint !== patient.identity_fingerprint) return reply.code(400).send({ code: "CONFIRMATION_MISMATCH", message: "Enter the profile's preferred name exactly to confirm permanent deletion." });
      const documents = await db.query<{ storage_key: string }>("SELECT storage_key FROM documents WHERE patient_id=$1", [patientId]);
      const voices = await db.query<{ storage_key: string }>("SELECT storage_key FROM voice_events WHERE patient_id=$1", [patientId]);
      await Promise.all([...documents.rows, ...voices.rows].map((item) => deletePrivateObject(item.storage_key).catch(() => undefined)));
      await db.query("DELETE FROM patients WHERE id=$1", [patientId]);
      await audit(db, user.id, "patient.permanently_deleted", "patient", patientId, undefined, { objectsRemoved: documents.rows.length + voices.rows.length });
      return reply.code(204).send();
    });
  });

  app.get("/v1/patients/:patientId/export", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    patientParams.parse(request.params);
    return reply.code(410).send({ code: "CONTROLLED_EXPORT_REQUIRED", message: "Use the purpose-authorized FHIR export with recent MFA and a stated reason." });
  });

  app.get("/v1/patients/:patientId/access", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      const members = await db.query(`SELECT u.id,'Protected member'::text AS "displayName",'Protected email'::text AS email,m.role,m.accepted_at AS "acceptedAt",m.revoked_at AS "revokedAt" FROM patient_members m JOIN users u ON u.id=m.user_id WHERE m.patient_id=$1 ORDER BY m.accepted_at`, [patientId]);
      const history = await db.query(`SELECT action,resource_type AS "resourceType",resource_id AS "resourceId",created_at AS "createdAt" FROM audit_events WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 200`, [patientId]);
      const invitations = can(role, "manage_access") ? (await db.query(`SELECT id,'Protected email'::text AS email,role,expires_at AS "expiresAt",created_at AS "createdAt" FROM patient_invitations WHERE patient_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`, [patientId])).rows : [];
      return { role, members: members.rows, invitations, history: history.rows };
    });
  });

  app.post("/v1/patients/:patientId/access", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    const body = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), role: z.enum(["care_coordinator","caregiver","viewer"]) }).parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "manage_access")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      const traceId = privacyTraceId(); const protectedEmail = await protectText(body.email, traceId, "records_administration");
      const target = await one<{ id: string }>(db, "SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL", [protectedEmail.aiSafeText]);
      if (!target) {
        const token = randomBytes(32).toString("base64url");
        const invitation = await one<{ id: string }>(db, `INSERT INTO patient_invitations(patient_id,email,email_protected,email_fingerprint,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days') RETURNING id`, [patientId, protectedEmail.aiSafeText, protectedEmail.canonicalProtected, protectedEmail.fingerprint, body.role, hashAuthToken(token), user.id]);
        await sendMail(body.email, "Salus care workspace invitation", `You were invited to a Salus workspace. Register or sign in with ${body.email}, then open ${env.WEB_ORIGIN}/accept-invite?token=${token}. This invitation expires in seven days.`);
        await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "access.invite", purpose: "records_administration", status: "protected", stages: [{ stage: "authorize", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: protectedEmail.durationMs }], entityCounts: protectedEmail.entityCounts, provider: protectedEmail.provider });
        await audit(db, user.id, "access.invited", "patient_invitation", invitation!.id, patientId, { role: body.role, protectionTraceId: traceId });
        return reply.code(202).send({ invitationId: invitation!.id, role: body.role, expiresIn: "7 days" });
      }
      await db.query(`INSERT INTO patient_members(patient_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(patient_id,user_id) DO UPDATE SET role=EXCLUDED.role,revoked_at=NULL`, [patientId, target.id, body.role]);
      await db.query(`INSERT INTO access_grants(patient_id,grantee_id,issued_by,purposes,scopes,reveal_level,expires_at)
        VALUES($1,$2,$3,ARRAY['daily_care','medication_support','appointment_preparation'],ARRAY['profile','timeline','medications','labs','follow_ups','documents','assistant'],'routine',now()+interval '30 days')`, [patientId, target.id, user.id]);
      await audit(db, user.id, "access.granted", "patient_member", target.id, patientId, { role: body.role }); return reply.code(201).send({ userId: target.id, role: body.role });
    });
  });

  app.post("/v1/invitations/accept", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { token } = z.object({ token: z.string().min(20) }).parse(request.body);
    return withUser(user.id, async (db) => {
      const accepted = await one<{ patient_id: string | null }>(db, `SELECT accept_patient_invitation($1,$2,$3) AS patient_id`, [hashAuthToken(token), user.id, user.email]);
      if (!accepted?.patient_id) return reply.code(400).send({ code: "INVALID_INVITATION", message: "The invitation is invalid, expired, or belongs to another email address." });
      const issuer = await one<{ created_by: string }>(db, "SELECT created_by FROM patients WHERE id=$1", [accepted.patient_id]);
      await db.query(`INSERT INTO access_grants(patient_id,grantee_id,issued_by,purposes,scopes,reveal_level,expires_at)
        VALUES($1,$2,$3,ARRAY['daily_care','medication_support','appointment_preparation'],ARRAY['profile','timeline','medications','labs','follow_ups','documents','assistant'],'routine',now()+interval '30 days')`, [accepted.patient_id, user.id, issuer!.created_by]);
      await audit(db, user.id, "access.invitation_accepted", "patient_invitation", undefined, accepted.patient_id);
      return { patientId: accepted.patient_id };
    });
  });

  app.get("/v1/patients/:patientId/notification-preferences", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      const row = await one(db, `SELECT timezone,quiet_start AS "quietStart",quiet_end AS "quietEnd",in_app_enabled AS "inAppEnabled",email_enabled AS "emailEnabled",push_enabled AS "pushEnabled" FROM notification_preferences WHERE patient_id=$1 AND user_id=$2`, [patientId, user.id]);
      return row ?? { timezone: "America/Chicago", quietStart: null, quietEnd: null, inAppEnabled: true, emailEnabled: true, pushEnabled: false };
    });
  });

  app.put("/v1/patients/:patientId/notification-preferences", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    const body = z.object({ timezone: z.string().min(1).max(80), quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), inAppEnabled: z.boolean(), emailEnabled: z.boolean(), pushEnabled: z.boolean() }).parse(request.body);
    try { new Intl.DateTimeFormat("en", { timeZone: body.timezone }).format(); } catch { return reply.code(400).send({ code: "INVALID_TIMEZONE" }); }
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      const row = await one(db, `INSERT INTO notification_preferences(patient_id,user_id,timezone,quiet_start,quiet_end,in_app_enabled,email_enabled,push_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(patient_id,user_id) DO UPDATE SET timezone=EXCLUDED.timezone,quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,in_app_enabled=EXCLUDED.in_app_enabled,email_enabled=EXCLUDED.email_enabled,push_enabled=EXCLUDED.push_enabled,updated_at=now() RETURNING timezone,quiet_start AS "quietStart",quiet_end AS "quietEnd",in_app_enabled AS "inAppEnabled",email_enabled AS "emailEnabled",push_enabled AS "pushEnabled"`, [patientId, user.id, body.timezone, body.quietStart, body.quietEnd, body.inAppEnabled, body.emailEnabled, body.pushEnabled]);
      await audit(db, user.id, "notification_preferences.updated", "notification_preferences", undefined, patientId, { channels: { inApp: body.inAppEnabled, email: body.emailEnabled, push: body.pushEnabled } });
      return row;
    });
  });

  app.delete("/v1/patients/:patientId/access/:memberId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ memberId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "manage_access")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "records_administration", "profile")) return;
      const target = await one<{ role: string }>(db, "SELECT role FROM patient_members WHERE patient_id=$1 AND user_id=$2 AND revoked_at IS NULL", [params.patientId, params.memberId]);
      if (!target || target.role === "owner") return reply.code(409).send({ code: "OWNER_CANNOT_BE_REVOKED" });
      await db.query("UPDATE patient_members SET revoked_at=now() WHERE patient_id=$1 AND user_id=$2", [params.patientId, params.memberId]);
      await db.query("UPDATE access_grants SET revoked_at=now(),revoked_by=$1 WHERE patient_id=$2 AND grantee_id=$3 AND revoked_at IS NULL", [user.id, params.patientId, params.memberId]);
      await audit(db, user.id, "access.revoked", "patient_member", params.memberId, params.patientId); return reply.code(204).send();
    });
  });

  app.get("/v1/patients/:patientId/consents", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      return (await db.query(`SELECT id,consent_type AS "consentType",status,recorded_at AS "recordedAt",evidence FROM consent_records WHERE patient_id=$1 ORDER BY recorded_at DESC`, [patientId])).rows;
    });
  });

  app.post("/v1/patients/:patientId/consents", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { patientId } = patientParams.parse(request.params); const body = z.object({ consentType: z.string().min(2).max(100), status: z.enum(["granted","declined","revoked"]), evidence: z.string().max(2000).optional() }).parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, patientId, "records_administration", "profile")) return;
      const traceId = privacyTraceId();
      const protectedEvidence = body.evidence ? await protectText(body.evidence, traceId, "records_administration") : null;
      const row = await one(db, `INSERT INTO consent_records(patient_id,consent_type,status,recorded_by,evidence,evidence_protected) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,consent_type AS "consentType",status,recorded_at AS "recordedAt"`, [patientId, body.consentType, body.status, user.id, protectedEvidence?.aiSafeText ?? null, protectedEvidence?.canonicalProtected ?? null]);
      await recordProtectionReceipt(db, { traceId, patientId, actorId: user.id, operation: "consent.record", purpose: "records_administration", status: "protected", provider: protectedEvidence?.provider, entityCounts: protectedEvidence?.entityCounts, stages: [{ stage: "authorize", outcome: "passed" }, ...(protectedEvidence ? [{ stage: "discover" as const, outcome: "passed" as const }, { stage: "protect" as const, outcome: "passed" as const }] : []), { stage: "persist", outcome: "passed", detail: "protected consent evidence" }] });
      await audit(db, user.id, "consent.recorded", "consent", (row as { id: string }).id, patientId, { status: body.status }); return reply.code(201).send(row);
    });
  });

  app.post("/v1/patients/:patientId/documents/:documentId/verify", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ documentId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "records_administration", "documents")) return;
      const document = await one<{ id: string; status: string }>(db, "SELECT id,status FROM documents WHERE id=$1 AND patient_id=$2 FOR UPDATE", [params.documentId, params.patientId]);
      if (!document || document.status !== "needs_review") return reply.code(409).send({ code: "DOCUMENT_NOT_REVIEWABLE", message: "The document is not awaiting verification." });
      const proposed = await one<{ exists: boolean }>(db, "SELECT EXISTS(SELECT 1 FROM document_facts WHERE document_id=$1 AND patient_id=$2 AND status='proposed') AS exists", [params.documentId, params.patientId]);
      if (proposed?.exists) return reply.code(409).send({ code: "DOCUMENT_NOT_REVIEWABLE", message: "Review every proposed fact before verifying the document." });
      const identityMismatch = await one<{ exists: boolean }>(db, `SELECT EXISTS(SELECT 1 FROM document_facts WHERE document_id=$1 AND patient_id=$2 AND field='patient_identity' AND COALESCE((proposed_value->>'match')::boolean,false)=false) AS exists`, [params.documentId, params.patientId]);
      if (identityMismatch?.exists) return reply.code(409).send({ code: "DOCUMENT_PATIENT_MISMATCH", message: "This document identifies a different patient and cannot be added to this care record. Delete it and upload it in the matching patient workspace." });
      const facts = await db.query<ApprovedDocumentFact>("SELECT id,field,proposed_value FROM document_facts WHERE document_id=$1 AND patient_id=$2 AND status='approved' AND materialized_resource_id IS NULL ORDER BY created_at,id FOR UPDATE", [params.documentId, params.patientId]);
      try { facts.rows.forEach(validateMaterializableFact); } catch {
        return reply.code(409).send({ code: "INVALID_APPROVED_FACT", message: "An approved fact is not valid for the care record. Edit or reject it before verification." });
      }
      const resources = [];
      for (const fact of facts.rows) {
        const resource = await materializeDocumentFact(db, fact, params.patientId, params.documentId, user.id, role);
        if (resource) resources.push(resource);
      }
      const row = await one(db, "UPDATE documents SET status='verified',updated_at=now() WHERE id=$1 AND patient_id=$2 RETURNING id,status", [params.documentId, params.patientId]);
      await audit(db, user.id, "document.verified", "document", params.documentId, params.patientId, { materializedResources: resources }); return { ...row, materializedResources: resources };
    });
  });

  app.patch("/v1/patients/:patientId/documents/:documentId/facts/:factId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ documentId: z.string().uuid(), factId: z.string().uuid() }).parse(request.params);
    const body = z.object({ status: z.enum(["approved", "rejected"]), proposedValue: z.record(z.unknown()).optional() }).parse(request.body);
    if (body.proposedValue && JSON.stringify(body.proposedValue).length > 10_000) return reply.code(400).send({ code: "FACT_TOO_LARGE" });
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "records_administration", "documents")) return;
      const row = await one(db, `UPDATE document_facts SET status=$1,proposed_value=COALESCE($2,proposed_value),reviewed_by=$3,reviewed_at=now() WHERE id=$4 AND document_id=$5 AND patient_id=$6 AND status='proposed' RETURNING id,field,proposed_value AS "proposedValue",status,reviewed_at AS "reviewedAt"`, [body.status, body.proposedValue ? JSON.stringify(body.proposedValue) : null, user.id, params.factId, params.documentId, params.patientId]);
      if (!row) return reply.code(409).send({ code: "FACT_NOT_REVIEWABLE" });
      await audit(db, user.id, `document_fact.${body.status}`, "document_fact", params.factId, params.patientId, { documentId: params.documentId, edited: Boolean(body.proposedValue) });
      return row;
    });
  });

  app.delete("/v1/patients/:patientId/documents/:documentId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ documentId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "records_administration", "documents")) return;
      const document = await one<{ storage_key: string }>(db, `SELECT storage_key FROM documents WHERE id=$1 AND patient_id=$2 AND status<>'deleted' FOR UPDATE`, [params.documentId, params.patientId]);
      if (!document) return reply.code(404).send({ code: "DOCUMENT_NOT_FOUND" });
      await deletePrivateObject(document.storage_key).catch(() => undefined);
      await db.query("DELETE FROM timeline_events WHERE patient_id=$1 AND source_document_id=$2", [params.patientId, params.documentId]);
      await db.query("DELETE FROM tasks WHERE patient_id=$1 AND source_document_id=$2", [params.patientId, params.documentId]);
      await db.query("DELETE FROM appointments WHERE patient_id=$1 AND source_document_id=$2", [params.patientId, params.documentId]);
      await db.query("DELETE FROM medications WHERE patient_id=$1 AND source_document_id=$2 AND status='proposed'", [params.patientId, params.documentId]);
      await db.query("DELETE FROM document_facts WHERE document_id=$1 AND patient_id=$2", [params.documentId, params.patientId]);
      await db.query("DELETE FROM document_chunks WHERE document_id=$1 AND patient_id=$2", [params.documentId, params.patientId]);
      await db.query("UPDATE documents SET status='deleted',extracted_text=NULL,extracted_text_protected=NULL,wrapped_object_key=NULL,failure_reason=NULL,updated_at=now() WHERE id=$1 AND patient_id=$2", [params.documentId, params.patientId]);
      await audit(db, user.id, "document.deleted", "document", params.documentId, params.patientId);
      return reply.code(204).send();
    });
  });

  app.get("/v1/patients/:patientId/voice/:voiceId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ voiceId: z.string().uuid() }).parse(request.params);
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, params.patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "daily_care", "assistant")) return;
      const row = await one(db, `SELECT id,status,original_transcript AS "originalTranscript",edited_transcript AS "editedTranscript",confidence,structured_result AS "structuredResult",created_at AS "createdAt" FROM voice_events WHERE id=$1 AND patient_id=$2`, [params.voiceId, params.patientId]);
      return row ?? reply.code(404).send({ code: "VOICE_NOT_FOUND" });
    });
  });

  app.post("/v1/patients/:patientId/voice/:voiceId/confirm", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ voiceId: z.string().uuid() }).parse(request.params);
    const body = z.object({ editedTranscript: z.string().min(1).max(12000), category: createTimelineEventSchema.shape.category, occurredAt: z.string().datetime() }).parse(request.body);
    return withUser(user.id, async (db) => {
      const role = await requirePatientRole(db, params.patientId); if (!role || !can(role, "write")) return reply.code(role ? 403 : 404).send({ code: role ? "FORBIDDEN" : "PATIENT_NOT_FOUND" });
      if (!await requirePurposeScope(db, reply, params.patientId, "daily_care", "assistant")) return;
      if (!await requirePurposeScope(db, reply, params.patientId, "daily_care", "timeline")) return;
      const traceId = privacyTraceId();
      const protectedTranscript = await protectText(body.editedTranscript, traceId, "daily_care");
      const voice = await one(db, `UPDATE voice_events SET status='confirmed',edited_transcript=$1,edited_transcript_protected=$2,structured_result=$3 WHERE id=$4 AND patient_id=$5 AND status='needs_review' RETURNING id`, [protectedTranscript.aiSafeText, protectedTranscript.canonicalProtected, JSON.stringify({ category: body.category, occurredAt: body.occurredAt }), params.voiceId, params.patientId]);
      if (!voice) return reply.code(409).send({ code: "VOICE_NOT_REVIEWABLE" });
      const event = await one(db, `INSERT INTO timeline_events(patient_id,occurred_at,category,summary,summary_protected,source,created_by) VALUES($1,$2,$3,$4,$5,'voice',$6) RETURNING id`, [params.patientId, body.occurredAt, body.category, protectedTranscript.aiSafeText, protectedTranscript.canonicalProtected, user.id]);
      await recordProtectionReceipt(db, { traceId, patientId: params.patientId, actorId: user.id, operation: "voice.confirm", purpose: "daily_care", status: "protected", provider: protectedTranscript.provider, entityCounts: protectedTranscript.entityCounts, stages: [{ stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed" }, { stage: "persist", outcome: "passed", detail: "protected transcript and AI-safe timeline view" }] });
      await audit(db, user.id, "voice.confirmed", "voice_event", params.voiceId, params.patientId, { timelineEventId: (event as { id: string }).id, traceId }); return { voiceId: params.voiceId, timelineEventId: (event as { id: string }).id, protectionTraceId: traceId };
    });
  });

  app.get("/v1/patients/:patientId/documents/:documentId/original", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = patientParams.extend({ documentId: z.string().uuid() }).parse(request.params);
    const query = z.object({ purpose: z.enum(["records_administration", "emergency_support"]), reason: z.string().min(8).max(500) }).parse(request.query);
    const traceId = privacyTraceId();
    return withUser(user.id, async (db) => {
      if (!await requirePatientRole(db, params.patientId)) return reply.code(404).send({ code: "PATIENT_NOT_FOUND" });
      if (!await activePurposeGrant(db, params.patientId, query.purpose, "documents")) return reply.code(403).send({ code: "PURPOSE_NOT_AUTHORIZED" });
      if (!await hasRecentMfa(request)) return reply.code(403).send({ code: "RECENT_MFA_REQUIRED", message: "Original document reveal requires recent MFA." });
      const document = await one<{ storage_key: string; content_type: string; original_filename: string; original_filename_protected: string | null }>(db, "SELECT storage_key,content_type,original_filename,original_filename_protected FROM documents WHERE id=$1 AND patient_id=$2 AND status<>'deleted'", [params.documentId, params.patientId]);
      if (!document) return reply.code(404).send({ code: "DOCUMENT_NOT_FOUND" });
      const bytes = await getPrivateObject(document.storage_key);
      const filename = document.original_filename_protected ? await unprotectText(document.original_filename_protected, traceId, query.purpose) : document.original_filename;
      const protectedReason = await protectText(query.reason, traceId, query.purpose);
      await db.query("INSERT INTO reveal_events(patient_id,actor_id,resource_type,resource_id,fields,purpose,reason_protected,decision,trace_id) VALUES($1,$2,'document',$3,ARRAY['originalDocument'],$4,$5,'allowed',$6)", [params.patientId, user.id, params.documentId, query.purpose, protectedReason.canonicalProtected, traceId]);
      await recordProtectionReceipt(db, { traceId, patientId: params.patientId, actorId: user.id, operation: "document.original_reveal", purpose: query.purpose, status: "revealed", provider: protectedReason.provider, stages: [{ stage: "authorize", outcome: "passed", detail: "purpose, documents scope, and recent MFA" }, { stage: "reveal", outcome: "passed", detail: "Protegrity-unwrapped per-object key" }, { stage: "egress", outcome: "passed", detail: "no-store original document response" }] });
      await audit(db, user.id, "document.original_revealed", "document", params.documentId, params.patientId, { purpose: query.purpose, traceId });
      const safeFilename = filename.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "salus-document";
      reply.header("Cache-Control", "no-store, private, max-age=0").header("Pragma", "no-cache").header("Content-Disposition", `attachment; filename="${safeFilename}"`).type(document.content_type);
      return reply.send(bytes);
    });
  });
}
