"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, HeartPulse, LockKeyhole } from "lucide-react";
import { api } from "../lib/api";

export function AuthEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "register") {
        await api("/v1/auth/register", { method: "POST", body: JSON.stringify({ displayName: data.get("name"), email: data.get("email"), password: data.get("password") }) });
        setNotice("Account created. Open the verification link sent to your email, then sign in.");
        setMode("login");
      } else {
        const result = await api<{ mfaRequired?: boolean; challengeToken?: string }>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
        if (result.mfaRequired && result.challengeToken) {
          setMfaChallenge(result.challengeToken);
          setNotice("Password accepted. Enter your authenticator or recovery code.");
          return;
        }
        router.push("/dashboard");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not continue.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;
    setBusy(true);
    setError("");
    const value = String(new FormData(event.currentTarget).get("mfaCode") ?? "").trim();
    try {
      await api("/v1/auth/mfa/login", { method: "POST", body: JSON.stringify({ challengeToken: mfaChallenge, ...(/^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value }) }) });
      router.push("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "MFA verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="welcome">
    <section className="auth-panel">
      <div className="auth-card">
        <div className="auth-brand brand"><span className="brand-mark"><HeartPulse size={20} /></span><span className="brand-copy"><strong>Salus</strong><small>Protected health intelligence</small></span></div>
        <p className="overline">Secure workspace</p>
        <h2>{mode === "login" ? "Sign in to Salus" : "Create your account"}</h2>
        <p className="muted">{mode === "login" ? "Open your patient-authorized health profiles." : "Use an email address you can verify."}</p>

        {!mfaChallenge && <div className="segmented" role="group" aria-label="Account action">
          <button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>Create account</button>
        </div>}

        {mfaChallenge ? <form onSubmit={confirmMfa} className="stack">
          <label>Authenticator or recovery code<input required name="mfaCode" autoComplete="one-time-code" inputMode="numeric" autoFocus /></label>
          {error && <div className="message error" role="alert">{error}</div>}
          {notice && <div className="message success" role="status">{notice}</div>}
          <button className="primary-button" disabled={busy}>{busy ? "Verifying…" : "Verify and continue"}<ArrowRight size={18} /></button>
          <button type="button" className="text-button" onClick={() => { setMfaChallenge(null); setError(""); setNotice(""); }}>Use a different account</button>
        </form> : <form onSubmit={submit} className="stack">
          {mode === "register" && <label>Display name<input required name="name" autoComplete="name" /></label>}
          <label>Email address<input required name="email" type="email" autoComplete="email" /></label>
          <label>Password<input required name="password" type="password" minLength={12} autoComplete={mode === "login" ? "current-password" : "new-password"} /><small>At least 12 characters</small></label>
          {error && <div className="message error" role="alert">{error}</div>}
          {notice && <div className="message success" role="status">{notice}</div>}
          <button className="primary-button" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Continue to workspace" : "Create protected account"}<ArrowRight size={18} /></button>
        </form>}

        <div className="auth-assurance"><LockKeyhole size={16} /><span><strong>Private session</strong><small>Purpose checks and protection controls run before data access.</small></span></div>
        <p className="clinical-disclaimer"><Check size={14} /> Salus supports care coordination and does not replace professional medical care.</p>
      </div>
    </section>
  </main>;
}
