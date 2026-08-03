"use client";

import { FormEvent, use, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Pill, Plus, ShieldCheck, X } from "lucide-react";
import { AppShell } from "../../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../../components/status";
import { api } from "../../../../lib/api";

type Medication = { id: string; name: string; dosage: string; route: string; schedule: string; status: string };
type Data = { patient: { id: string; preferredName: string; role?: string }; medications: Medication[] };
type Lab = { id: string; testName: string; result: string; units?: string; referenceRange?: string; collectedAt: string; status: string };

export default function MedicationsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [data, setData] = useState<Data | null>(null); const [labs, setLabs] = useState<Lab[]>([]);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [dialog, setDialog] = useState<"medication" | "lab" | null>(null);
  const load = useCallback(async () => { try { const [dashboard, values] = await Promise.all([api<Data>(`/v1/patients/${patientId}/dashboard?purpose=medication_support`), api<Lab[]>(`/v1/profiles/${patientId}/labs?purpose=medication_support`)]); setData(dashboard); setLabs(values); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load medication intelligence."); } }, [patientId]);
  useEffect(() => { void load(); }, [load]);

  const conflicts = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    for (const medication of data?.medications ?? []) { const key = medication.name.trim().toLocaleLowerCase(); const doses = groups.get(key) ?? new Set<string>(); doses.add(medication.dosage.trim().toLocaleLowerCase()); groups.set(key, doses); }
    return new Set([...groups.entries()].filter(([, doses]) => doses.size > 1).map(([name]) => name));
  }, [data]);

  async function addMedication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError("");
    try { await api(`/v1/patients/${patientId}/medications`, { method: "POST", body: JSON.stringify({ name: form.get("name"), dosage: form.get("dosage"), route: form.get("route"), schedule: form.get("schedule"), instructions: form.get("instructions") || undefined }) }); setDialog(null); setNotice("Medication proposed. It remains unverified until reviewed."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add the medication."); }
  }

  async function addLab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError("");
    try { await api(`/v1/profiles/${patientId}/labs`, { method: "POST", body: JSON.stringify({ testName: form.get("testName"), result: form.get("result"), units: form.get("units") || undefined, referenceRange: form.get("referenceRange") || undefined, collectedAt: new Date(String(form.get("collectedAt"))).toISOString(), purpose: "medication_support" }) }); setDialog(null); setNotice("Lab result protected and added to the medication-support view."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add the lab result."); }
  }

  async function verifyMedication(id: string) {
    if (!window.confirm("Confirm this medication against a source record or clinician instruction?")) return;
    try { await api(`/v1/patients/${patientId}/medications/${id}/verify`, { method: "POST" }); setNotice("Medication marked verified with an audit event."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Medication verification failed."); }
  }

  if (!data) return <AppShell>{error ? <ErrorMessage message={error} /> : <Loading />}</AppShell>;
  const proposed = data.medications.filter((item) => item.status !== "verified");
  return <AppShell patient={data.patient} purpose="Medication support"><div className="page-heading"><div><p className="overline">Source-linked intelligence</p><h1>Medications and labs</h1><p>Salus separates verified facts from protected AI suggestions. It never diagnoses or changes treatment.</p></div><div className="page-actions"><button className="secondary-button compact" onClick={() => setDialog("lab")}><Plus size={16} />Add lab</button><button className="primary-button compact" onClick={() => setDialog("medication")}><Plus size={16} />Propose medication</button></div></div>
    {error && <ErrorMessage message={error} />}{notice && <div className="message success" role="status">{notice}</div>}
    {(proposed.length > 0 || conflicts.size > 0) && <div className="safety-callout"><AlertTriangle /><div><strong>{proposed.length} unverified change{proposed.length === 1 ? "" : "s"}{conflicts.size ? ` · ${conflicts.size} dosage conflict${conflicts.size === 1 ? "" : "s"}` : ""}</strong><span>Confirm against the source document or with a clinician before relying on these entries.</span></div></div>}
    <div className="dashboard-grid"><section className="panel"><div className="panel-title"><div><p className="overline">Current record</p><h2>Medication list</h2></div><Pill /></div><div className="intelligence-list">{data.medications.map((medication) => { const conflict = conflicts.has(medication.name.trim().toLocaleLowerCase()); return <article key={medication.id} className={conflict ? "conflict-item" : ""}><div><strong>{medication.name}{conflict && <span className="inline-warning">Possible dosage conflict</span>}</strong><span>{medication.dosage} · {medication.route} · {medication.schedule}</span></div><div className="row-actions"><span className={`status ${medication.status}`}>{medication.status}</span>{medication.status !== "verified" && <button className="secondary-button compact" onClick={() => void verifyMedication(medication.id)}><CheckCircle2 size={15} />Verify</button>}</div></article>; })}</div></section>
    <section className="panel"><div className="panel-title"><div><p className="overline">Minimum necessary</p><h2>Relevant labs</h2></div><FlaskConical /></div><div className="intelligence-list">{labs.length ? labs.map((lab) => <article key={lab.id}><div><strong>{lab.testName}</strong><span>{lab.result} {lab.units} · {new Date(lab.collectedAt).toLocaleDateString()}{lab.referenceRange ? ` · reference ${lab.referenceRange}` : ""}</span></div><span className="status verified">{lab.status}</span></article>) : <p className="muted">No protected lab results have been added.</p>}</div></section></div>
    <div className="provenance-note"><ShieldCheck /><span><strong>How this view is protected</strong> Only the medication-support scope is queried. Direct identifiers stay tokenized; source facts remain distinguishable from AI suggestions and clinician verification.</span></div>

    {dialog && <div className="dialog-backdrop" onMouseDown={() => setDialog(null)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="med-dialog-title" onMouseDown={(event) => event.stopPropagation()}><button className="dialog-close icon-button" aria-label="Close" onClick={() => setDialog(null)}><X /></button><p className="overline">Protected clinical input</p><h2 id="med-dialog-title">{dialog === "lab" ? "Add a lab result" : "Propose a medication"}</h2>{dialog === "lab" ? <form className="stack" onSubmit={addLab}><label>Test name<input name="testName" required autoFocus /></label><div className="form-row"><label>Result<input name="result" required /></label><label>Units<input name="units" /></label></div><label>Reference range<input name="referenceRange" /></label><label>Collected at<input type="datetime-local" name="collectedAt" required /></label><button className="primary-button"><ShieldCheck size={16} />Protect and add result</button></form> : <form className="stack" onSubmit={addMedication}><label>Medication name<input name="name" required autoFocus /></label><div className="form-row"><label>Dosage<input name="dosage" required /></label><label>Route<input name="route" required placeholder="Oral" /></label></div><label>Schedule<input name="schedule" required placeholder="Every morning" /></label><label>Instructions<textarea name="instructions" rows={3} /></label><button className="primary-button"><ShieldCheck size={16} />Protect as unverified proposal</button></form>}</section></div>}
  </AppShell>;
}
