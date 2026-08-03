import type { FastifyReply, FastifyRequest } from "fastify";
import type { CaregiverRole } from "@salus/contracts";
import { currentUser } from "./auth.js";
import { type Db, one } from "./db.js";

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) { await reply.code(401).send({ code: "AUTH_REQUIRED", message: "Sign in required." }); return null; }
  return user;
}

export async function requirePatientRole(db: Db, patientId: string) {
  const row = await one<{ role: CaregiverRole }>(db, "SELECT role FROM patient_members WHERE patient_id=$1 AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND revoked_at IS NULL", [patientId]);
  return row?.role ?? null;
}
