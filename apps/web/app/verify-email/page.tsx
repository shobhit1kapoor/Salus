"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
export default function VerifyEmailPage() {
  const [message, setMessage] = useState("Verifying your email…");
  useEffect(() => { const token = new URLSearchParams(location.search).get("token"); if (!token) return setMessage("This verification link is incomplete."); api("/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }).then(() => setMessage("Email verified. You can sign in now.")).catch((e) => setMessage(e instanceof Error ? e.message : "Verification failed.")); }, []);
  return <main className="simple-page"><section className="auth-card"><h1>Email verification</h1><p>{message}</p><Link href="/" className="primary-button">Return to sign in</Link></section></main>;
}
