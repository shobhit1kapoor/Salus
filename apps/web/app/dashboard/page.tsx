"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ChevronRight, LockKeyhole, Plus, ShieldCheck, UserRound } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { ErrorMessage, Loading } from "../../components/status";
import { api } from "../../lib/api";

type Profile = {
  id: string;
  profileType: "self" | "dependent";
  displayName: string;
  relationship?: string | null;
  authorityStatus: string;
  role: string;
  archivedAt?: string | null;
};

export default function DashboardPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [profileType, setProfileType] = useState<"self" | "dependent">("self");

  async function load() {
    try {
      setProfiles(await api<Profile[]>("/v1/profiles"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load health profiles.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function addProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/v1/profiles", {
        method: "POST",
        body: JSON.stringify({
          profileType,
          preferredName: data.get("preferredName"),
          legalName: data.get("legalName") || undefined,
          dateOfBirth: data.get("dateOfBirth") || undefined,
          relationship: profileType === "dependent" ? data.get("relationship") : undefined,
          pronouns: data.get("pronouns") || undefined,
          language: "en",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });
      setAdding(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create this profile.");
    }
  }

  const activeProfiles = profiles?.filter((profile) => !profile.archivedAt) ?? [];

  return <AppShell>
    <div className="page-heading workspace-heading">
      <div>
        <p className="overline">Patient-authorized workspace</p>
        <h1>Health profiles</h1>
        <p>Choose whose care you are coordinating. Purpose, scope, and reveal rules follow the active profile.</p>
      </div>
      <button className="primary-button compact" onClick={() => setAdding(true)}><Plus size={17} />New profile</button>
    </div>

    <section className="privacy-banner" aria-label="Protection status">
      <span className="privacy-banner-icon"><ShieldCheck size={19} /></span>
      <div><strong>Protection active at the first data boundary</strong><span>Identifiers are protected before persistence; AI receives only authorized, pseudonymized clinical context.</span></div>
      <span className="live-pill"><i aria-hidden="true" />Gateway enforced</span>
    </section>

    <div className="section-heading"><div><h2>Your profiles</h2><p>{activeProfiles.length} active {activeProfiles.length === 1 ? "profile" : "profiles"}</p></div></div>
    {error && <ErrorMessage message={error} />}
    {profiles === null && !error ? <Loading /> : <div className="patient-grid">
      {activeProfiles.map((profile) => <Link href={`/patients/${profile.id}`} className="patient-card profile-card" key={profile.id}>
        <div className="patient-avatar">{profile.profileType === "self" ? <UserRound size={21} /> : <LockKeyhole size={20} />}</div>
        <div className="profile-card-copy">
          <p className="role-pill">{profile.profileType === "self" ? "My health" : profile.relationship ?? "Someone I care for"}</p>
          <h2>{profile.displayName}</h2>
          <p>{profile.authorityStatus.replaceAll("_", " ")} · {profile.role.replaceAll("_", " ")}</p>
        </div>
        <ChevronRight className="card-arrow" size={20} />
      </Link>)}
      {!activeProfiles.length && <button className="empty-card" onClick={() => setAdding(true)}><Plus size={20} /><strong>Create your first protected profile</strong><span>Protegrity protection is confirmed before any profile value is stored.</span></button>}
    </div>}

    {adding && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setAdding(false)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}>
      <p className="overline">New health profile</p>
      <h2 id="add-title">Who is this profile for?</h2>
      <div className="segmented"><button type="button" className={profileType === "self" ? "active" : ""} onClick={() => setProfileType("self")}>My health</button><button type="button" className={profileType === "dependent" ? "active" : ""} onClick={() => setProfileType("dependent")}>Someone I care for</button></div>
      <p className="muted"><LockKeyhole size={15} /> Values are protected before the profile is stored.</p>
      <form className="stack" onSubmit={addProfile}>
        <label>Preferred name<input name="preferredName" required autoFocus /></label>
        {profileType === "dependent" && <label>Your relationship<input name="relationship" required placeholder="Parent, child, partner…" /></label>}
        <label>Legal name <span className="optional">optional</span><input name="legalName" /></label>
        <div className="form-row"><label>Date of birth<input type="date" name="dateOfBirth" /></label><label>Pronouns<input name="pronouns" placeholder="Optional" /></label></div>
        <label className="attestation"><input type="checkbox" required /> I confirm I am creating this profile for myself or I am authorized to support this person.</label>
        <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setAdding(false)}>Cancel</button><button className="primary-button compact"><ShieldCheck size={17} />Protect and create</button></div>
      </form>
    </section></div>}
  </AppShell>;
}
