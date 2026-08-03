"use client";

import { FormEvent, use, useCallback, useEffect, useState } from "react";
import { MailPlus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../../components/status";
import { api } from "../../../../lib/api";
import { PortabilityControls } from "../../../../components/portability-controls";

type Access = { role: string; members: Array<{ id: string; displayName: string; email: string; role: string }>; invitations: Array<{ id: string; email: string; role: string; expiresAt: string }> };
type Preferences = { timezone: string; quietStart: string | null; quietEnd: string | null; inAppEnabled: boolean; emailEnabled: boolean; pushEnabled: boolean };
type PushConfig = { enabled: boolean; publicKey?: string };

function applicationServerKey(value: string) {
  const normalized = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

export default function PatientSettingsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params); const router = useRouter();
  const [patient, setPatient] = useState<{ id: string; preferredName: string } | null>(null); const [access, setAccess] = useState<Access | null>(null); const [preferences, setPreferences] = useState<Preferences | null>(null); const [pushConfig, setPushConfig] = useState<PushConfig | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => { const dashboard = await api<{ patient: { id: string; preferredName: string } }>(`/v1/patients/${patientId}/dashboard?purpose=records_administration`); setPatient(dashboard.patient); setAccess(await api(`/v1/patients/${patientId}/access`)); setPreferences(await api(`/v1/patients/${patientId}/notification-preferences`)); setPushConfig(await api("/v1/push/config")); }, [patientId]);
  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load workspace settings.")); }, [load]);
  async function invite(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await api(`/v1/patients/${patientId}/access`, { method: "POST", body: JSON.stringify({ email: form.get("email"), role: form.get("role") }) }); event.currentTarget.reset(); setNotice("Access granted or invitation sent."); await load(); }
  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget); const pushEnabled = form.get("pushEnabled") === "on";
    try {
      if (pushEnabled) {
        if (!pushConfig?.enabled || !pushConfig.publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Web push is not available in this environment.");
        if (Notification.permission === "denied") throw new Error("Browser notification permission is blocked. Enable it in browser settings first.");
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Notification permission was not granted.");
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(pushConfig.publicKey) });
        const serialized = subscription.toJSON();
        if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) throw new Error("The browser returned an incomplete push subscription.");
        await api("/v1/push/subscriptions", { method: "POST", body: JSON.stringify({ endpoint: serialized.endpoint, keys: serialized.keys }) });
      } else if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration("/"); const subscription = await registration?.pushManager.getSubscription();
        if (subscription) { await api("/v1/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); }
      }
      await api(`/v1/patients/${patientId}/notification-preferences`, { method: "PUT", body: JSON.stringify({ timezone: form.get("timezone"), quietStart: form.get("quietStart") || null, quietEnd: form.get("quietEnd") || null, inAppEnabled: form.get("inAppEnabled") === "on", emailEnabled: form.get("emailEnabled") === "on", pushEnabled }) });
      setNotice("Notification preferences saved."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save notification preferences."); }
  }
  async function permanentlyDelete(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const confirmation = new FormData(event.currentTarget).get("confirmation"); if (!window.confirm("Permanently delete this patient workspace and encrypted uploads? This cannot be undone.")) return; await api(`/v1/patients/${patientId}`, { method: "DELETE", body: JSON.stringify({ confirmation }) }); router.replace("/dashboard"); }
  if (!patient || !access || !preferences || !pushConfig) return <AppShell>{error ? <ErrorMessage message={error} /> : <Loading />}</AppShell>;
  const canManage = access.role === "owner" || access.role === "care_coordinator";
  return <AppShell patient={patient}><div className="page-heading"><div><p className="overline">Workspace controls</p><h1>{patient.preferredName} settings</h1><p>Access, reminders, exports, and lifecycle controls stay scoped to this patient.</p></div></div>{error && <ErrorMessage message={error} />}{notice && <div className="message success" role="status">{notice}</div>}
    <section className="panel settings-panel"><div className="panel-title"><div><p className="overline">Care team</p><h2>Access</h2></div><MailPlus /></div><div className="member-list">{access.members.map((member) => <div key={member.id}><span><strong>{member.displayName}</strong><small>{member.email}</small></span><span className="status verified">{member.role.replace("_", " ")}</span></div>)}</div>{access.invitations.map((invitation) => <p className="muted" key={invitation.id}>Invitation pending for {invitation.email} until {new Date(invitation.expiresAt).toLocaleDateString()}.</p>)}{canManage && <form className="form-row" onSubmit={invite}><label>Email<input name="email" type="email" required /></label><label>Role<select name="role"><option value="caregiver">Caregiver</option><option value="care_coordinator">Care coordinator</option><option value="viewer">Viewer</option></select></label><button className="primary-button compact"><MailPlus size={16} />Invite</button></form>}</section>
    <section className="panel settings-panel"><div className="panel-title"><div><p className="overline">Reminder delivery</p><h2>Notifications and quiet hours</h2></div><Save /></div><form className="stack" onSubmit={savePreferences}><label>Timezone<input name="timezone" required defaultValue={preferences.timezone} /></label><div className="form-row"><label>Quiet hours start<input name="quietStart" type="time" defaultValue={preferences.quietStart ?? ""} /></label><label>Quiet hours end<input name="quietEnd" type="time" defaultValue={preferences.quietEnd ?? ""} /></label></div><label className="checkbox-row"><input name="inAppEnabled" type="checkbox" defaultChecked={preferences.inAppEnabled} />In-app reminders</label><label className="checkbox-row"><input name="emailEnabled" type="checkbox" defaultChecked={preferences.emailEnabled} />Email reminders</label><label className="checkbox-row"><input name="pushEnabled" type="checkbox" defaultChecked={preferences.pushEnabled} disabled={!pushConfig.enabled} />Web push reminders</label>{!pushConfig.enabled && <p className="muted">Add VAPID keys to enable browser push delivery.</p>}<button className="primary-button compact"><Save size={16} />Save preferences</button></form></section>
    <PortabilityControls patientId={patientId} />
    {access.role === "owner" && <section className="panel settings-panel danger-zone"><div className="panel-title"><div><p className="overline">Danger zone</p><h2>Permanent deletion</h2></div><Trash2 /></div><p>Deletes the database workspace and encrypted document and voice objects. This cannot be undone.</p><form className="stack" onSubmit={permanentlyDelete}><label>Enter {patient.preferredName} to confirm<input name="confirmation" required /></label><button className="secondary-button compact danger-text"><Trash2 size={16} />Permanently delete workspace</button></form></section>}
  </AppShell>;
}
