"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { Download, FileCheck2, FileUp, ShieldCheck, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { ErrorMessage } from "./status";

type Preview = { counts: Record<string, number>; issues: Array<{ severity: string; expression: string; diagnostics: string }>; canApply: boolean; protectionTraceId: string };

export function PortabilityControls({ patientId }: { patientId: string }) {
  const [purpose, setPurpose] = useState("records_administration"); const [reason, setReason] = useState("");
  const [bundle, setBundle] = useState<unknown>(null); const [fileName, setFileName] = useState(""); const [preview, setPreview] = useState<Preview | null>(null);
  const [mfaPending, setMfaPending] = useState(false); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");

  function downloadPayload(payload: unknown, filename: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/fhir+json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

  async function exportFhir() {
    setBusy("export"); setError(""); setNotice("");
    try { const result = await api(`/v1/patients/${patientId}/fhir?purpose=${encodeURIComponent(purpose)}&reason=${encodeURIComponent(reason)}`); downloadPayload(result, `salus-${patientId}-fhir.json`); setMfaPending(false); setNotice("Purpose-authorized FHIR export created with no-store release controls."); }
    catch (caught) { if (caught instanceof ApiError && caught.code === "RECENT_MFA_REQUIRED") setMfaPending(true); else setError(caught instanceof Error ? caught.message : "FHIR export failed."); }
    finally { setBusy(""); }
  }

  async function stepUp(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await api("/v1/auth/mfa/step-up", { method: "POST", body: JSON.stringify({ code: new FormData(event.currentTarget).get("code") }) }); await exportFhir(); } catch (caught) { setError(caught instanceof Error ? caught.message : "MFA verification failed."); } }

  async function chooseBundle(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setError(""); setNotice(""); setPreview(null); try { setBundle(JSON.parse(await file.text())); setFileName(file.name); } catch { setBundle(null); setError("This file is not valid JSON."); } }

  async function previewImport() { if (!bundle) return; setBusy("preview"); setError(""); try { setPreview(await api<Preview>(`/v1/patients/${patientId}/fhir/import?mode=preview`, { method: "POST", body: JSON.stringify(bundle) })); } catch (caught) { setError(caught instanceof Error ? caught.message : "FHIR preview failed."); } finally { setBusy(""); } }
  async function applyImport() { if (!bundle || !preview?.canApply || !window.confirm("Apply the protected FHIR preview to this health profile?")) return; setBusy("apply"); setError(""); try { const result = await api<{ applied: Record<string, number>; protectionTraceId: string }>(`/v1/patients/${patientId}/fhir/import?mode=apply`, { method: "POST", body: JSON.stringify(bundle) }); setNotice(`FHIR import applied: ${Object.entries(result.applied).map(([type, count]) => `${count} ${type}`).join(", ")}.`); setBundle(null); setPreview(null); setFileName(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "FHIR import failed."); } finally { setBusy(""); } }

  return <section className="panel settings-panel"><div className="panel-title"><div><p className="overline">Controlled portability</p><h2>FHIR import and export</h2></div><Download /></div>{error && <ErrorMessage message={error} />}{notice && <div className="message success" role="status">{notice}</div>}
    <div className="portability-grid"><form className="stack portability-card" onSubmit={(event) => { event.preventDefault(); void exportFhir(); }}><div><strong>Purpose-authorized export</strong><p className="muted">Requires an export scope, stated reason, and recent MFA.</p></div><label>Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="records_administration">Records administration</option><option value="emergency_support">Emergency support</option></select></label><label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} required placeholder="Reason for releasing this bundle" /></label><button className="primary-button" disabled={busy === "export"}><Download size={16} />{busy === "export" ? "Preparing…" : "Export protected FHIR"}</button></form>
    <div className="stack portability-card"><div><strong>Protected FHIR import</strong><p className="muted">Preview counts and patient-reference issues before applying anything.</p></div><label className="upload-compact"><input type="file" accept=".json,application/json,application/fhir+json" onChange={(event) => void chooseBundle(event)} /><FileUp />{fileName || "Choose a FHIR bundle"}</label>{bundle !== null && <button className="secondary-button" disabled={busy === "preview"} onClick={() => void previewImport()}><FileCheck2 size={16} />{busy === "preview" ? "Protecting preview…" : "Validate protected preview"}</button>}{preview && <div className="fhir-preview"><strong>{preview.canApply ? "Ready to apply" : "Blocked by validation"}</strong><div className="token-row">{Object.entries(preview.counts).filter(([, count]) => count > 0).map(([type, count]) => <span key={type}>{type}: {count}</span>)}</div>{preview.issues.map((issue, index) => <p key={`${issue.expression}-${index}`} className={issue.severity === "error" ? "error-copy" : "muted"}>{issue.severity}: {issue.diagnostics}</p>)}<small>Protection trace {preview.protectionTraceId}</small>{preview.canApply && <button className="primary-button compact" disabled={busy === "apply"} onClick={() => void applyImport()}><ShieldCheck size={16} />{busy === "apply" ? "Applying…" : "Apply protected import"}</button>}</div>}</div></div>
    {mfaPending && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-mfa-title"><button className="dialog-close icon-button" aria-label="Close" onClick={() => setMfaPending(false)}><X /></button><p className="overline">Controlled export</p><h2 id="export-mfa-title">Confirm recent MFA</h2><form className="stack" onSubmit={stepUp}><label>Authenticator code<input name="code" pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" required autoFocus /></label><button className="primary-button"><ShieldCheck size={16} />Verify and export</button></form></section></div>}
  </section>;
}
