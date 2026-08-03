import { z } from "zod";

const timelineCategorySchema = z.enum(["symptom", "meal", "hydration", "sleep", "mood", "fall", "note", "medication", "appointment", "care_plan", "emergency"]);

export const documentMedicationFactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  dosage: z.string().trim().min(1).max(120),
  route: z.string().trim().min(1).max(80),
  schedule: z.string().trim().min(1).max(300),
  instructions: z.string().trim().max(2000).optional(),
  conflict: z.object({ type: z.string().max(100), verifiedDosage: z.string().max(120) }).optional(),
});

export const documentAppointmentFactSchema = z.object({
  startsAt: z.string().datetime(),
  providerName: z.string().trim().max(160).optional(),
  location: z.string().trim().max(300).optional(),
  reason: z.string().trim().max(1000).optional(),
});

export const documentTaskFactSchema = z.object({
  title: z.string().trim().min(1).max(280),
  dueAt: z.string().datetime().optional(),
  reminderAt: z.string().datetime().optional(),
});

export const documentTimelineFactSchema = z.object({
  occurredAt: z.string().datetime(),
  category: timelineCategorySchema,
  summary: z.string().trim().min(1).max(4000),
});

export const documentPatientIdentityFactSchema = z.object({
  documentName: z.string().trim().min(1).max(200),
  documentDateOfBirth: z.string().date().optional(),
  expectedName: z.string().trim().min(1).max(200),
  expectedDateOfBirth: z.string().date().optional(),
  match: z.boolean(),
  conflict: z.object({ type: z.literal("patient_identity_mismatch") }).optional(),
});

export type ExtractedDocumentFact = {
  field: "document_type" | "document_summary" | "patient_identity" | "medication" | "appointment" | "task" | "timeline_event";
  proposedValue: Record<string, unknown>;
  sourceText: string;
};

function normalizePersonName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseWrittenDate(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : undefined;
}

export function extractDocumentPatientIdentity(text: string, patient: { preferredName: string; legalName?: string | null; dateOfBirth?: string | Date | null }): ExtractedDocumentFact | undefined {
  const documentName = text.match(/(?:^|\n)PATIENT\s*\n?([^\n]{1,200})/i)?.[1]?.trim();
  if (!documentName || /date of birth/i.test(documentName)) return undefined;
  const documentDateOfBirth = parseWrittenDate(text.match(/DATE OF BIRTH\s*\n?([^\n]{4,60})/i)?.[1]?.trim());
  const expectedNames = [patient.preferredName, patient.legalName].filter((value): value is string => Boolean(value)).map(normalizePersonName);
  const nameMatch = expectedNames.includes(normalizePersonName(documentName));
  const expectedDateOfBirth = patient.dateOfBirth instanceof Date ? patient.dateOfBirth.toISOString().slice(0, 10) : patient.dateOfBirth ?? undefined;
  const dateMatch = !documentDateOfBirth || !expectedDateOfBirth || documentDateOfBirth === expectedDateOfBirth;
  const match = nameMatch && dateMatch;
  return {
    field: "patient_identity",
    proposedValue: documentPatientIdentityFactSchema.parse({
      documentName,
      ...(documentDateOfBirth ? { documentDateOfBirth } : {}),
      expectedName: patient.legalName ?? patient.preferredName,
      ...(expectedDateOfBirth ? { expectedDateOfBirth } : {}),
      match,
      ...(!match ? { conflict: { type: "patient_identity_mismatch" as const } } : {}),
    }),
    sourceText: documentName,
  };
}

export function classifyDocumentText(text: string) {
  if (/\b(?:medication|prescription|dosage|tablet|capsule)\b/i.test(text)) return "medication_record";
  if (/\b(?:discharge|hospital|follow-up instructions)\b/i.test(text)) return "discharge_instructions";
  if (/\b(?:appointment|scheduled|clinic visit)\b/i.test(text)) return "appointment_record";
  if (/\b(?:care note|hydration|meal|sleep|mood)\b/i.test(text)) return "care_note";
  return "general_care_document";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function zonedDateTimeToIso(monthName: string, dayText: string, yearText: string, timeText: string, minuteText: string, meridiem: string, timeZone: string) {
  const month = MONTHS.indexOf(monthName.toLocaleLowerCase());
  let hour = Number(timeText) % 12;
  if (meridiem.toLocaleUpperCase() === "PM") hour += 12;
  const desiredUtc = Date.UTC(Number(yearText), month, Number(dayText), hour, Number(minuteText));
  let instant = desiredUtc;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    instant += desiredUtc - representedUtc;
  }
  return new Date(instant).toISOString();
}

function dateAtNoonToIso(match: RegExpMatchArray | null, timeZone: string) {
  if (!match) return new Date().toISOString();
  return zonedDateTimeToIso(match[1], match[2], match[3], "12", "00", "PM", timeZone);
}

