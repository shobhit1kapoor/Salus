import { describe, expect, it } from "vitest";
import { extractDocumentFactProposals, extractDocumentPatientIdentity } from "@salus/contracts";

const demoText = `
POST-VISIT CARE SUMMARY
VISIT DATE
July 29, 2026
VISIT TYPE
Routine follow-up
Evelyn reported having no falls since the prior visit.
Blood pressure128/76 mmHg
Pulse72 beats/min
Weight142 lb
Medication reconciliation
Lisinopril 10 mg, oralTake every morning with breakfast. Follow the verified pharmacy label.
Vitamin D3 1000 IU, oralTake every evening. Follow the verified bottle label.
1. Offer water with lunch and record hydration.
2. Check the evening medication record at 7:00 PM.
NEXT APPOINTMENT
August 8, 2026 at 10:30 AM
Dr. Maya Patel
Community Family Clinic
`;

describe("document fact extraction", () => {
  it("creates structured, reviewable facts from the synthetic care summary", () => {
    const facts = extractDocumentFactProposals(demoText, "America/Chicago");
    const medications = facts.filter((fact) => fact.field === "medication").map((fact) => fact.proposedValue);
    expect(medications).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Lisinopril", dosage: "10 mg", route: "oral", schedule: "every morning with breakfast", instructions: "Follow the verified pharmacy label." }),
      expect.objectContaining({ name: "Vitamin D3", dosage: "1000 IU", route: "oral", schedule: "every evening", instructions: "Follow the verified bottle label." }),
    ]));
    expect(facts.filter((fact) => fact.field === "task")).toHaveLength(2);
    expect(facts.find((fact) => fact.field === "appointment")?.proposedValue).toEqual(expect.objectContaining({
      startsAt: "2026-08-08T15:30:00.000Z",
      providerName: "Dr. Maya Patel",
      location: "Community Family Clinic",
      reason: "Routine follow-up",
    }));
    expect(facts.find((fact) => fact.field === "timeline_event")?.proposedValue).toEqual(expect.objectContaining({
      occurredAt: "2026-07-29T17:00:00.000Z",
      summary: expect.stringContaining("blood pressure 128/76 mmHg"),
    }));
  });

  it("detects a document uploaded to the wrong patient workspace", () => {
    expect(extractDocumentPatientIdentity("PATIENT\nEvelyn Carter\nDATE OF BIRTH\nAugust 18, 1942", { preferredName: "qwe", dateOfBirth: "2026-07-30" })?.proposedValue).toEqual(expect.objectContaining({
      documentName: "Evelyn Carter",
      expectedName: "qwe",
      match: false,
      conflict: { type: "patient_identity_mismatch" },
    }));
    expect(extractDocumentPatientIdentity("PATIENT\nEvelyn Carter\nDATE OF BIRTH\nAugust 18, 1942", { preferredName: "Evelyn", legalName: "Evelyn Carter", dateOfBirth: "1942-08-18" })?.proposedValue).toEqual(expect.objectContaining({ match: true }));
    expect(extractDocumentPatientIdentity("PATIENT\nEvelyn Carter\nDATE OF BIRTH\nAugust 18, 1942", { preferredName: "Evelyn", legalName: "Evelyn Carter", dateOfBirth: new Date("1942-08-18T00:00:00.000Z") })?.proposedValue).toEqual(expect.objectContaining({ match: true }));
  });
});
