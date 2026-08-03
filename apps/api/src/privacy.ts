import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CarePurpose, CareScope, ProtectedEnvelope, ProtectionStage } from "@salus/contracts";
import { env } from "./env.js";
import { one, type Db } from "./db.js";

export class PrivacyUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "PrivacyUnavailableError";
    this.status = status;
  }
}

type Discovery = { entityCounts: Record<string, number>; total: number };
type ProtectResult = {
  canonicalProtected: string;
  aiSafeText: string;
  fingerprint: string;
  discovery: Discovery;
  provider: "protegrity" | "test";
  durationMs: number;
};
export type GuardrailResult = { outcome: "approved" | "rejected"; score: number; processor: string; explanation?: string; provider: string; durationMs: number };

async function gateway<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PRIVACY_GATEWAY_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.PRIVACY_GATEWAY_URL.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null) as { detail?: string } | null;
      throw new PrivacyUnavailableError(details?.detail ?? `Privacy gateway rejected the operation (${response.status}).`, response.status);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof PrivacyUnavailableError) throw error;
    throw new PrivacyUnavailableError("Protegrity privacy controls are unavailable; the operation failed closed.");
  } finally {
    clearTimeout(timeout);
  }
}

export function privacyTraceId() { return randomUUID(); }

type ToolCapability = { profileId: string; actorId: string; purpose: CarePurpose; scopes: CareScope[]; traceId: string; issuedAt: number; expiresAt: number };
export function issueToolCapability(input: Omit<ToolCapability, "issuedAt" | "expiresAt">, ttlSeconds = 60) {
  const issuedAt = Math.floor(Date.now() / 1000); const payload: ToolCapability = { ...input, issuedAt, expiresAt: issuedAt + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.TOOL_CAPABILITY_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyToolCapability(token: string, expected: Pick<ToolCapability, "profileId" | "actorId" | "purpose" | "traceId">, requiredScope: CareScope) {
  const parts = token.split("."); if (parts.length !== 2) return false;
  const [encoded, signature] = parts; if (!encoded || !signature) return false;
  const calculated = createHmac("sha256", env.TOOL_CAPABILITY_SECRET).update(encoded).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.toString("base64url") !== signature || supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ToolCapability;
    return payload.profileId === expected.profileId && payload.actorId === expected.actorId && payload.purpose === expected.purpose && payload.traceId === expected.traceId && payload.expiresAt > Math.floor(Date.now() / 1000) && payload.scopes.includes(requiredScope);
  } catch { return false; }
}

export async function privacyHealth() {
  return gateway<{ status: string; mode: string; protegrityConfigured: boolean }>("/health");
}

export async function protectText(text: string, traceId: string, purpose: string): Promise<ProtectedEnvelope & { provider: string; durationMs: number }> {
  const result = await gateway<ProtectResult>("/v1/protect", { text, traceId, purpose });
  if (!result.canonicalProtected || !result.aiSafeText || !/^[a-f0-9]{64}$/.test(result.fingerprint)) {
    throw new PrivacyUnavailableError("Privacy gateway returned an invalid protected envelope.");
  }
  return {
    version: "protegrity-de-1",
    canonicalProtected: result.canonicalProtected,
    aiSafeText: result.aiSafeText,
    fingerprint: result.fingerprint,
    entityCounts: result.discovery.entityCounts,
    provider: result.provider,
    durationMs: result.durationMs
  };
}

export async function unprotectText(canonicalProtected: string, traceId: string, purpose: string) {
  const result = await gateway<{ text: string }>("/v1/unprotect", { canonicalProtected, traceId, purpose });
  return result.text;
}

export async function wrapObjectKey(value: string, traceId: string) {
  return (await gateway<{ wrappedKey: string }>("/v1/keys/wrap", { value, traceId })).wrappedKey;
}

export async function unwrapObjectKey(value: string, traceId: string) {
  return (await gateway<{ value: string }>("/v1/keys/unwrap", { value, traceId })).value;
}

export async function scanGuardrail(text: string, traceId: string, direction: "input" | "output") {
  return gateway<GuardrailResult>("/v1/guardrails/scan", { text, traceId, direction });
}

export async function validateEgress(text: string, traceId: string, prohibitedValues: string[] = []) {
  return gateway<{ safe: boolean; discovery: Discovery; canaryMatches: number }>("/v1/egress/validate", { text, traceId, prohibitedValues });
}

export async function activePurposeGrant(db: Db, patientId: string, purpose: CarePurpose, scope: CareScope) {
  return Boolean((await one<{ allowed: boolean }>(db, "SELECT active_grant($1,$2,$3) AS allowed", [patientId, purpose, scope]))?.allowed);
}

export type ReceiptInput = {
  traceId: string;
  patientId?: string;
  actorId?: string;
  operation: string;
  purpose: string;
  status: "protected" | "blocked" | "revealed" | "failed";
  stages: ProtectionStage[];
  entityCounts?: Record<string, number>;
  provider?: string;
  rawLeakCount?: number;
};

export async function recordProtectionReceipt(db: Db, input: ReceiptInput) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('salus_protection_receipt_chain'))");
  const prior = await one<{ event_hash: string }>(db, "SELECT event_hash FROM protection_receipts ORDER BY created_at DESC,id DESC LIMIT 1");
  const previousHash = prior?.event_hash ?? null;
  const eventHash = createHash("sha256").update(JSON.stringify({
    previousHash,
    traceId: input.traceId,
    patientId: input.patientId ?? null,
    actorId: input.actorId ?? null,
    operation: input.operation,
    purpose: input.purpose,
    status: input.status,
    stages: input.stages,
    entityCounts: input.entityCounts ?? {},
    provider: input.provider ?? "protegrity",
    rawLeakCount: input.rawLeakCount ?? 0
  })).digest("hex");
  return one<{ id: string; event_hash: string }>(db, `INSERT INTO protection_receipts(trace_id,patient_id,actor_id,operation,purpose,status,stages,entity_counts,provider,raw_leak_count,previous_hash,event_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,event_hash`, [
      input.traceId, input.patientId ?? null, input.actorId ?? null, input.operation, input.purpose, input.status,
      JSON.stringify(input.stages), JSON.stringify(input.entityCounts ?? {}), input.provider ?? "protegrity",
      input.rawLeakCount ?? 0, previousHash, eventHash
    ]);
}