function cleanMedicationName(value: string) {
  return value.replace(/^(?:medication|directions|status)\s*/i, "").trim();
}

function uniqueFacts(facts: ExtractedDocumentFact[]) {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.field}:${JSON.stringify(fact.proposedValue)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractDocumentFactProposals(text: string, timeZone = "UTC"): ExtractedDocumentFact[] {
  const normalized = text.replace(/\0/g, "").replace(/\r/g, "").trim();
  const facts: ExtractedDocumentFact[] = [
    { field: "document_type", proposedValue: { value: classifyDocumentText(normalized) }, sourceText: normalized.slice(0, 500) },
    { field: "document_summary", proposedValue: { text: normalized.slice(0, 1000) }, sourceText: normalized.slice(0, 1000) },
  ];

  const medicationPattern = /(?:^|\n)([A-Z][A-Za-z0-9 .'-]{1,80}?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL|IU))(?:,\s*(oral|topical|inhaled|injection|sublingual))?/gim;
  for (const match of normalized.matchAll(medicationPattern)) {
    const name = cleanMedicationName(match[1]);
    if (!name || /(?:blood pressure|pulse|weight|recorded value|created)/i.test(name)) continue;
    const context = normalized.slice(match.index ?? 0, (match.index ?? 0) + 320);
    const schedule = context.match(/Take\s+([^\n.]{3,160})/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "Follow the verified document instructions";
    const instructions = context.match(/(Follow\s+the\s+verified\s+(?:pharmacy|bottle)\s+label\.)/i)?.[1]?.replace(/\s+/g, " ");
    facts.push({
      field: "medication",
      proposedValue: documentMedicationFactSchema.parse({ name, dosage: match[2].replace(/\s+/g, " "), route: match[3]?.toLocaleLowerCase() ?? "unspecified", schedule, ...(instructions ? { instructions } : {}) }),
      sourceText: match[0].trim(),
    });
  }

  const appointmentMatch = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (appointmentMatch) {
    const appointmentContext = normalized.slice(appointmentMatch.index ?? 0, (appointmentMatch.index ?? 0) + 400);
    const providerName = appointmentContext.match(/Dr\.[ \t]+[A-Z][a-z'-]+[ \t]+[A-Z][a-z'-]+/)?.[0];
    const afterProvider = providerName ? appointmentContext.slice((appointmentContext.indexOf(providerName)) + providerName.length) : appointmentContext;
    const location = afterProvider.match(/^([A-Z][A-Za-z&' -]{2,80}(?:Clinic|Hospital|Medical Center|Care Center))/)?.[1]
      ?? normalized.match(/\b[A-Z][A-Za-z&' -]{2,80}(?:Clinic|Hospital|Medical Center|Care Center)\b/)?.[0];
    const reason = normalized.match(/\bRoutine follow-up\b/i)?.[0];
    facts.push({
      field: "appointment",
      proposedValue: documentAppointmentFactSchema.parse({
        startsAt: zonedDateTimeToIso(appointmentMatch[1], appointmentMatch[2], appointmentMatch[3], appointmentMatch[4], appointmentMatch[5], appointmentMatch[6], timeZone),
        ...(providerName ? { providerName } : {}),
        ...(location ? { location } : {}),
        ...(reason ? { reason } : {}),
      }),
      sourceText: appointmentMatch[0],
    });
  }

  for (const taskMatch of normalized.matchAll(/(?:^|\n|\d+\.\s*)(Offer\s+[^.\n]{3,220}|Check\s+[^.\n]{3,220})\./gim)) {
    facts.push({ field: "task", proposedValue: documentTaskFactSchema.parse({ title: taskMatch[1].replace(/\s+/g, " ").trim() }), sourceText: taskMatch[0].trim() });
  }

  const visitDateMatch = normalized.match(/VISIT DATE\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i);
  const observationParts: string[] = [];
  const bloodPressure = normalized.match(/Blood pressure\s*(\d{2,3}\/\d{2,3}\s*mmHg)/i)?.[1];
  const pulse = normalized.match(/Pulse\s*(\d{2,3}\s*beats\/min)/i)?.[1];
  const weight = normalized.match(/Weight\s*(\d+(?:\.\d+)?\s*lb)/i)?.[1];
  if (bloodPressure) observationParts.push(`blood pressure ${bloodPressure}`);
  if (pulse) observationParts.push(`pulse ${pulse}`);
  if (weight) observationParts.push(`weight ${weight}`);
  if (/no falls since the prior visit/i.test(normalized)) observationParts.push("no falls since the prior visit");
  if (observationParts.length) {
    const summary = `Clinic follow-up: ${observationParts.join(", ")}.`;
    facts.push({ field: "timeline_event", proposedValue: documentTimelineFactSchema.parse({ occurredAt: dateAtNoonToIso(visitDateMatch, timeZone), category: "note", summary }), sourceText: summary });
  }

  return uniqueFacts(facts);
}
