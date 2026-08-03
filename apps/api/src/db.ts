import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { env } from "./env.js";

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 12, application_name: "salus-api" });
export type Db = Pick<PoolClient, "query">;

export async function withUser<T>(userId: string, callback: (db: Db) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function one<T extends QueryResultRow>(db: Db, text: string, values: unknown[] = []) {
  const result = await db.query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function audit(db: Db, actorId: string, action: string, resourceType: string, resourceId?: string, patientId?: string, metadata: Record<string, unknown> = {}) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('salus_audit_event_chain'))");
  const previous = await one<{ event_hash: string }>(db, "SELECT event_hash FROM audit_events WHERE event_hash IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1");
  const id = randomUUID(); const createdAt = new Date().toISOString(); const previousHash = previous?.event_hash ?? null;
  const eventHash = createHash("sha256").update(JSON.stringify({ id, previousHash, actorId, patientId: patientId ?? null, action, resourceType, resourceId: resourceId ?? null, metadata, createdAt })).digest("hex");
  await db.query("INSERT INTO audit_events (id,actor_id,patient_id,action,resource_type,resource_id,metadata,previous_hash,event_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, actorId, patientId ?? null, action, resourceType, resourceId ?? null, JSON.stringify(metadata), previousHash, eventHash, createdAt]);
}
