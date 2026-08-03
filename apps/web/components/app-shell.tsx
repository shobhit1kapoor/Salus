"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  FileText,
  HeartPulse,
  History,
  LogOut,
  MessageCircle,
  Pill,
  Settings,
  Share2,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { api } from "../lib/api";

type PatientContext = { id: string; preferredName: string; role?: string };

export function AppShell({ children, patient, purpose = "Daily care" }: { children: React.ReactNode; patient?: PatientContext; purpose?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const patientRoot = patient ? `/patients/${patient.id}` : "";

  const isActive = (path: string, exact = false) => exact ? pathname === path : pathname.startsWith(path);

  async function signOut() {
    await api("/v1/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return <div className="app-frame">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar">
      <Link href="/dashboard" className="brand" aria-label="Salus health profiles">
        <span className="brand-mark"><HeartPulse size={21} strokeWidth={2.2} /></span>
        <span className="brand-copy"><strong>Salus</strong><small>Protected health intelligence</small></span>
      </Link>

      <div className="topbar-context">
        {patient ? <div className="active-patient" aria-label={`Active protected health profile: ${patient.preferredName}`}>
          <span className="profile-monogram" aria-hidden="true">{patient.preferredName.slice(0, 1).toUpperCase()}</span>
          <span><small>Active profile</small><strong>{patient.preferredName}</strong></span>
          <span className="context-divider" aria-hidden="true" />
          <span className="purpose-context"><small>Current purpose</small><strong>{purpose}</strong></span>
          <span className="context-divider access-divider" aria-hidden="true" />
          <span className="purpose-context access-context"><small>Access level</small><strong>{patient.role?.replaceAll("_", " ") ?? "Purpose authorized"}</strong></span>
        </div> : <div className="workspace-title"><small>Workspace</small><strong>Health profiles</strong></div>}
      </div>

      <div className="top-actions">
        <span className="boundary-state"><i aria-hidden="true" />Protected</span>
        <Link className="icon-button" aria-label="Notifications" href="/notifications"><Bell size={18} /></Link>
        <Link className="icon-button" aria-label="Security settings" href="/settings/security"><Settings size={18} /></Link>
        <button className="icon-button" aria-label="Sign out" onClick={signOut}><LogOut size={18} /></button>
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar" aria-label="Main navigation">
        <nav>
          <p className="nav-label">Workspace</p>
          <Link className={isActive("/dashboard", true) ? "nav-link active" : "nav-link"} href="/dashboard"><UsersRound size={18} />Health profiles</Link>
          {patient && <>
            <p className="nav-label">Care workspace</p>
            <Link className={isActive(patientRoot, true) ? "nav-link active" : "nav-link"} href={patientRoot}><CalendarCheck2 size={18} />Today</Link>
            <Link className={isActive(`${patientRoot}/timeline`) ? "nav-link active" : "nav-link"} href={`${patientRoot}/timeline`}><History size={18} />Timeline</Link>
            <Link className={isActive(`${patientRoot}/medications`) ? "nav-link active" : "nav-link"} href={`${patientRoot}/medications`}><Pill size={18} />Medications</Link>
            <Link className={isActive(`${patientRoot}/follow-ups`) ? "nav-link active" : "nav-link"} href={`${patientRoot}/follow-ups`}><CalendarCheck2 size={18} />Follow-ups</Link>
            <Link className={isActive(`${patientRoot}/documents`) ? "nav-link active" : "nav-link"} href={`${patientRoot}/documents`}><FileText size={18} />Records</Link>
            <Link className={isActive(`${patientRoot}/assistant`) ? "nav-link active" : "nav-link"} href={`${patientRoot}/assistant`}><MessageCircle size={18} />Ask Salus</Link>
            <Link className={isActive(`${patientRoot}/sharing`) ? "nav-link active" : "nav-link"} href={`${patientRoot}/sharing`}><Share2 size={18} />Sharing</Link>
            <p className="nav-label">Evidence</p>
            <Link className={isActive(`${patientRoot}/privacy-proof`) ? "nav-link active proof-link" : "nav-link proof-link"} href={`${patientRoot}/privacy-proof`}><ShieldCheck size={18} />Privacy Proof</Link>
          </>}
        </nav>
        <div className="gateway-card" aria-label="Protection gateway status">
          <span className="gateway-icon"><ShieldCheck size={17} /></span>
          <span><strong>Protection gateway</strong><small><i aria-hidden="true" />All boundaries enforced</small></span>
        </div>
      </aside>
      <main id="main-content" className="content">{children}</main>
    </div>
  </div>;
}
