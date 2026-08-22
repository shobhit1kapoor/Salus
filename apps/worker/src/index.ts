import { Worker, type Job } from "bullmq";
import pdf from "pdf-parse";
import { createWorker } from "tesseract.js";
import { Pool } from "pg";
import { env } from "../../api/src/env.js";
import { getPrivateObject } from "../../api/src/storage.js";
import { embed } from "../../api/src/ai.js";
import { audit, withUser } from "../../api/src/db.js";
import { sendMail } from "../../api/src/mail.js";
import { privacyTraceId, protectText, recordProtectionReceipt, unprotectText } from "../../api/src/privacy.js";
import webpush from "web-push";
import { documentAppointmentFactSchema, documentMedicationFactSchema, documentPatientIdentityFactSchema, documentTaskFactSchema, documentTimelineFactSchema, extractDocumentFactProposals, extractDocumentPatientIdentity } from "@salus/contracts";

const pushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushConfigured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

const redis = new URL(env.REDIS_URL);
const connection = { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined };
type CareJob = { documentId?: string; voiceId?: string; patientId: string; actorId: string };

async function extractText(buffer: Buffer, contentType: string) {
  if (contentType === "text/plain") return buffer.toString("utf8");
  if (contentType === "application/pdf") return (await pdf(buffer)).text;
  if (contentType.startsWith("image/")) {
    const worker = await createWorker("eng");
    try { return (await worker.recognize(buffer)).data.text; } finally { await worker.terminate(); }
  }
  throw new Error(`Unsupported document content type: ${contentType}`);
}

