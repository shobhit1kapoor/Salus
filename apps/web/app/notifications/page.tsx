"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { ErrorMessage, Loading } from "../../components/status";
import { api } from "../../lib/api";

type Notification = { id: string; patientId: string; patientName: string; taskId?: string; title?: string; status: string; createdAt: string; readAt?: string };

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => setItems(await api("/v1/notifications")), []);
  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load notifications.")); }, [load]);
  async function markRead(id: string) { await api(`/v1/notifications/${id}/read`, { method: "POST" }); await load(); }
  return <AppShell><div className="page-heading"><div><p className="overline">Care reminders</p><h1>Notifications</h1><p>Patient-scoped reminders from your verified care tasks.</p></div></div>{error && <ErrorMessage message={error} />}{items === null ? <Loading /> : <section className="panel notification-list">{items.length ? items.map((item) => <article key={item.id} className={item.readAt ? "read" : "unread"}><Bell size={18} /><div><Link href={`/patients/${item.patientId}`}><strong>{item.title || "Care reminder"}</strong></Link><p>{item.patientName} · {new Date(item.createdAt).toLocaleString()}</p></div>{item.readAt ? <span className="status verified"><Check size={13} />Read</span> : <button className="secondary-button compact" onClick={() => void markRead(item.id)}>Mark read</button>}</article>) : <p className="muted">No notifications yet.</p>}</section>}</AppShell>;
}
