"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, use, useCallback, useEffect, useState } from "react";
import { Download, FileCheck2, FileClock, FileText, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { AppShell } from "../../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../../components/status";
import { api, API_URL } from "../../../../lib/api";

type Document = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: string;
  failureReason?: string;
  proposedFactCount: number;
  createdAt: string;
};

type DocumentDetail = {
  document: Document & { extractedText?: string };
  facts: Array<{
    id: string;
    field: string;
    proposedValue: Record<string, unknown>;
    status: string;
    materializedResourceType?: string;
    materializedResourceId?: string;
  }>;
};

export default function DocumentsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [patient, setPatient] = useState<{ id: string; preferredName: string } | null>(null);
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingReveal, setPendingReveal] = useState<{ documentId: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    const dashboard = await api<{ patient: { id: string; preferredName: string } }>(`/v1/patients/${patientId}/dashboard?purpose=records_administration`);
    setPatient(dashboard.patient);
    setDocuments(await api(`/v1/patients/${patientId}/documents`));
  }, [patientId]);

  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load documents.")); }, [load]);

  async function openDocument(documentId: string) {
    setError("");
    setDetail(await api(`/v1/patients/${patientId}/documents/${documentId}`));
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(""); setNotice("");
    const form = new FormData(); form.append("file", file);
    try {
      const response = await fetch(`${API_URL}/v1/patients/${patientId}/documents`, { method: "POST", credentials: "include", body: form });
      const body = await response.json() as { id?: string; message?: string; code?: string };
      if (!response.ok || !body.id) throw new Error(body.message ?? body.code ?? "Upload failed.");
      for (let attempt = 0; attempt < 45; attempt += 1) {
        const latest = await api<Document[]>(`/v1/patients/${patientId}/documents`);
        setDocuments(latest);
        const uploaded = latest.find((document) => document.id === body.id);
        if (uploaded && uploaded.status !== "processing" && uploaded.status !== "uploading") {
          await openDocument(body.id);
          if (uploaded.status === "verified") setNotice("Document imported automatically. Tasks, appointments, and care notes are now on the dashboard; medication entries are marked unverified.");
          else setError(uploaded.failureReason ?? "The document could not be imported automatically.");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false); event.target.value = "";
    }
  }

  async function deleteDocument() {
    if (!detail || !window.confirm(`Delete ${detail.document.filename}? The stored file and automatically imported records from this document will be removed.`)) return;
    await api(`/v1/patients/${patientId}/documents/${detail.document.id}`, { method: "DELETE" });
    setDetail(null); setNotice(""); await load();
  }

  async function revealOriginal(documentId: string, reason?: string) {
    const statedReason = reason ?? window.prompt("State why the original document is necessary (minimum 8 characters):") ?? "";
    if (statedReason.trim().length < 8) { setError("A specific reveal reason of at least 8 characters is required."); return; }
    setError("");
    const response = await fetch(`${API_URL}/v1/patients/${patientId}/documents/${documentId}/original?purpose=records_administration&reason=${encodeURIComponent(statedReason)}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) { const body = await response.json().catch(() => null) as { code?: string; message?: string } | null; if (body?.code === "RECENT_MFA_REQUIRED") { setPendingReveal({ documentId, reason: statedReason }); return; } setError(body?.message ?? body?.code ?? "Original document reveal was denied."); return; }
    const disposition = response.headers.get("Content-Disposition") ?? ""; const match = disposition.match(/filename="([^"]+)"/); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = match?.[1] ?? "salus-document"; anchor.click(); URL.revokeObjectURL(url); setPendingReveal(null); setNotice("Original document revealed with no-store controls and an auditable protection receipt.");
  }

  async function stepUp(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!pendingReveal) return; try { await api("/v1/auth/mfa/step-up", { method: "POST", body: JSON.stringify({ code: new FormData(event.currentTarget).get("code") }) }); await revealOriginal(pendingReveal.documentId, pendingReveal.reason); } catch (caught) { setError(caught instanceof Error ? caught.message : "MFA verification failed."); } }

  return <AppShell patient={patient ?? undefined}>
    <div className="page-heading"><div><p className="overline">Private source library</p><h1>{patient?.preferredName ?? "Care"} documents</h1><p>Matched documents are scanned, extracted, and added to the care record automatically. New medication entries remain clearly marked unverified.</p></div></div>
    {error && <ErrorMessage message={error} />}
    {notice && <div className="message success" role="status">{notice} <Link href={`/patients/${patientId}`}>View dashboard</Link></div>}
    <label className="upload-zone"><input className="sr-only" type="file" accept=".pdf,.txt,.png,.jpg,.jpeg" onChange={(event) => void upload(event)} disabled={uploading} /><UploadCloud /><strong>{uploading ? "Scanning and importing…" : "Choose a care document"}</strong><span>PDF, text, PNG, or JPEG · up to 10 MB · malware-scanned before storage</span></label>
    {documents === null ? <Loading /> : <div className="document-grid">{documents.map((document) => <button className="document-card document-button" key={document.id} onClick={() => void openDocument(document.id)}><div className={`document-icon ${document.status}`}>{document.status === "verified" ? <FileCheck2 /> : document.status === "processing" ? <FileClock /> : <FileText />}</div><div><h2>{document.filename}</h2><p>{new Intl.NumberFormat("en", { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 }).format(document.byteSize / 1024)} · {new Date(document.createdAt).toLocaleDateString()}</p><span className={`status ${document.status}`}>{document.status === "verified" ? "imported" : document.status.replace("_", " ")}</span>{document.failureReason && <small className="error-copy">{document.failureReason}</small>}</div></button>)}</div>}
    {detail && <section className="panel document-review" aria-labelledby="document-review-title"><div className="panel-title"><div><p className="overline">Automatic import details</p><h2 id="document-review-title">{detail.document.filename}</h2></div><button className="icon-button" aria-label="Close document details" onClick={() => setDetail(null)}><X /></button></div>
      {detail.document.failureReason ? <ErrorMessage message={detail.document.failureReason} /> : <p className="muted">Salus retained source provenance for every automatically imported item.</p>}
      <div className="fact-list">{detail.facts.map((fact) => <article className="fact-row" key={fact.id}><div><strong>{fact.field.replaceAll("_", " ")}</strong><pre>{JSON.stringify(fact.proposedValue, null, 2)}</pre>{fact.materializedResourceType && <small>Saved to {fact.materializedResourceType.replaceAll("_", " ")}</small>}</div><span className={`status ${fact.status}`}>{fact.status.replaceAll("_", " ")}</span></article>)}</div>
      {detail.document.extractedText && <details><summary>Extracted text preview</summary><pre className="extracted-preview">{detail.document.extractedText.slice(0, 5000)}</pre></details>}
      <div className="dialog-actions"><button className="text-button danger-text" onClick={() => void deleteDocument()}><Trash2 size={16} />Delete document</button><button className="secondary-button compact" onClick={() => void revealOriginal(detail.document.id)}><Download size={16} />Reveal original</button>{detail.document.status === "verified" && <Link className="primary-button compact" href={`/patients/${patientId}`}>View dashboard</Link>}</div>
    </section>}
    {pendingReveal && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="document-mfa-title"><button className="dialog-close icon-button" aria-label="Close" onClick={() => setPendingReveal(null)}><X /></button><p className="overline">Original document reveal</p><h2 id="document-mfa-title">Confirm recent MFA</h2><p className="muted">The decrypted bytes are released only to this no-store response.</p><form className="stack" onSubmit={stepUp}><label>Authenticator code<input name="code" pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" required autoFocus /></label><button className="primary-button"><ShieldCheck size={16} />Verify and reveal original</button></form></section></div>}
  </AppShell>;
}