async function processDocument(data: CareJob) {
  const metadata = await withUser(data.actorId, async (db) => (await db.query<{ storage_key: string; content_type: string; timezone: string; preferred_name: string; identity_fingerprint: string | null }>("SELECT d.storage_key,d.content_type,p.timezone,p.preferred_name,p.identity_fingerprint FROM documents d JOIN patients p ON p.id=d.patient_id WHERE d.id=$1 AND d.patient_id=$2", [data.documentId, data.patientId])).rows[0]);
  if (!metadata) throw new Error("Document is unavailable or authorization was revoked");
  const buffer = await getPrivateObject(metadata.storage_key);
  const text = (await extractText(buffer, metadata.content_type)).replace(/\0/g, "").trim();
  if (!text) throw new Error("No readable text was extracted");
  const traceId = privacyTraceId();
  // Resolve identity inside the trusted extraction boundary. Only a protected
  // label and the equality decision are persisted; the raw document name is not.
  const rawIdentity = extractDocumentPatientIdentity(text, { preferredName: "__salus_identity_probe__" });
  const rawDocumentName = rawIdentity?.proposedValue.documentName;
  const protectedIdentity = typeof rawDocumentName === "string"
    ? await protectText(rawDocumentName, traceId, "records_administration")
    : null;
  // Extraction occurs in memory. The first durable or provider-facing representation
  // is produced by the Protegrity boundary and is safe for semantic processing.
  const protectedDocument = await protectText(text.slice(0, 2_000_000), traceId, "records_administration");
  const semanticText = protectedDocument.aiSafeText;
  const chunks = semanticText.match(/[\s\S]{1,1800}(?:\s|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [semanticText.slice(0, 1800)];
  await withUser(data.actorId, async (db) => {
    await db.query("DELETE FROM timeline_events WHERE patient_id=$1 AND source_document_id=$2", [data.patientId, data.documentId]);
    await db.query("DELETE FROM tasks WHERE patient_id=$1 AND source_document_id=$2", [data.patientId, data.documentId]);
    await db.query("DELETE FROM appointments WHERE patient_id=$1 AND source_document_id=$2", [data.patientId, data.documentId]);
    await db.query("DELETE FROM medications WHERE patient_id=$1 AND source_document_id=$2 AND status='proposed'", [data.patientId, data.documentId]);
    await db.query("DELETE FROM document_facts WHERE document_id=$1 AND patient_id=$2", [data.documentId, data.patientId]);
    await db.query("DELETE FROM document_chunks WHERE document_id=$1 AND patient_id=$2", [data.documentId, data.patientId]);
    const insertedChunks: Array<{ id: string; content: string }> = [];
    for (const content of chunks.slice(0, 200)) {
      const vector = await embed(content, "passage");
      const inserted = await db.query<{ id: string }>("INSERT INTO document_chunks(patient_id,document_id,content,embedding) VALUES($1,$2,$3,$4::vector) RETURNING id", [data.patientId, data.documentId, content, `[${vector.join(",")}]`]);
      insertedChunks.push({ id: inserted.rows[0].id, content });
    }
    const firstChunkId = insertedChunks[0]?.id;
    if (!firstChunkId) throw new Error("Document chunking produced no reviewable content");
    const verifiedMedications = await db.query<{ id: string; name: string; dosage: string }>("SELECT id,name,dosage FROM medications WHERE patient_id=$1 AND status='verified'", [data.patientId]);
    const semanticIdentity = extractDocumentPatientIdentity(semanticText, { preferredName: "__salus_identity_probe__" });
    const identity = protectedIdentity ? {
      field: "patient_identity" as const,
      proposedValue: documentPatientIdentityFactSchema.parse({
        documentName: "Protected document identity",
        expectedName: "Protected profile identity",
        match: Boolean(metadata.identity_fingerprint && protectedIdentity.fingerprint === metadata.identity_fingerprint),
        ...(!(metadata.identity_fingerprint && protectedIdentity.fingerprint === metadata.identity_fingerprint) ? { conflict: { type: "patient_identity_mismatch" as const } } : {}),
      }),
      sourceText: semanticIdentity?.sourceText ?? semanticText.slice(0, 200),
    } : undefined;
    const semanticProposals = extractDocumentFactProposals(semanticText, metadata.timezone)
      .filter((proposal) => proposal.field === "document_type" || proposal.field === "document_summary");
    const minimumNecessaryClinicalProposals = extractDocumentFactProposals(text, metadata.timezone)
      .filter((proposal) => proposal.field !== "document_type" && proposal.field !== "document_summary");
    // Structured clinical facts are derived in memory, detached from raw patient
    // identifiers, and joined only to the protected profile ID. The free-text
    // summary and retrieval chunks always come from the protected semantic view.
    const proposals = [...(identity ? [identity] : []), ...semanticProposals, ...minimumNecessaryClinicalProposals];
    const insertedFacts: Array<{ id: string; field: string; proposedValue: Record<string, unknown> }> = [];
    for (const proposal of proposals) {
      let proposedValue = proposal.proposedValue;
      if (proposal.field === "medication") {
        const medication = documentMedicationFactSchema.parse(proposedValue);
        const known = verifiedMedications.rows.find((item) => item.name.toLocaleLowerCase() === medication.name.toLocaleLowerCase());
        const conflict = known && known.dosage.toLocaleLowerCase() !== medication.dosage.toLocaleLowerCase() ? { type: "possible_dosage_conflict", verifiedDosage: known.dosage } : undefined;
        proposedValue = { ...medication, ...(conflict ? { conflict } : {}) };
      }
      const sourceChunk = insertedChunks.find((chunk) => chunk.content.includes(proposal.sourceText)) ?? insertedChunks[0];
      const inserted = await db.query<{ id: string }>("INSERT INTO document_facts(patient_id,document_id,source_chunk_id,field,proposed_value) VALUES($1,$2,$3,$4,$5) RETURNING id", [data.patientId, data.documentId, sourceChunk.id, proposal.field, JSON.stringify(proposedValue)]);
      insertedFacts.push({ id: inserted.rows[0].id, field: proposal.field, proposedValue });
    }
    const identityMismatch = insertedFacts.find((fact) => fact.field === "patient_identity" && fact.proposedValue.match === false);
    if (identityMismatch) {
      await db.query("UPDATE document_facts SET status=CASE WHEN id=$1 THEN 'blocked' ELSE 'not_applied' END WHERE document_id=$2 AND patient_id=$3", [identityMismatch.id, data.documentId, data.patientId]);
      await db.query("UPDATE documents SET extracted_text=$1,extracted_text_protected=$2,protection_trace_id=$3,status='needs_review',failure_reason='Patient identity mismatch: this document was not imported.',updated_at=now() WHERE id=$4 AND patient_id=$5", [semanticText, protectedDocument.canonicalProtected, traceId, data.documentId, data.patientId]);
      await audit(db, data.actorId, "document.auto_import_blocked", "document", data.documentId, data.patientId, { reason: "patient_identity_mismatch" });
      await recordProtectionReceipt(db, { traceId, patientId: data.patientId, actorId: data.actorId, operation: "document.ingest", purpose: "records_administration", status: "blocked", entityCounts: protectedDocument.entityCounts, provider: protectedDocument.provider, stages: [
        { stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed", detail: `${Object.values(protectedDocument.entityCounts).reduce((a, b) => a + b, 0)} entities` },
        { stage: "protect", outcome: "passed" }, { stage: "persist", outcome: "passed", detail: "protected envelope and AI-safe view only" }, { stage: "egress", outcome: "blocked", detail: "patient identity mismatch" }
      ] });
      return;
    }
    const materialized: Array<{ id: string; type: string }> = [];
    for (const fact of insertedFacts) {
      let resource: { id: string; type: string } | undefined;
      if (fact.field === "timeline_event") {
        const value = documentTimelineFactSchema.parse(fact.proposedValue);
        const row = await db.query<{ id: string }>(`INSERT INTO timeline_events(patient_id,occurred_at,category,summary,source,created_by,source_document_id,source_fact_id) VALUES($1,$2,$3,$4,'document',$5,$6,$7) RETURNING id`, [data.patientId, value.occurredAt, value.category, value.summary, data.actorId, data.documentId, fact.id]);
        resource = { id: row.rows[0].id, type: "timeline_event" };
      } else if (fact.field === "appointment") {
        const value = documentAppointmentFactSchema.parse(fact.proposedValue);
        const row = await db.query<{ id: string }>("INSERT INTO appointments(patient_id,starts_at,provider_name,location,reason,created_by,source_document_id,source_fact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [data.patientId, value.startsAt, value.providerName ?? null, value.location ?? null, value.reason ?? null, data.actorId, data.documentId, fact.id]);
        resource = { id: row.rows[0].id, type: "appointment" };
      } else if (fact.field === "task") {
        const value = documentTaskFactSchema.parse(fact.proposedValue);
        const row = await db.query<{ id: string }>("INSERT INTO tasks(patient_id,title,due_at,reminder_at,assigned_to,created_by,source_document_id,source_fact_id) VALUES($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id", [data.patientId, value.title, value.dueAt ?? null, value.reminderAt ?? null, data.actorId, data.documentId, fact.id]);
        resource = { id: row.rows[0].id, type: "task" };
      } else if (fact.field === "medication") {
        const value = documentMedicationFactSchema.parse(fact.proposedValue);
        const existing = verifiedMedications.rows.find((item) => item.name.toLocaleLowerCase() === value.name.toLocaleLowerCase() && item.dosage.toLocaleLowerCase() === value.dosage.toLocaleLowerCase());
        if (existing) resource = { id: existing.id, type: "medication" };
        else {
          const row = await db.query<{ id: string }>("INSERT INTO medications(patient_id,name,normalized_name,dosage,route,schedule,instructions,status,created_by,source_document_id,source_fact_id) VALUES($1,$2,lower($2),$3,$4,$5,$6,'proposed',$7,$8,$9) RETURNING id", [data.patientId, value.name, value.dosage, value.route, value.schedule, value.instructions ?? null, data.actorId, data.documentId, fact.id]);
          resource = { id: row.rows[0].id, type: "medication" };
        }
      }
      if (resource) {
        materialized.push(resource);
        await db.query("UPDATE document_facts SET status='auto_applied',reviewed_by=$1,reviewed_at=now(),materialized_resource_type=$2,materialized_resource_id=$3 WHERE id=$4", [data.actorId, resource.type, resource.id, fact.id]);
      } else await db.query("UPDATE document_facts SET status='auto_applied',reviewed_by=$1,reviewed_at=now() WHERE id=$2", [data.actorId, fact.id]);
    }
    await db.query("UPDATE documents SET extracted_text=$1,extracted_text_protected=$2,protection_trace_id=$3,status='verified',failure_reason=NULL,updated_at=now() WHERE id=$4 AND patient_id=$5", [semanticText, protectedDocument.canonicalProtected, traceId, data.documentId, data.patientId]);
    await audit(db, data.actorId, "document.auto_imported", "document", data.documentId, data.patientId, { materializedResources: materialized, medicationSafety: "new medication entries remain proposed" });
    await recordProtectionReceipt(db, { traceId, patientId: data.patientId, actorId: data.actorId, operation: "document.ingest", purpose: "records_administration", status: "protected", entityCounts: protectedDocument.entityCounts, provider: protectedDocument.provider, stages: [
      { stage: "authorize", outcome: "passed" }, { stage: "discover", outcome: "passed", detail: `${Object.values(protectedDocument.entityCounts).reduce((a, b) => a + b, 0)} entities` },
      { stage: "protect", outcome: "passed" }, { stage: "persist", outcome: "passed", detail: "encrypted object, protected canonical text, AI-safe chunks" }, { stage: "embed", outcome: "passed", detail: `${insertedChunks.length} pseudonymized chunks` }, { stage: "egress", outcome: "passed", detail: "no raw extracted text retained" }
    ] });
  });
}

async function transcribeVoice(data: CareJob) {
  const metadata = await withUser(data.actorId, async (db) => (await db.query<{ storage_key: string; content_type: string }>("SELECT storage_key,content_type FROM voice_events WHERE id=$1 AND patient_id=$2", [data.voiceId, data.patientId])).rows[0]);
  if (!metadata) throw new Error("Voice recording is unavailable or authorization was revoked");
  // Raw audio never leaves the trusted Salus boundary. A local ASR adapter may be
  // wired later; the safe default is explicit human transcript review.
  await withUser(data.actorId, async (db) => db.query("UPDATE voice_events SET status='needs_review',structured_result=$1 WHERE id=$2 AND patient_id=$3", [JSON.stringify({ manualTranscriptionRequired: true, rawAudioExternalProviderPayload: false, reason: "Local transcription or manual review is required" }), data.voiceId, data.patientId]));
}

const worker = new Worker<CareJob>("salus-processing", async (job: Job<CareJob>) => {
  if (job.name === "process-document") return processDocument(job.data);
  if (job.name === "transcribe-voice") return transcribeVoice(job.data);
  throw new Error(`Unknown job ${job.name}`);
}, { connection, concurrency: 3 });

worker.on("failed", async (job, error) => {
  console.error(JSON.stringify({ level: "error", jobId: job?.id, jobName: job?.name, error: error.message }));
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  if (job.name === "process-document") await withUser(job.data.actorId, async (db) => db.query("UPDATE documents SET status='failed',failure_reason=$1,updated_at=now() WHERE id=$2 AND patient_id=$3", [error.message.slice(0, 500), job.data.documentId, job.data.patientId]));
  if (job.name === "transcribe-voice") await withUser(job.data.actorId, async (db) => db.query("UPDATE voice_events SET status='failed',structured_result=$1 WHERE id=$2 AND patient_id=$3", [JSON.stringify({ error: error.message.slice(0, 500) }), job.data.voiceId, job.data.patientId]));
});

const adminPool = env.DATABASE_ADMIN_URL ? new Pool({ connectionString: env.DATABASE_ADMIN_URL, application_name: "salus-reminder-worker" }) : null;
async function deliverDueReminders() {
  if (!adminPool) return;
  const due = await adminPool.query<{ task_id: string; patient_id: string; recipient_id: string; email_protected: string | null; email_enabled: boolean; in_app_enabled: boolean; push_enabled: boolean }>(`
    SELECT t.id task_id,t.patient_id,COALESCE(t.assigned_to,t.created_by) recipient_id,u.email_protected,
      COALESCE(np.email_enabled,true) email_enabled,COALESCE(np.in_app_enabled,true) in_app_enabled,COALESCE(np.push_enabled,false) push_enabled
    FROM tasks t JOIN users u ON u.id=COALESCE(t.assigned_to,t.created_by) JOIN patients p ON p.id=t.patient_id
    LEFT JOIN notification_preferences np ON np.patient_id=t.patient_id AND np.user_id=COALESCE(t.assigned_to,t.created_by)
    WHERE t.status='open' AND t.reminder_at<=now() AND (t.last_reminded_at IS NULL OR t.last_reminded_at<t.reminder_at)
      AND (COALESCE(np.email_enabled,true) OR COALESCE(np.in_app_enabled,true) OR COALESCE(np.push_enabled,false))
      AND (np.quiet_start IS NULL OR np.quiet_end IS NULL OR CASE WHEN np.quiet_start<np.quiet_end
        THEN NOT ((now() AT TIME ZONE np.timezone)::time>=np.quiet_start AND (now() AT TIME ZONE np.timezone)::time<np.quiet_end)
        ELSE NOT ((now() AT TIME ZONE np.timezone)::time>=np.quiet_start OR (now() AT TIME ZONE np.timezone)::time<np.quiet_end) END)
    ORDER BY t.reminder_at LIMIT 100`);
  for (const item of due.rows) {
    const deliveryWindow = new Date().toISOString().slice(0, 13);
    try {
      if (item.in_app_enabled) await adminPool.query(`INSERT INTO notification_deliveries(patient_id,task_id,recipient_id,channel,status,idempotency_key) VALUES($1,$2,$3,'in_app','delivered',$4) ON CONFLICT(idempotency_key) DO NOTHING`, [item.patient_id, item.task_id, item.recipient_id, `in-app:${item.task_id}:${deliveryWindow}`]);
      if (item.email_enabled) {
        if (!item.email_protected) throw new Error("Protected notification destination is unavailable");
        const email = await unprotectText(item.email_protected, privacyTraceId(), "daily_care");
        await sendMail(email, "You have a Salus reminder", "A care reminder is ready. Sign in to Salus to view it securely.");
        await adminPool.query(`INSERT INTO notification_deliveries(patient_id,task_id,recipient_id,channel,status,idempotency_key) VALUES($1,$2,$3,'email','delivered',$4) ON CONFLICT(idempotency_key) DO NOTHING`, [item.patient_id, item.task_id, item.recipient_id, `email:${item.task_id}:${deliveryWindow}`]);
      }
      if (item.push_enabled && pushConfigured) {
        const subscriptions = await adminPool.query<{ id: string; endpoint: string; p256dh: string; auth: string }>("SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1 AND revoked_at IS NULL", [item.recipient_id]);
        for (const subscription of subscriptions.rows) {
          const idempotencyKey = `push:${item.task_id}:${subscription.id}:${deliveryWindow}`;
          try {
            await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: "You have a Salus reminder", body: "Sign in to view it securely.", url: "/dashboard" }), { TTL: 60 * 60 });
            await adminPool.query(`INSERT INTO notification_deliveries(patient_id,task_id,recipient_id,channel,status,idempotency_key) VALUES($1,$2,$3,'push','delivered',$4) ON CONFLICT(idempotency_key) DO NOTHING`, [item.patient_id, item.task_id, item.recipient_id, idempotencyKey]);
          } catch (error) {
            const statusCode = error && typeof error === "object" && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : undefined;
            if (statusCode === 404 || statusCode === 410) await adminPool.query("UPDATE push_subscriptions SET revoked_at=now() WHERE id=$1", [subscription.id]);
            await adminPool.query(`INSERT INTO notification_deliveries(patient_id,task_id,recipient_id,channel,status,idempotency_key,error) VALUES($1,$2,$3,'push','failed',$4,$5) ON CONFLICT(idempotency_key) DO UPDATE SET status='failed',error=EXCLUDED.error,attempted_at=now()`, [item.patient_id, item.task_id, item.recipient_id, idempotencyKey, error instanceof Error ? error.message.slice(0, 500) : "push delivery failed"]);
          }
        }
      }
      await adminPool.query("UPDATE tasks SET last_reminded_at=now() WHERE id=$1", [item.task_id]);
    } catch (error) {
      await adminPool.query(`INSERT INTO notification_deliveries(patient_id,task_id,recipient_id,channel,status,idempotency_key,error) VALUES($1,$2,$3,'email','failed',$4,$5) ON CONFLICT(idempotency_key) DO UPDATE SET status='failed',error=EXCLUDED.error,attempted_at=now()`, [item.patient_id, item.task_id, item.recipient_id, `email:${item.task_id}:${deliveryWindow}`, error instanceof Error ? error.message : "delivery failed"]);
    }
  }
}
setInterval(() => void deliverDueReminders(), 60_000); void deliverDueReminders();
console.log("Salus worker started");
