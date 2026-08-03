import { z } from "zod";

export const profileTypeSchema = z.enum(["self", "dependent"]);
export const authorityStatusSchema = z.enum(["self_attested", "caregiver_attested", "verified"]);
export const carePurposeSchema = z.enum(["daily_care", "medication_support", "appointment_preparation", "records_administration", "emergency_support"]);
export const careScopeSchema = z.enum(["profile", "timeline", "medications", "labs", "follow_ups", "documents", "assistant", "export"]);
export const revealLevelSchema = z.enum(["routine", "sensitive", "break_glass"]);
export type CarePurpose = z.infer<typeof carePurposeSchema>;
export type CareScope = z.infer<typeof careScopeSchema>;

export const createHealthProfileSchema = z.object({
  profileType: profileTypeSchema,
  preferredName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional(),
  dateOfBirth: z.string().date().optional(),
  relationship: z.string().trim().min(2).max(80).optional(),
  pronouns: z.string().trim().max(80).optional(),
  language: z.string().trim().min(2).max(20).default("en"),
  timezone: z.string().trim().min(1).max(80).default("America/Chicago")
}).superRefine((value, context) => {
  if (value.profileType === "dependent" && !value.relationship) context.addIssue({ code: "custom", path: ["relationship"], message: "Relationship is required for a dependent profile." });
});

export const accessGrantSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  granteeId: z.string().uuid(),
  purposes: z.array(carePurposeSchema).min(1),
  scopes: z.array(careScopeSchema).min(1),
  revealLevel: revealLevelSchema,
  consentVersion: z.number().int().positive(),
  validFrom: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable()
});
export type AccessGrant = z.infer<typeof accessGrantSchema>;

export const createAccessGrantSchema = z.object({
  granteeId: z.string().uuid(),
  purposes: z.array(carePurposeSchema).min(1),
  scopes: z.array(careScopeSchema).min(1),
  revealLevel: revealLevelSchema.default("routine"),
  expiresAt: z.string().datetime().optional()
});

export const revealRequestSchema = z.object({
  resourceType: z.string().trim().min(1).max(80),
  resourceId: z.string().uuid().optional(),
  fields: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  purpose: carePurposeSchema,
  reason: z.string().trim().min(8).max(1000),
  breakGlass: z.boolean().default(false)
});

export const protectionStageSchema = z.object({
  stage: z.enum(["authorize", "discover", "protect", "guardrail_input", "persist", "retrieve", "embed", "model", "guardrail_output", "leak_check", "reveal", "egress"]),
  outcome: z.enum(["passed", "blocked", "skipped", "failed"]),
  durationMs: z.number().int().nonnegative().optional(),
  detail: z.string().max(200).optional()
});
export type ProtectionStage = z.infer<typeof protectionStageSchema>;

export const protectionReceiptSchema = z.object({
  id: z.string().uuid(),
  traceId: z.string().uuid(),
  operation: z.string(),
  purpose: z.string(),
  status: z.enum(["protected", "blocked", "revealed", "failed"]),
  stages: z.array(protectionStageSchema),
  entityCounts: z.record(z.number().int().nonnegative()),
  provider: z.string(),
  rawLeakCount: z.number().int().nonnegative(),
  eventHash: z.string(),
  createdAt: z.string().datetime()
});
export type ProtectionReceipt = z.infer<typeof protectionReceiptSchema>;

export const protectedEnvelopeSchema = z.object({
  version: z.literal("protegrity-de-1"),
  canonicalProtected: z.string().min(1),
  aiSafeText: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  entityCounts: z.record(z.number().int().nonnegative())
});
export type ProtectedEnvelope = z.infer<typeof protectedEnvelopeSchema>;
