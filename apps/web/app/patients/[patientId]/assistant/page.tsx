"use client";

import { FormEvent, use, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Mic, ShieldAlert, Sparkles, StopCircle } from "lucide-react";
import { AppShell } from "../../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../../components/status";
import { api, API_URL } from "../../../../lib/api";

type Message = { id: string; role: "user" | "assistant"; content: string; citations: Array<{ sourceId: string; label: string }>; createdAt: string };
type VoiceReview = { id: string; status: string; originalTranscript?: string; editedTranscript?: string; structuredResult?: { manualTranscriptionRequired?: boolean } };

export default function AssistantPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [patient, setPatient] = useState<{ id: string; preferredName: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceReview, setVoiceReview] = useState<VoiceReview | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const load = useCallback(async () => {
    const dashboard = await api<{ patient: { id: string; preferredName: string } }>(`/v1/patients/${patientId}/dashboard`);
    setPatient(dashboard.patient);
    setMessages(await api(`/v1/patients/${patientId}/assistant/messages`));
  }, [patientId]);

  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not open assistant.")); }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form); const message = String(data.get("message") || "").trim();
    if (!message) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: message, citations: [], createdAt: new Date().toISOString() }]);
    form.reset(); setBusy(true); setError("");
    try {
      const result = await api<{ message: Message }>(`/v1/patients/${patientId}/assistant/messages`, { method: "POST", body: JSON.stringify({ message }) });
      setMessages((current) => [...current, result.message]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Salus could not respond.");
    } finally { setBusy(false); }
  }

  async function waitForVoiceReview(voiceId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const voice = await api<VoiceReview>(`/v1/patients/${patientId}/voice/${voiceId}`);
      if (voice.status === "needs_review" || voice.status === "failed") { setVoiceReview(voice); return; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setNotice("The recording is still processing. You can safely return to this workspace later.");
  }

  async function toggleRecording() {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    setError(""); setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks.current = [];
      recorder.current = new MediaRecorder(stream);
      recorder.current.ondataavailable = (event) => chunks.current.push(event.data);
      recorder.current.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const form = new FormData(); form.append("file", new Blob(chunks.current, { type: recorder.current?.mimeType || "audio/webm" }), "care-update.webm");
        try {
          const response = await fetch(`${API_URL}/v1/patients/${patientId}/voice`, { method: "POST", credentials: "include", body: form });
          const body = await response.json();
          if (!response.ok) throw new Error(body.message ?? body.code ?? "Upload failed");
          setNotice("Recording securely uploaded. Review the transcript before adding it to the timeline.");
          await waitForVoiceReview(body.id);
        } catch (caught) { setError(caught instanceof Error ? caught.message : "The recording could not be uploaded."); }
      };
      recorder.current.start(); setRecording(true);
    } catch { setError("Microphone access was unavailable. Check the browser permission and try again."); }
  }

  async function confirmVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!voiceReview) return;
    const form = new FormData(event.currentTarget);
    await api(`/v1/patients/${patientId}/voice/${voiceReview.id}/confirm`, { method: "POST", body: JSON.stringify({ editedTranscript: form.get("transcript"), category: form.get("category"), occurredAt: new Date(String(form.get("occurredAt"))).toISOString() }) });
    setVoiceReview(null); setNotice("Voice update confirmed and added to the patient timeline.");
  }

  if (!patient) return <AppShell>{error ? <ErrorMessage message={error} /> : <Loading label="Opening private assistant…" />}</AppShell>;
  return <AppShell patient={patient}><div className="assistant-page">
    <header className="assistant-header"><div><p className="overline">{patient.preferredName}&apos;s private assistant</p><h1>Salus</h1><p>Grounded only in {patient.preferredName}&apos;s authorized records.</p></div><div className="isolation-badge"><ShieldAlert size={17} /><span><strong>Patient-scoped</strong><small>No cross-person memory</small></span></div></header>
    <section className="chat-surface" aria-live="polite">
      {!messages.length && <div className="chat-welcome"><div className="assistant-orb"><Sparkles /></div><h2>What can I help you understand?</h2><p>I can organize care notes, find verified information, and prepare questions. I cannot diagnose or change treatment.</p><div className="prompt-grid">{["What happened this week?", "Which tasks are still open?", "Prepare questions for the next appointment", "Summarize medication adherence"].map((prompt) => <button key={prompt} onClick={() => { const input = document.querySelector<HTMLInputElement>("#message"); if (input) { input.value = prompt; input.focus(); } }}>{prompt}</button>)}</div></div>}
      {messages.map((message) => <article key={message.id} className={`chat-message ${message.role}`}><div className="message-author">{message.role === "assistant" ? <Sparkles size={15} /> : patient.preferredName.slice(0, 1)}<span>{message.role === "assistant" ? "Salus" : "You"}</span></div><p>{message.content}</p>{message.citations?.length > 0 && <div className="citations"><strong>Sources</strong>{message.citations.map((citation) => <span key={citation.sourceId}><FileText size={14} />{citation.label}</span>)}</div>}</article>)}
      {busy && <div className="thinking"><span /><span /><span /> Reviewing authorized records</div>}
    </section>
    {error && <div className="message error" role="alert">{error}</div>}{notice && <div className="message success" role="status">{notice}</div>}
    {voiceReview && <form className="panel voice-review stack" onSubmit={confirmVoice}><div><p className="overline">Confirm voice update</p><h2>{voiceReview.originalTranscript ? "Review the NVIDIA transcript" : "Enter the transcript manually"}</h2><p>{voiceReview.structuredResult?.manualTranscriptionRequired ? "Hosted speech transcription is not configured. The recording remains private while you provide the text." : "Correct any transcription errors before saving."}</p></div><label>Transcript<textarea name="transcript" required maxLength={12000} defaultValue={voiceReview.editedTranscript ?? voiceReview.originalTranscript ?? ""} /></label><div className="form-row"><label>Category<select name="category" defaultValue="note"><option value="note">Note</option><option value="symptom">Symptom</option><option value="meal">Meal</option><option value="hydration">Hydration</option><option value="sleep">Sleep</option><option value="mood">Mood</option><option value="fall">Fall</option><option value="medication">Medication</option></select></label><label>Occurred at<input type="datetime-local" name="occurredAt" required defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} /></label></div><div className="dialog-actions"><button type="button" className="text-button" onClick={() => setVoiceReview(null)}>Cancel</button><button className="primary-button compact">Confirm timeline entry</button></div></form>}
    <form className="composer" onSubmit={send}><button type="button" className={recording ? "record-button active" : "record-button"} aria-label={recording ? "Stop recording" : "Record voice update"} onClick={() => void toggleRecording()}>{recording ? <StopCircle /> : <Mic />}</button><label className="sr-only" htmlFor="message">Message Salus</label><input id="message" name="message" autoComplete="off" placeholder={`Ask about ${patient.preferredName}'s care…`} maxLength={12000} /><button className="send-button" disabled={busy} aria-label="Send message"><ArrowUp /></button></form>
    <p className="medical-note">Salus organizes information and flags predefined risks. It does not diagnose, prescribe, or replace professional care.</p>
  </div></AppShell>;
}
