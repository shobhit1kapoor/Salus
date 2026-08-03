"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../components/status";
import { api } from "../../../lib/api";

type Me = { id: string; email: string; displayName: string; mfaEnabled: boolean };
type Session = { id: string; created_at: string; expires_at: string; user_agent?: string; active: boolean };

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setMe(await api("/v1/auth/me"));
    setSessions(await api("/v1/auth/sessions"));
  }, []);
  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load security settings.")); }, [load]);

  async function startMfa() { setError(""); setSetup(await api("/v1/auth/mfa/setup", { method: "POST" })); }
  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const code = new FormData(event.currentTarget).get("code");
    const result = await api<{ recoveryCodes: string[] }>("/v1/auth/mfa/confirm", { method: "POST", body: JSON.stringify({ code }) });
    setRecoveryCodes(result.recoveryCodes); setSetup(null); setNotice("MFA enabled. Store the recovery codes somewhere private."); await load();
  }
  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await api("/v1/auth/mfa/disable", { method: "POST", body: JSON.stringify({ password: form.get("password"), code: form.get("code") }) });
    setNotice("MFA disabled."); await load();
  }
  async function revokeSession(id: string) { await api(`/v1/auth/sessions/${id}`, { method: "DELETE" }); await load(); }
  async function deleteAccount(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const password = new FormData(event.currentTarget).get("password"); if (!window.confirm("Delete this Salus account? This cannot be undone.")) return; await api("/v1/auth/account", { method: "DELETE", body: JSON.stringify({ password }) }); router.replace("/"); }

  if (!me) return <AppShell>{error ? <ErrorMessage message={error} /> : <Loading />}</AppShell>;
  return <AppShell><div className="page-heading"><div><p className="overline">Account protection</p><h1>Security settings</h1><p>Manage multi-factor authentication and revoke sessions you no longer recognize.</p></div></div>{error && <ErrorMessage message={error} />}{notice && <div className="message success" role="status">{notice}</div>}
    <section className="panel settings-panel"><div className="panel-title"><div><p className="overline">Authenticator</p><h2>Multi-factor authentication</h2></div><ShieldCheck /></div>
      <p>{me.mfaEnabled ? "MFA is enabled for this account." : "Add a time-based authenticator for protection beyond your password."}</p>
      {!me.mfaEnabled && !setup && <button className="primary-button compact" onClick={() => void startMfa()}><Smartphone size={17} />Set up authenticator</button>}
      {setup && <form className="stack setup-box" onSubmit={confirmMfa}><p>In your authenticator app, add this setup key:</p><code>{setup.secret}</code><details><summary>Advanced setup URI</summary><code className="wrap-code">{setup.otpauthUri}</code></details><label>Six-digit code<input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></label><button className="primary-button compact">Confirm MFA</button></form>}
      {recoveryCodes.length > 0 && <div className="recovery-box"><strong>Recovery codes — shown once</strong><div>{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div></div>}
      {me.mfaEnabled && <details><summary>Disable MFA</summary><form className="stack setup-box" onSubmit={disableMfa}><label>Current password<input name="password" type="password" minLength={12} required autoComplete="current-password" /></label><label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" /></label><button className="secondary-button compact">Disable MFA</button></form></details>}
    </section>
    <section className="panel settings-panel"><div className="panel-title"><div><p className="overline">Access</p><h2>Signed-in sessions</h2></div><KeyRound /></div><div className="session-list">{sessions.map((session) => <article key={session.id}><div><strong>{session.user_agent || "Unknown browser"}</strong><small>Created {new Date(session.created_at).toLocaleString()} · expires {new Date(session.expires_at).toLocaleDateString()}</small></div><span className={`status ${session.active ? "verified" : "rejected"}`}>{session.active ? "active" : "revoked"}</span>{session.active && <button className="icon-button" aria-label="Revoke session" onClick={() => void revokeSession(session.id)}><Trash2 size={17} /></button>}</article>)}</div></section>
    <section className="panel settings-panel danger-zone"><div className="panel-title"><div><p className="overline">Danger zone</p><h2>Delete account</h2></div><Trash2 /></div><p>You must transfer or delete every patient workspace for which you are the sole owner first.</p><form className="stack" onSubmit={deleteAccount}><label>Current password<input type="password" name="password" minLength={12} required autoComplete="current-password" /></label><button className="secondary-button compact danger-text"><Trash2 size={16} />Delete my account</button></form></section>
  </AppShell>;
}
