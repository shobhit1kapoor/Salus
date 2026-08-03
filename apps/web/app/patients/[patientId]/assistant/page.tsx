"use client";

import { FormEvent, use, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Mic, ShieldAlert, Sparkles, StopCircle } from "lucide-react";
import { AppShell } from "../../../../components/app-shell";
import { ErrorMessage, Loading } from "../../../../components/status";
import { api, API_URL } from "../../../../lib/api";

type Message = { id: string; role: "user" | "assistant"; content: string; citations: Array<{ sourceId: string; label: string }>; createdAt: string };
type VoiceReview = { id: string; status: string; originalTranscript?: string; editedTranscript?: string; structuredResult?: { manualTranscriptionRequired?: boolean; error?: string }; createdAt?: string };
type VoicePhase = "idle" | "requesting" | "recording" | "uploading" | "processing";

export default function AssistantPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [patient, setPatient] = useState<{ id: string; preferredName: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceReview, setVoiceReview] = useState<VoiceReview | null>(null);
  const [pendingVoiceCount, setPendingVoiceCount] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordButton = useRef<HTMLButtonElement | null>(null);
  const recordingLimit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPendingVoices = useCallback(async () => {
    const pending = await api<VoiceReview[]>(`/v1/patients/${patientId}/voice/pending`);
    setPendingVoiceCount(pending.length);
    setVoiceReview(pending[0] ?? null);
  }, [patientId]);

  const load = useCallback(async () => {
    const [dashboard, loadedMessages, pending] = await Promise.all([
      api<{ patient: { id: string; preferredName: string } }>(`/v1/patients/${patientId}/dashboard`),
      api<Message[]>(`/v1/patients/${patientId}/assistant/messages`),
      api<VoiceReview[]>(`/v1/patients/${patientId}/voice/pending`),
    ]);
    setPatient(dashboard.patient);
    setMessages(loadedMessages);
    setPendingVoiceCount(pending.length);
    setVoiceReview(pending[0] ?? null);
  }, [patientId]);

  useEffect(() => {
    load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not open assistant."));
    if (new URLSearchParams(window.location.search).get("voice") === "1") {
      setNotice("Ready for a private voice question. Press the microphone, speak, then press stop and review what you asked.");
      requestAnimationFrame(() => recordButton.current?.focus());
    }
    return () => {
      if (recordingLimit.current) clearTimeout(recordingLimit.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form); const message = String(data.get("message") || "").trim();
    if (!message) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: message, citations: [], createdAt: new Date().toISOString() }]);
    form.reset(); setBusy(true); setError("");
    try {
      const result = await api<{ message: Message }>(`/v1/patients/${patientId}/assistant/messages`, { method: "POST", body: JSON.stringify({ message }) });
      setMessages((current) => [...current, result.message]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Salus could not respond."); }
    finally { setBusy(false); }
  }

  async function waitForVoiceReview(voiceId: string) {
    setVoicePhase("processing");
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const voice = await api<VoiceReview>(`/v1/patients/${patientId}/voice/${voiceId}`);
        if (voice.status === "needs_review") {
          setVoiceReview(voice); setPendingVoiceCount((count) => count + 1);
          setNotice("Recording is ready. Enter or review the question before asking Salus.");
          return;
        }
        if (voice.status === "failed") throw new Error(voice.structuredResult?.error ?? "The private recording could not be prepared for review.");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setNotice("The recording is still processing. It will reappear here automatically when you return.");
    } finally { setVoicePhase("idle"); }
  }

  async function toggleRecording() {
    if (voicePhase === "recording") {
      if (recordingLimit.current) clearTimeout(recordingLimit.current);
      recorder.current?.stop(); setVoicePhase("uploading"); return;
    }
    if (voicePhase !== "idle") return;
    setError(""); setNotice("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("UNSUPPORTED");
      setVoicePhase("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      chunks.current = [];
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      recorder.current = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recorder.current.ondataavailable = (chunk) => { if (chunk.data.size > 0) chunks.current.push(chunk.data); };
      recorder.current.onerror = () => {
        stream.getTracks().forEach((track) => track.stop()); setVoicePhase("idle");
        setError("The browser stopped the recording unexpectedly. Please try again.");
      };
      recorder.current.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const mimeType = recorder.current?.mimeType || "audio/webm";
        const recording = new Blob(chunks.current, { type: mimeType });
        if (!recording.size) { setVoicePhase("idle"); setError("No audio was captured. Check the selected microphone and try again."); return; }
        const form = new FormData();
        form.append("file", recording, `ask-salus-question.${mimeType.includes("mp4") ? "m4a" : "webm"}`);
        try {
          const response = await fetch(`${API_URL}/v1/patients/${patientId}/voice`, { method: "POST", credentials: "include", body: form });
          const body = await response.json().catch(() => null) as { id?: string; message?: string; code?: string } | null;
          if (!response.ok) throw new Error(body?.message ?? body?.code ?? "Upload failed");
          if (!body?.id) throw new Error("The protected voice job did not return an identifier.");
          setNotice("Recording securely uploaded. Preparing the private review step…");
          await waitForVoiceReview(body.id);
        } catch (caught) { setVoicePhase("idle"); setError(caught instanceof Error ? caught.message : "The recording could not be uploaded."); }
      };
      recorder.current.start(1000); setVoicePhase("recording");
      recordingLimit.current = setTimeout(() => {
        if (recorder.current?.state === "recording") { recorder.current.stop(); setVoicePhase("uploading"); }
      }, 60_000);
      setNotice("Recording privately. Press stop when finished; maximum length is 60 seconds.");
    } catch (caught) {
      setVoicePhase("idle");
      setError(caught instanceof Error && caught.message === "UNSUPPORTED" ? "Voice recording is not supported in this browser." : "Microphone access was unavailable. Allow microphone access for localhost and try again.");
    }
  }

  async function askWithVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!voiceReview) return;
    const form = new FormData(event.currentTarget); const transcript = String(form.get("transcript") ?? "").trim();
    if (!transcript) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message: Message }>(`/v1/patients/${patientId}/assistant/messages`, { method: "POST", body: JSON.stringify({ message: transcript }) });
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: transcript, citations: [], createdAt: new Date().toISOString() }, result.message]);
      await api(`/v1/patients/${patientId}/voice/${voiceReview.id}/consume`, { method: "POST", body: "{}" });
      setNotice("Voice question sent to Ask Salus. The temporary audio was deleted and nothing was added to the timeline.");
      await loadPendingVoices();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The voice question could not be sent."); }
    finally { setBusy(false); }
  }

  async function discardVoice() {
    if (!voiceReview) return;
    setBusy(true); setError("");
    try {
      await api(`/v1/patients/${patientId}/voice/${voiceReview.id}`, { method: "DELETE" });
      setNotice("Temporary voice recording deleted. Nothing was added to Ask Salus or the timeline.");
      await loadPendingVoices();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The temporary recording could not be deleted."); }
    finally { setBusy(false); }
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
    {voiceReview && <form className="panel voice-review stack" onSubmit={askWithVoice}><div><p className="overline">Ask with voice{pendingVoiceCount > 1 ? ` · ${pendingVoiceCount} pending` : ""}</p><h2>{voiceReview.originalTranscript ? "Review the local transcript" : "Enter what you asked"}</h2><p>{voiceReview.structuredResult?.manualTranscriptionRequired ? "For privacy, raw audio is not sent to a hosted speech model. Enter what you said, then Salus will protect it and answer it as a question—not save it as a care event." : "Correct any transcription errors before asking Salus."}</p></div><label>Voice question<textarea name="transcript" required maxLength={12000} defaultValue={voiceReview.editedTranscript ?? voiceReview.originalTranscript ?? ""} autoFocus /></label><div className="dialog-actions"><button type="button" className="text-button danger-text" onClick={() => void discardVoice()} disabled={busy}>Discard recording</button><button type="button" className="text-button" onClick={() => { setVoiceReview(null); setNotice("Recording kept in the pending review queue."); }} disabled={busy}>Review later</button><button className="primary-button compact" disabled={busy}>{busy ? "Asking Salus…" : "Ask Salus"}</button></div></form>}
    <form className="composer" onSubmit={send}><button ref={recordButton} type="button" className={voicePhase === "recording" ? "record-button active" : "record-button"} aria-label={voicePhase === "recording" ? "Stop recording" : voicePhase === "idle" ? "Record voice question" : "Voice question processing"} aria-pressed={voicePhase === "recording"} disabled={!(["idle", "recording"] as VoicePhase[]).includes(voicePhase)} onClick={() => void toggleRecording()}>{voicePhase === "recording" ? <StopCircle /> : <Mic />}</button><label className="sr-only" htmlFor="message">Message Salus</label><input id="message" name="message" autoComplete="off" placeholder={voicePhase === "idle" ? `Ask about ${patient.preferredName}'s care…` : voicePhase === "requesting" ? "Waiting for microphone permission…" : voicePhase === "uploading" ? "Securely uploading voice question…" : voicePhase === "processing" ? "Preparing private transcript review…" : "Recording — press stop when finished"} maxLength={12000} disabled={voicePhase !== "idle"} /><button className="send-button" disabled={busy || voicePhase !== "idle"} aria-label="Send message"><ArrowUp /></button></form>
    <p className="medical-note">Voice questions stay inside Salus, never create timeline events, and require transcript review before they are sent. Salus does not diagnose, prescribe, or replace professional care.</p>
  </div></AppShell>;
}
