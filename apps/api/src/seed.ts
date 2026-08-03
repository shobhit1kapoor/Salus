import "dotenv/config";
import { Pool } from "pg";
import { hashPassword } from "./auth.js";
import { privacyTraceId, protectText, recordProtectionReceipt } from "./privacy.js";

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required");
const email = process.env.SEED_REVIEWER_EMAIL ?? "reviewer@salus.local";
const password = process.env.SEED_REVIEWER_PASSWORD;
if (!password || password.length < 12) throw new Error("SEED_REVIEWER_PASSWORD with at least 12 characters is required");

const pool = new Pool({ connectionString, application_name: "salus-protected-seed" });
const client = await pool.connect();
const protectJson = async (value: unknown, traceId: string) => protectText(JSON.stringify(value), traceId, "daily_care");

try {
  // Seed data deliberately traverses the exact same privacy boundary as user data.
  const identityTrace = privacyTraceId();
  const [protectedEmail, protectedName, protectedPreferred, protectedLegal, protectedDob, protectedProfile] = await Promise.all([
    protectText(email.toLowerCase(), identityTrace, "records_administration"),
    protectText("Alex Morgan", identityTrace, "records_administration"),
    protectText("Evelyn", identityTrace, "records_administration"),
    protectText("Evelyn Carter", identityTrace, "records_administration"),
    protectText("1942-08-18", identityTrace, "records_administration"),
    protectJson({ preferredName: "Evelyn", legalName: "Evelyn Carter", dateOfBirth: "1942-08-18", pronouns: "she/her" }, identityTrace)
  ]);
  await client.query("BEGIN");
  const user = (await client.query<{ id: string }>(`INSERT INTO users(email,email_protected,password_hash,display_name,display_name_protected,identity_fingerprint,email_verified_at)
    VALUES($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (identity_fingerprint) WHERE identity_fingerprint IS NOT NULL AND deleted_at IS NULL
    DO UPDATE SET email=EXCLUDED.email,email_protected=EXCLUDED.email_protected,password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name,display_name_protected=EXCLUDED.display_name_protected,email_verified_at=now()
    RETURNING id`,
    [protectedEmail.aiSafeText, protectedEmail.canonicalProtected, await hashPassword(password), protectedName.aiSafeText, protectedName.canonicalProtected, protectedEmail.fingerprint])).rows[0];
  const patient = (await client.query<{ id: string }>(`INSERT INTO patients(preferred_name,legal_name,date_of_birth,pronouns,language,timezone,created_by,profile_type,relationship,authority_status,preferred_name_protected,legal_name_protected,date_of_birth_protected,profile_details_protected,identity_fingerprint)
    SELECT $1,$2,NULL,$3,'en','America/Chicago',$4,'dependent','parent','caregiver_attested',$5,$6,$7,$8,$9
    WHERE NOT EXISTS (SELECT 1 FROM patients WHERE identity_fingerprint=$9 AND created_by=$4) RETURNING id`,
    [protectedPreferred.aiSafeText, protectedLegal.aiSafeText, "she/her", user.id, protectedPreferred.canonicalProtected, protectedLegal.canonicalProtected, protectedDob.canonicalProtected, protectedProfile.canonicalProtected, protectedPreferred.fingerprint])).rows[0]
    ?? (await client.query<{ id: string }>("SELECT id FROM patients WHERE identity_fingerprint=$1 AND created_by=$2 LIMIT 1", [protectedPreferred.fingerprint, user.id])).rows[0];
  await client.query(`INSERT INTO patient_members(patient_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT(patient_id,user_id) DO UPDATE SET role='owner',revoked_at=NULL`, [patient.id, user.id]);
  await client.query(`INSERT INTO access_grants(patient_id,grantee_id,issued_by,purposes,scopes,reveal_level,consent_version)
    SELECT $1,$2,$2,ARRAY['daily_care','medication_support','appointment_preparation','records_administration','emergency_support'],ARRAY['profile','timeline','medications','labs','follow_ups','documents','assistant','export'],'sensitive',1
    WHERE NOT EXISTS (SELECT 1 FROM access_grants WHERE patient_id=$1 AND grantee_id=$2 AND revoked_at IS NULL)`, [patient.id, user.id]);

  const existing = Number((await client.query<{ count: string }>("SELECT count(*) FROM timeline_events WHERE patient_id=$1", [patient.id])).rows[0].count);
  if (!existing) {
    for (const [days, category, summary] of [
      [3, "sleep", "Slept through the night and woke at the usual time."],
      [2, "hydration", "Finished three glasses of water before dinner."],
      [1, "mood", "Enjoyed a phone call with her sister and seemed cheerful."]
    ] as const) {
      const protectedValue = await protectText(summary, privacyTraceId(), "daily_care");
      await client.query("INSERT INTO timeline_events(patient_id,occurred_at,category,summary,summary_protected,source,created_by) VALUES($1,now()-$2::int*interval '1 day',$3,$4,$5,'caregiver',$6)", [patient.id, days, category, protectedValue.aiSafeText, protectedValue.canonicalProtected, user.id]);
    }
    for (const medication of [
      { name: "Lisinopril", dosage: "10 mg", route: "oral", schedule: "Every morning with breakfast", instructions: "Follow the verified pharmacy label." },
      { name: "Vitamin D3", dosage: "1000 IU", route: "oral", schedule: "Every evening", instructions: "Follow the verified bottle label." }
    ]) {
      const value = await protectJson(medication, privacyTraceId());
      const safe = JSON.parse(value.aiSafeText) as typeof medication;
      await client.query("INSERT INTO medications(patient_id,name,normalized_name,dosage,route,schedule,instructions,details_protected,status,verified_at,verified_by,created_by) VALUES($1,$2,lower($2),$3,$4,$5,$6,$7,'verified',now(),$8,$8)", [patient.id, safe.name, safe.dosage, safe.route, safe.schedule, safe.instructions, value.canonicalProtected, user.id]);
    }
    for (const task of ["Offer water with lunch", "Check evening medication record"]) {
      const value = await protectText(task, privacyTraceId(), "daily_care");
      await client.query("INSERT INTO tasks(patient_id,title,title_protected,due_at,reminder_at,assigned_to,created_by) VALUES($1,$2,$3,now()+interval '1 day',now()+interval '23 hours',$4,$4)", [patient.id, value.aiSafeText, value.canonicalProtected, user.id]);
    }
    const appointment = await protectJson({ providerName: "Dr. Maya Patel", location: "Community Family Clinic", reason: "Routine follow-up" }, privacyTraceId());
    const appointmentSafe = JSON.parse(appointment.aiSafeText) as { providerName: string; location: string; reason: string };
    await client.query("INSERT INTO appointments(patient_id,starts_at,provider_name,location,reason,details_protected,created_by) VALUES($1,now()+interval '8 days',$2,$3,$4,$5,$6)", [patient.id, appointmentSafe.providerName, appointmentSafe.location, appointmentSafe.reason, appointment.canonicalProtected, user.id]);
    const consent = await protectText("Synthetic reviewer profile; no real person or PHI.", privacyTraceId(), "records_administration");
    await client.query("INSERT INTO consent_records(patient_id,consent_type,status,recorded_by,evidence,evidence_protected) VALUES($1,'synthetic_challenge_data','granted',$2,$3,$4)", [patient.id, user.id, consent.aiSafeText, consent.canonicalProtected]);
  }
  await recordProtectionReceipt(client, { traceId: identityTrace, patientId: patient.id, actorId: user.id, operation: "synthetic.seed", purpose: "records_administration", status: "protected", provider: protectedProfile.provider, entityCounts: { ...protectedEmail.entityCounts, ...protectedProfile.entityCounts }, stages: [
    { stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed" }, { stage: "persist", outcome: "passed", detail: "seed passed through the production privacy boundary" }, { stage: "egress", outcome: "passed", detail: "synthetic identifiers absent from raw persistence" }
  ] });
  await client.query("COMMIT");
  console.log("Synthetic reviewer seeded through Protegrity. The destination identifier was not logged.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
