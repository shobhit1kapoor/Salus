"use client";

import Link from "next/link";
import { FormEvent, use, useCallback, useEffect, useState } from "react";
import { Clock3, Eye, EyeOff, KeyRound, Plus, ShieldAlert, ShieldCheck, UserRoundCheck, X, XCircle } from "lucide-react";
import { AppShell } from "../../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../../components/status";
import { api, ApiError } from "../../../../lib/api";

const purposes = ["daily_care", "medication_support", "appointment_preparation", "records_administration", "emergency_support"] as const;
const scopes = ["profile", "timeline", "medications", "labs", "follow_ups", "documents", "assistant", "export"] as const;
const labels = (value: string) => value.replaceAll("_", " ");

type Profile = { id: string; displayName: string };
type Grant = { id: string; granteeId: string; granteeName: string; purposes: string[]; scopes: string[]; revealLevel: string; consentVersion: number; expiresAt?: string | null; revokedAt?: string | null };
type Access = { role: string; members: Array<{ id: string; displayName: string; email: string; role: string }> };
type RevealBody = { resourceType: "profile"; fields: string[]; purpose: string; reason: string; breakGlass: boolean };
type RevealResult = { traceId: string; revealed: Record<string, string | null> };

export default function SharingPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [access, setAccess] = useState<Access | null>(null);
  const [showGrant, setShowGrant] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revealResult, setRevealResult] = useState<RevealResult | null>(null);
  const [pendingReveal, setPendingReveal] = useState<RevealBody | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, g, a] = await Promise.all([
        api<Profile>(`/v1/profiles/${patientId}?purpose=records_administration`),
        api<Grant[]>(`/v1/profiles/${patientId}/grants`),
        api<Access>(`/v1/patients/${patientId}/access`)
      ]);
      setProfile(p); setGrants(g); setAccess(a);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sharing controls.");
    }
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  async function createGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      await api(`/v1/profiles/${patientId}/grants`, { method: "POST", body: JSON.stringify({
        granteeId: form.get("granteeId"),
        purposes: form.getAll("purposes"),
        scopes: form.getAll("scopes"),
        revealLevel: form.get("revealLevel"),
        expiresAt: form.get("expiresAt") ? new Date(String(form.get("expiresAt"))).toISOString() : undefined
      }) });
      formElement.reset(); setShowGrant(false); setNotice("Purpose grant created and enforced immediately."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the grant."); }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this purpose grant now? Future retrieval and reveal will stop immediately.")) return;
    setError(""); await api(`/v1/profiles/${patientId}/grants/${id}`, { method: "DELETE" }); setNotice("Grant revoked. Existing capabilities can no longer be reused."); await load();
  }

  async function requestReveal(body: RevealBody) {
    try {
      const result = await api<RevealResult>(`/v1/profiles/${patientId}/reveal`, { method: "POST", body: JSON.stringify(body) });
      setRevealResult(result); setPendingReveal(null); setNotice(body.breakGlass ? "Emergency reveal recorded and the profile owner was notified." : "Minimum-necessary fields revealed for this session only.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "MFA_STEP_UP_REQUIRED") { setPendingReveal(body); return; }
      throw caught;
    }
  }

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setRevealResult(null);
    const form = new FormData(event.currentTarget);
    const body: RevealBody = { resourceType: "profile", fields: form.getAll("fields").map(String), purpose: String(form.get("purpose")), reason: String(form.get("reason")), breakGlass: form.get("breakGlass") === "on" };
    try { await requestReveal(body); } catch (caught) { setError(caught instanceof Error ? caught.message : "Reveal was denied."); }
  }

  async function stepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pendingReveal) return; setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    try { await api("/v1/auth/mfa/step-up", { method: "POST", body: JSON.stringify({ code }) }); await requestReveal(pendingReveal); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "MFA verification failed."); }
  }

  if (!profile || !access) return <AppShell>{error ? <ErrorMessage message={error} /> : <Loading />}</AppShell>;
  const canManage = access.role === "owner" || access.role === "care_coordinator";

  return <AppShell patient={{ id: patientId, preferredName: profile.displayName, role: access.role }} purpose="Records administration">
    <div className="page-heading"><div><p className="overline">Patient-controlled collaboration</p><h1>Purpose-based sharing</h1><p>Access is granted by purpose, scope, reveal level, and time—not by a single all-or-nothing caregiver role.</p></div><div className="page-actions">{canManage && <button className="primary-button compact" onClick={() => setShowGrant(true)}><Plus size={17} />New purpose grant</button>}<Link className="secondary-button compact" href={`/patients/${patientId}/settings`}><UserRoundCheck size={17} />Invite caregiver</Link></div></div>
    {error && <ErrorMessage message={error} />}{notice && <div className="message success" role="status">{notice}</div>}
    <div className="purpose-grid">{purposes.map((purpose) => <div key={purpose}><KeyRound /><strong>{labels(purpose)}</strong><span>Independently revocable</span></div>)}</div>

    <section className="panel"><div className="panel-title"><div><p className="overline">Consent versioned · revocable</p><h2>Active and historical grants</h2></div><ShieldCheck /></div><div className="grant-list">{grants.map((grant) => <article key={grant.id} className={grant.revokedAt ? "revoked" : ""}><div className="grant-person"><UserRoundCheck /><div><strong>{grant.granteeName}</strong><span>{labels(grant.revealLevel)} reveal · consent v{grant.consentVersion} · {grant.expiresAt ? `expires ${new Date(grant.expiresAt).toLocaleDateString()}` : "no expiry"}</span></div></div><div><small>Purposes</small><div className="token-row">{grant.purposes.map((item) => <span key={item}>{labels(item)}</span>)}</div><small>Scopes</small><div className="token-row">{grant.scopes.map((item) => <span key={item}>{labels(item)}</span>)}</div></div>{grant.revokedAt ? <span className="revoked-label"><XCircle />Revoked</span> : canManage ? <button className="danger-button" onClick={() => void revoke(grant.id)}>Revoke now</button> : <span className="status active">active</span>}</article>)}</div></section>

    <section className="panel reveal-panel"><div className="panel-title"><div><p className="overline">Minimum necessary · no-store</p><h2>Controlled information reveal</h2></div><Eye /></div><p className="muted">Direct identifiers require a stated purpose and recent MFA. Emergency access also creates a prominent audit event and owner notification.</p><form className="stack" onSubmit={reveal}><div className="field-choice-grid"><label className="checkbox-row"><input type="checkbox" name="fields" value="preferredName" defaultChecked />Preferred name</label><label className="checkbox-row"><input type="checkbox" name="fields" value="legalName" />Legal name</label><label className="checkbox-row"><input type="checkbox" name="fields" value="dateOfBirth" />Date of birth</label></div><div className="form-row"><label>Purpose<select name="purpose" defaultValue="records_administration">{purposes.map((purpose) => <option value={purpose} key={purpose}>{labels(purpose)}</option>)}</select></label><label>Reason<input name="reason" minLength={8} required placeholder="Why is this information necessary?" /></label></div><label className="checkbox-row break-glass-check"><input type="checkbox" name="breakGlass" /><ShieldAlert size={17} />Emergency break glass (requires emergency-support grant)</label><button className="primary-button compact"><Eye size={16} />Request controlled reveal</button></form>
      {revealResult && <div className="revealed-values" role="status"><div><strong>Revealed for this session</strong><button className="icon-button" aria-label="Clear revealed values" onClick={() => setRevealResult(null)}><EyeOff size={16} /></button></div>{Object.entries(revealResult.revealed).map(([field, value]) => <p key={field}><span>{labels(field)}</span><strong>{value ?? "Not recorded"}</strong></p>)}<small>Trace {revealResult.traceId} · response was delivered with Cache-Control: no-store</small></div>}
    </section>
    <div className="provenance-note"><Clock3 /><span><strong>Immediate enforcement</strong> Expired or revoked grants fail at authorization before retrieval, tools, vectors, or model calls.</span></div>

    {showGrant && <div className="dialog-backdrop" onMouseDown={() => setShowGrant(false)}><section className="dialog wide-dialog" role="dialog" aria-modal="true" aria-labelledby="grant-title" onMouseDown={(event) => event.stopPropagation()}><button className="dialog-close icon-button" aria-label="Close" onClick={() => setShowGrant(false)}><X /></button><p className="overline">Purpose authorization</p><h2 id="grant-title">Create a minimum-necessary grant</h2><form className="stack" onSubmit={createGrant}><label>Caregiver<select name="granteeId" required defaultValue=""><option value="" disabled>Select an accepted care-team member</option>{access.members.map((member) => <option value={member.id} key={member.id}>{member.displayName} · {labels(member.role)}</option>)}</select></label><fieldset><legend>Purposes</legend><div className="field-choice-grid">{purposes.map((purpose) => <label className="checkbox-row" key={purpose}><input type="checkbox" name="purposes" value={purpose} defaultChecked={purpose === "daily_care"} />{labels(purpose)}</label>)}</div></fieldset><fieldset><legend>Scopes</legend><div className="field-choice-grid">{scopes.map((scope) => <label className="checkbox-row" key={scope}><input type="checkbox" name="scopes" value={scope} defaultChecked={["profile", "timeline", "follow_ups"].includes(scope)} />{labels(scope)}</label>)}</div></fieldset><div className="form-row"><label>Reveal level<select name="revealLevel" defaultValue="routine"><option value="routine">Routine</option><option value="sensitive">Sensitive with MFA</option><option value="break_glass">Emergency break glass</option></select></label><label>Expires at <span className="optional">optional</span><input type="datetime-local" name="expiresAt" /></label></div><div className="dialog-actions"><button type="button" className="text-button" onClick={() => setShowGrant(false)}>Cancel</button><button className="primary-button compact"><ShieldCheck size={16} />Create grant</button></div></form></section></div>}

    {pendingReveal && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="mfa-title"><button className="dialog-close icon-button" aria-label="Close" onClick={() => setPendingReveal(null)}><X /></button><p className="overline">Recent verification required</p><h2 id="mfa-title">Confirm with MFA</h2><p className="muted">Enter the current six-digit code from your authenticator. Verification remains fresh for ten minutes.</p><form className="stack" onSubmit={stepUp}><label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required autoFocus /></label><button className="primary-button"><ShieldCheck size={17} />Verify and reveal</button><Link className="text-button" href="/settings/security">Set up MFA instead</Link></form></section></div>}
  </AppShell>;
}
