"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { HeartHandshake } from "lucide-react";
import { api } from "../../lib/api";

function AcceptInvitation() {
  const token = useSearchParams().get("token"); const [status, setStatus] = useState("Accepting your invitation…"); const [patientId, setPatientId] = useState<string | null>(null);
  useEffect(() => {
    if (!token) { setStatus("This invitation link is incomplete."); return; }
    api<{ patientId: string }>("/v1/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }).then((result) => { setPatientId(result.patientId); setStatus("Invitation accepted."); }).catch((caught) => setStatus(caught instanceof Error ? caught.message : "The invitation could not be accepted. Sign in with the invited email and try again."));
  }, [token]);
  return <main className="center-page"><section className="auth-card verify-card"><div className="brand"><span className="brand-mark"><HeartHandshake /></span>Salus</div><h1>{status}</h1><p>Invitations are bound to the invited email address and expire after seven days.</p>{patientId ? <Link className="primary-button" href={`/patients/${patientId}`}>Open care workspace</Link> : <Link className="secondary-button" href="/">Sign in</Link>}</section></main>;
}

export default function AcceptInvitePage() { return <Suspense><AcceptInvitation /></Suspense>; }
