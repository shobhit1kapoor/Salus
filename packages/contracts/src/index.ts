import { z } from "zod";

export * from "./document-facts.js";
export * from "./privacy.js";

export const roleSchema = z.enum(["owner", "care_coordinator", "caregiver", "viewer"]);
export type CaregiverRole = z.infer<typeof roleSchema>;

export const patientSchema = z.object({
  id: z.string().uuid(),
  preferredName: z.string().min(1).max(120),
  dateOfBirth: z.string().date().nullable(),
  pronouns: z.string().max(80).nullable(),
  language: z.string().max(20),
  archivedAt: z.string().datetime().nullable().optional()
});
export type Patient = z.infer<typeof patientSchema>;

export const createPatientSchema = z.object({
  preferredName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional(),
  dateOfBirth: z.string().date().optional(),
  pronouns: z.string().trim().max(80).optional(),
  language: z.string().trim().min(2).max(20).default("en"),
  timezone: z.string().trim().min(1).max(80).default("America/Chicago")
});

export const createTimelineEventSchema = z.object({
  occurredAt: z.string().datetime(),
  category: z.enum(["symptom", "meal", "hydration", "sleep", "mood", "fall", "note", "medication", "appointment", "care_plan", "emergency"]),
  summary: z.string().trim().min(1).max(4000),
  source: z.enum(["caregiver", "voice", "document", "ai"]).default("caregiver")
});

export const medicationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  dosage: z.string().trim().min(1).max(120),
  route: z.string().trim().min(1).max(80),
  schedule: z.string().trim().min(1).max(300),
  instructions: z.string().trim().max(2000).optional()
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(280),
  dueAt: z.string().datetime().optional(),
  reminderAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional()
});

export const chatMessageSchema = z.object({ message: z.string().trim().min(1).max(12000) });

export const safetyResultSchema = z.object({
  emergency: z.boolean(),
  categories: z.array(z.string()),
  message: z.string()
});

export const aiReplySchema = z.object({
  answer: z.string().min(1).max(8000),
  citations: z.array(z.object({ sourceId: z.string().uuid(), label: z.string().max(160) })).max(12),
  proposedEvent: z.object({ category: z.string(), summary: z.string() }).optional(),
  uncertainty: z.string().max(500).optional()
});
export type AiReply = z.infer<typeof aiReplySchema>;

export const fhirBundleSchema = z.object({ resourceType: z.literal("Bundle"), type: z.string(), entry: z.array(z.object({ resource: z.object({ resourceType: z.string() }).passthrough() })).default([]) }).passthrough();
