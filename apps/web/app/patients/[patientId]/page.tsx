"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, CheckCircle2, ChevronRight, Clock3, MessageCircle, Mic, Pill, Plus, Settings } from "lucide-react";
import { AppShell } from "../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../components/status";
import { api } from "../../../lib/api";

type Dashboard = {
  patient: { id: string; preferredName: string; timezone: string };
  medications: Array<{ id: string; name: string; dosage: string; schedule: string; status: string }>;
  appointments: Array<{ id: string; startsAt: string; providerName?: string; reason?: string }>;
  tasks: Array<{ id: string; title: string; dueAt?: string; status: string }>;
  timeline: Array<{ id: string; occurredAt: string; category: string; summary: string; source: string }>;
};

export default function PatientTodayPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [showTask, setShowTask] = useState(false);

  async function load() {
    try {
      setData(await api(`/v1/patients/${patientId}/dashboard`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this workspace.");
    }
  }

  useEffect(() => { void load(); }, [patientId]);

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/v1/patients/${patientId}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"),
        dueAt: form.get("dueAt") ? new Date(String(form.get("dueAt"))).toISOString() : undefined,
        reminderAt: form.get("reminderAt") ? new Date(String(form.get("reminderAt"))).toISOString() : undefined
      })
    });
    setShowTask(false);
    await load();
  }

  async function completeTask(id: string) {
    await api(`/v1/patients/${patientId}/tasks/${id}/complete`, { method: "POST" });
    await load();
  }

  if (!data) return <AppShell>{error ? <ErrorMessage message={error} /> : <Loading />}</AppShell>;

  const firstName = data.patient.preferredName;
  const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return <AppShell patient={data.patient}>
    <div className="page-heading patient-heading">
      <div><p className="overline">{today}</p><h1>Today for {firstName}</h1><p>Tasks, medications, appointments, and recent changes from the authorized care record.</p></div>
      <div className="page-actions"><Link className="secondary-button compact" href={`/patients/${patientId}/settings`}><Settings size={17} />Settings</Link><button className="primary-button compact" onClick={() => setShowTask(true)}><Plus size={17} />Add task</button></div>
    </div>

    <section className="assistant-callout">
      <span className="assistant-orb"><MessageCircle size={20} /></span>
      <div><p className="overline">Source-grounded assistant</p><h2>Ask about the care record</h2><p>Review recent changes, verified medications, appointments, or prepare a caregiver handoff.</p></div>
      <div className="callout-actions"><Link href={`/patients/${patientId}/assistant`} className="primary-button compact">Ask Salus <ArrowUpRight size={16} /></Link><Link href={`/patients/${patientId}/assistant?voice=1`} className="secondary-button compact"><Mic size={16} />Record update</Link></div>
    </section>

    <div className="dashboard-grid">
      <section className="panel tasks-panel">
        <div className="panel-title"><div><p className="overline">Today</p><h2>Care checklist</h2></div><span className="count-badge">{data.tasks.length} open</span></div>
        <div className="task-list">{data.tasks.length ? data.tasks.map((task) => <button className="task-row" onClick={() => completeTask(task.id)} key={task.id}><span className="check-circle" /><span><strong>{task.title}</strong><small>{task.dueAt ? `Due ${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(task.dueAt))}` : "No due time"}</small></span><CheckCircle2 className="complete-icon" /></button>) : <div className="empty-inline"><CheckCircle2 /><span><strong>All clear for now</strong><small>Add a care task when something comes up.</small></span></div>}</div>
      </section>

      <section className="panel medications-panel">
        <div className="panel-title"><div><p className="overline">Care record</p><h2>Medications</h2></div><Pill size={19} /></div>
        <div className="list">{data.medications.length ? data.medications.map((med) => <div className="list-row" key={med.id}><span className="time-dot" /><div><strong>{med.name} · {med.dosage}</strong><small>{med.schedule}{med.status === "proposed" ? " · Imported; not clinically verified" : ""}</small></div><span className={`status ${med.status}`}>{med.status === "proposed" ? "unverified" : med.status}</span></div>) : <p className="muted">No medications recorded yet.</p>}</div>
      </section>

      <section className="panel appointments-panel">
        <div className="panel-title"><div><p className="overline">Coming up</p><h2>Appointments</h2></div><CalendarDays size={19} /></div>
        <div className="list">{data.appointments.length ? data.appointments.map((appointment) => <div className="appointment-card" key={appointment.id}><div className="date-block"><strong>{new Date(appointment.startsAt).getDate()}</strong><small>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(appointment.startsAt))}</small></div><div><strong>{appointment.providerName || "Appointment"}</strong><small><Clock3 size={13} />{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(appointment.startsAt))}</small></div></div>) : <p className="muted">No upcoming appointments.</p>}</div>
      </section>

      <section className="panel recent-panel">
        <div className="panel-title"><div><p className="overline">What changed</p><h2>Recent care notes</h2></div><Link href={`/patients/${patientId}/timeline`} className="text-link">View timeline <ChevronRight size={16} /></Link></div>
        <div className="timeline-mini">{data.timeline.length ? data.timeline.slice(0, 5).map((event) => <div className="timeline-mini-row" key={event.id}><span className={`event-mark ${event.category}`} /><div><strong>{event.category.replace("_", " ")}</strong><p>{event.summary}</p><small>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(event.occurredAt))} · {event.source}</small></div></div>) : <p className="muted">No care notes yet.</p>}</div>
      </section>
    </div>

    {showTask && <div className="dialog-backdrop" onMouseDown={() => setShowTask(false)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="task-title" onMouseDown={(event) => event.stopPropagation()}><p className="overline">Care task</p><h2 id="task-title">Add to {firstName}&apos;s day</h2><form className="stack" onSubmit={addTask}><label>Task<input name="title" required autoFocus placeholder="Offer a glass of water" /></label><div className="form-row"><label>Due at<input type="datetime-local" name="dueAt" /></label><label>Remind me at<input type="datetime-local" name="reminderAt" /></label></div><div className="dialog-actions"><button type="button" className="text-button" onClick={() => setShowTask(false)}>Cancel</button><button className="primary-button compact">Add task</button></div></form></section></div>}
  </AppShell>;
}
