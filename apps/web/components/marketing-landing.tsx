"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  ArrowRight, ArrowUpRight, CalendarCheck2, Check, Eye, FileText, HeartPulse,
  KeyRound, Link2, LockKeyhole, MessageCircle, Pill, Play, Radar, Search,
  ShieldCheck, Sparkles, UserRound, UsersRound
} from "lucide-react";

const videos = {
  hero: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260402_054547_9875cfc5-155a-4229-8ec8-b7ba7125cbf8.mp4",
  approach: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4",
  philosophy: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4",
  care: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4",
  proof: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260324_151826_c7218672-6e92-402c-9e45-f1e0f454bdc4.mp4"
};

const pipeline = [
  { name: "Authorize", note: "purpose + scope", icon: UserRound },
  { name: "Discover", note: "identify data", icon: Search },
  { name: "Protect", note: "pseudonymize", icon: ShieldCheck },
  { name: "Guardrail", note: "policy checks", icon: LockKeyhole },
  { name: "AI / tools", note: "minimum necessary", icon: Sparkles },
  { name: "Leak scan", note: "verify safety", icon: Radar },
  { name: "Reveal", note: "authorized only", icon: Eye }
];

function SeamlessHeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const restartRef = useRef<number | null>(null);

  function fadeTo(target: number, duration = 500) {
    const video = videoRef.current;
    if (!video) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const start = Number.parseFloat(video.style.opacity || "0");
    const startedAt = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      video.style.opacity = String(start + (target - start) * progress);
      if (progress < 1) animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  }

  useEffect(() => () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (restartRef.current) window.clearTimeout(restartRef.current);
  }, []);

  return <video
    ref={videoRef}
    className="landing-hero-video"
    src={videos.hero}
    muted
    autoPlay
    playsInline
    preload="auto"
    aria-hidden="true"
    style={{ opacity: 0 }}
    onCanPlay={(event) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        event.currentTarget.pause();
        event.currentTarget.style.opacity = "1";
        return;
      }
      void event.currentTarget.play();
      fadeTo(1);
    }}
    onTimeUpdate={(event) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const video = event.currentTarget;
      if (video.duration - video.currentTime <= .55 && !fadingOutRef.current) {
        fadingOutRef.current = true;
        fadeTo(0);
      }
    }}
    onEnded={(event) => {
      const video = event.currentTarget;
      video.style.opacity = "0";
      restartRef.current = window.setTimeout(() => {
        video.currentTime = 0;
        fadingOutRef.current = false;
        void video.play();
        fadeTo(1);
      }, 100);
    }}
  />;
}

function AmbientVideo({ src, className = "" }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => preference.matches ? videoRef.current?.pause() : void videoRef.current?.play();
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);
  return <video ref={videoRef} className={className} src={src} muted autoPlay loop playsInline preload="metadata" aria-hidden="true" />;
}

