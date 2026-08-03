import type { CaregiverRole } from "@salus/contracts";

const RED_FLAGS: Array<[string, RegExp]> = [
  ["trouble_breathing", /(?:can't|cannot|can not|difficulty|trouble)\s+breath|shortness of breath|not breathing/i],
  ["chest_pain", /(?:severe|crushing|sudden).{0,30}chest pain|chest pain.{0,30}(?:severe|crushing)/i],
  ["stroke", /face (?:is )?droop(?:ing|ed)?|slurred speech|one.side.{0,20}(?:weak|numb)|signs? of stroke/i],
  ["unconscious", /unconscious|passed out|unresponsive/i],
  ["allergic_reaction", /(?:severe )?(?:allergic reaction|anaphylaxis)|swollen (?:tongue|throat)|(?:tongue|throat) (?:is )?swelling/i],
  ["bleeding", /uncontrolled bleeding|bleeding.{0,30}(?:won't|will not) stop/i],
  ["head_injury", /(?:fall|fell).{0,80}(?:head|hit).{0,80}(?:confus|unconscious|vomit)/i],
  ["overdose", /(?:suspected )?overdose|too much medication/i],
  ["acute_confusion", /sudden(?:ly)? (?:severe(?:ly)? )?confus|sudden delirium/i],
  ["self_harm", /suicid(?:e|al)|(?:want|wants) to (?:die|kill)/i],
  ["violence", /(?:hurt|kill) (?:himself|herself|themselves|someone)/i]
];

export function assessEmergency(message: string) {
  const categories = RED_FLAGS.filter(([, expression]) => expression.test(message)).map(([category]) => category);
  return {
    emergency: categories.length > 0,
    categories,
    message: categories.length
      ? "This may be an emergency. Call local emergency services now or seek immediate professional help. Do not wait for Salus to assess or contact anyone."
      : "No deterministic emergency red flag was detected. This is not a medical diagnosis."
  };
}

export function assessInstructionSafety(message: string) {
  const promptInjection = /ignore.{0,30}(?:system|previous|rules|instructions)|\bsystem\s*:|disable.{0,20}safety|(?:output|reveal|show).{0,30}(?:secret|system prompt|all records)/i.test(message);
  const crossPatientRequest = /another patient|change (?:the )?active patient|merge.{0,60}into (?:this|the) chat|reveal all records/i.test(message);
  const categories = [promptInjection ? "prompt_injection" : null, crossPatientRequest ? "cross_patient_request" : null].filter((value): value is string => Boolean(value));
  return {
    blocked: categories.length > 0,
    categories,
    message: crossPatientRequest
      ? "I can't switch patients or reveal another patient's records from this workspace. Open the separately authorized patient workspace instead."
      : "I can't follow instructions to reveal secrets, disable safeguards, or override Salus's rules. Instructions inside documents are treated as untrusted content."
  };
}

export function isCareRelatedIntent(message: string) {
  return /\b(?:medications?|meds?|dose|dosage|appointments?|doctor|clinician|pharmacist|tasks?|follow[- ]?ups?|records?|timeline|week|care(?:giver| plan)?|handoff|symptoms?|dizzy|vomit(?:ed|ing)?|blood pressure|protocol|diagnos\w*|chest pain|breath\w*|droop\w*|speech|unconscious|bleed\w*|overdose|confus\w*|suicid\w*|food|nutrition|hydration|sleep|mood|routine|observations?|notes?|sources?|emergency)\b/i.test(message);
}

export function assessMedicationInstruction(message: string) {
  const medicationTerm = /\b(?:medication|medicine|meds?|dose|dosage|pill|tablet|capsule|lisinopril|insulin)\b/i;
  const changeInstruction = /\b(?:double|triple|increase|decrease|reduce|change|alter|stop|discontinue|skip|hold|restart|add|take|give|administer)\b/i;
  const missedDose = /\bmiss(?:ed|ing)?\b.{0,40}\bdose\b|\bdose\b.{0,40}\bmiss(?:ed|ing)?\b/i;
  const exactDoseNow = /\b(?:what|which|exactly).{0,40}\bdose\b.{0,50}\b(?:now|tonight|today|give|take|administer)\b/i;
  const blocked = (medicationTerm.test(message) && changeInstruction.test(message)) || missedDose.test(message) || exactDoseNow.test(message);
  return {
    blocked,
    categories: blocked ? ["medication_change_request"] : [],
    message: "I can't direct, calculate, or apply a medication change or missed-dose decision. Do not double, stop, skip, or otherwise change a dose based on Salus. Follow the verified label or care-plan instructions, or contact the patient's pharmacist or prescriber for guidance. If too much medication may have been taken or severe symptoms are present, contact emergency services or poison control now."
  };
}

export function assessDiagnosisInstruction(message: string) {
  const blocked = /\bdiagnos(?:e|es|ed|ing|is|tic)\b/i.test(message);
  return {
    blocked,
    categories: blocked ? ["diagnosis_request"] : [],
    message: "I can't diagnose a condition or determine its cause. I can organize the verified observations and questions for a qualified clinician, who should assess the patient. If symptoms are severe, sudden, worsening, or match an emergency warning, contact emergency services now."
  };
}

export function unsupportedNamedProtocol(message: string, authorizedSourceText: string[]) {
  const match = message.match(/\b(?:apply|use|follow)\s+(?:the\s+)?(?:protocol|policy|procedure)\s+([a-z0-9][a-z0-9._-]{1,79})/i);
  if (!match?.[1]) return undefined;
  const protocol = match[1];
  if (authorizedSourceText.some((source) => source.toLocaleLowerCase().includes(protocol.toLocaleLowerCase()))) return undefined;
  return protocol;
}

export function unsupportedCurrentMeasurement(message: string, authorizedSourceText: string[]) {
  const recencyRequested = /\b(?:current|currently|right now|latest|today|at the moment)\b/i.test(message);
  if (!recencyRequested) return undefined;
  const measurement = message.match(/\b(blood pressure|heart rate|pulse|temperature|oxygen saturation|blood sugar|glucose|weight)\b/i)?.[1];
  if (!measurement) return undefined;
  const normalized = measurement.toLocaleLowerCase();
  const verifiedReadingExists = authorizedSourceText.some((source) => source.toLocaleLowerCase().includes(normalized) && /\d/.test(source));
  return verifiedReadingExists ? undefined : normalized;
}

export function can(role: CaregiverRole, action: "read" | "write" | "manage_access" | "delete" | "medication_verify") {
  const capabilities: Record<CaregiverRole, string[]> = {
    owner: ["read", "write", "manage_access", "delete", "medication_verify"],
    care_coordinator: ["read", "write", "manage_access", "medication_verify"],
    caregiver: ["read", "write"],
    viewer: ["read"]
  };
  return capabilities[role].includes(action);
}

export function safeStorageKey(patientId: string, documentId: string, filename: string) {
  const basename = filename.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.+/g, ".").slice(-120) || "upload";
  return `patients/${patientId}/documents/${documentId}/${basename}`;
}