export function MarketingLanding({ signedIn }: { signedIn: boolean }) {
  const workspaceHref = signedIn ? "/dashboard" : "/login";

  return <main className="landing-page">
    <section className="landing-hero" id="top">
      <header className="landing-nav liquid-glass">
        <Link href="#top" className="landing-brand" aria-label="Salus home">
          <span><HeartPulse size={21} /></span><strong>Salus</strong>
        </Link>
        <nav aria-label="Landing page navigation">
          <Link href="#product">Product</Link><Link href="#protection">Protection</Link>
          <Link href="#caregivers">Caregivers</Link><Link href="#evidence">Evidence</Link>
        </nav>
        <div className="landing-nav-actions">
          <Link href={workspaceHref}>{signedIn ? "Workspace" : "Sign in"}</Link>
          <Link className="landing-nav-cta" href={workspaceHref}>Enter workspace <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      <div className="landing-hero-copy">
        <h1>Health intelligence,<br /><em>without the exposure.</em></h1>
        <p>Salus protects raw patient identifiers and unprotected sensitive values before storage, embeddings, AI, tools, responses, and logs. Models receive only authorized, pseudonymized, minimum-necessary clinical context.</p>
        <div className="landing-hero-actions">
          <Link className="landing-primary-cta" href={workspaceHref}>Enter workspace <ArrowRight size={18} /></Link>
          <Link className="landing-secondary-cta liquid-glass" href="#evidence"><Play size={17} /> Watch the protected flow</Link>
        </div>
        <p className="landing-powered"><ShieldCheck size={15} /> Powered by <strong>Protegrity Developer Edition</strong></p>
      </div>

      <div className="landing-visual" aria-hidden="true"><SeamlessHeroVideo /><div className="landing-visual-shade" /></div>

      <section className="landing-proof-panel liquid-glass" id="evidence" aria-labelledby="proof-panel-title">
        <h2 id="proof-panel-title"><ShieldCheck size={22} /> Protection travels with every request.</h2>
        <div className="landing-pipeline" role="list" aria-label="Protected AI pipeline">
          {pipeline.map((step, index) => {
            const Icon = step.icon;
            return <div className="landing-pipeline-step" role="listitem" key={step.name}>
              <span><Icon size={19} /></span><strong>{step.name}</strong><small>{step.note}</small>
              {index < pipeline.length - 1 && <ArrowRight className="landing-pipeline-arrow" size={16} aria-hidden="true" />}
            </div>;
          })}
        </div>
        <div className="landing-proof-facts">
          <div><span><UserRound size={22} /></span><p><strong>Pseudonymized context</strong><small>Only authorized clinical context reaches the model.</small></p></div>
          <div><span><KeyRound size={22} /></span><p><strong>Purpose-bound access</strong><small>Every action is scoped, time-bound, and revocable.</small></p></div>
          <div><span><Link2 size={22} /></span><p><strong>Hash-chained receipts</strong><small>Tamper-evident evidence for every protected operation.</small></p></div>
        </div>
      </section>
    </section>

    <section className="landing-about" id="product"><div className="landing-section-inner">
      <p className="landing-label">A safer way to coordinate care</p>
      <h2>Useful health context for the people who need it.<br /><em>Protected from the first boundary.</em></h2>
    </div></section>

    <section className="landing-feature"><div className="landing-section-inner landing-feature-frame">
      <AmbientVideo src={videos.approach} /><div className="landing-feature-shade" />
      <div className="landing-feature-content">
        <article className="liquid-glass"><p className="landing-label">The Salus approach</p><h2>Clinical usefulness without uncontrolled exposure.</h2><p>Records, medications, labs, and follow-ups remain useful after purpose checks, discovery, protection, pseudonymization, and minimum-necessary filtering.</p></article>
        <Link className="landing-secondary-cta liquid-glass" href="#protection">Explore the architecture <ArrowRight size={17} /></Link>
      </div>
    </div></section>

    <section className="landing-philosophy" id="protection"><div className="landing-section-inner">
      <h2>Care utility <em>×</em> controlled exposure</h2>
      <div className="landing-philosophy-grid">
        <div className="landing-philosophy-media"><AmbientVideo src={videos.philosophy} /></div>
        <div className="landing-philosophy-copy">
          <article><p className="landing-label">Protect before use</p><h3>Protegrity is the first data boundary—not a masking step at the end.</h3><p>Discovery and protection run before persistence, vectors, model calls, tools, queues, and telemetry. If protection cannot be confirmed, the workflow fails closed.</p></article>
          <article><p className="landing-label">Reveal with intent</p><h3>Patients decide who can see what, why, and for how long.</h3><p>Purpose-based grants, recent-MFA checks, selective reveal, immediate revocation, and break-glass auditing keep collaboration useful and accountable.</p></article>
        </div>
      </div>
    </div></section>

    <section className="landing-services" id="caregivers"><div className="landing-section-inner">
      <div className="landing-section-heading"><h2>Built for real care</h2><p className="landing-label">Patient-first workflows</p></div>
      <div className="landing-service-grid">
        <article className="landing-service-card liquid-glass">
          <div className="landing-service-media"><AmbientVideo src={videos.care} /><div /></div>
          <div className="landing-service-body"><div><p className="landing-label">Care coordination</p><span><ArrowUpRight size={17} /></span></div><h3>One protected health story</h3><p>Bring timelines, records, medications, appointments, and follow-ups into a source-grounded workspace for a patient or someone they authorize you to support.</p><ul><li><Pill size={16} /> Medication intelligence</li><li><CalendarCheck2 size={16} /> Source-linked follow-ups</li><li><UsersRound size={16} /> Caregiver collaboration</li></ul></div>
        </article>
        <article className="landing-service-card liquid-glass">
          <div className="landing-service-media"><AmbientVideo src={videos.proof} /><div /></div>
          <div className="landing-service-body"><div><p className="landing-label">Verifiable protection</p><span><ArrowUpRight size={17} /></span></div><h3>Proof, not privacy promises</h3><p>Inspect protection methods, policy decisions, boundary scans, model payload status, reveal outcomes, and leak results without storing the original sensitive values.</p><ul><li><FileText size={16} /> Protection receipts</li><li><Radar size={16} /> Attack Lab</li><li><MessageCircle size={16} /> Protected AI assistance</li></ul></div>
        </article>
      </div>
    </div></section>

    <section className="landing-final-cta"><div className="landing-section-inner liquid-glass">
      <p className="landing-label">Protected health intelligence</p><h2>Make care easier to understand.<br /><em>Keep exposure under control.</em></h2><p>Create a patient-authorized health profile and see how every protected operation becomes verifiable evidence.</p>
      <Link className="landing-primary-cta" href={workspaceHref}>{signedIn ? "Open your workspace" : "Get started securely"} <ArrowRight size={18} /></Link>
      <span><Check size={15} /> Synthetic data is recommended for evaluation and demonstrations.</span>
    </div></section>

    <footer className="landing-footer"><div className="landing-section-inner">
      <Link href="#top" className="landing-brand"><span><HeartPulse size={20} /></span><strong>Salus</strong></Link><p>Privacy-first health AI for patients and authorized caregivers.</p><div><Link href="/login">Sign in</Link><Link href="#protection">Protection</Link><Link href="#evidence">Evidence</Link></div>
    </div></footer>
  </main>;
}
