import { Queue } from "bullmq";
import { env } from "./env.js";
const redis = new URL(env.REDIS_URL);
const connection = { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined };
export const processingQueue = new Queue("salus-processing", { connection });
export const evidenceQueue = new Queue("salus-evidence-probes", { connection });
export async function enqueueDocument(documentId: string, patientId: string, actorId: string) { await processingQueue.add("process-document", { documentId, patientId, actorId }, { jobId: `document-${documentId}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 200, removeOnFail: false }); }
export async function retryDocument(documentId: string, patientId: string, actorId: string) {
  const existing = await processingQueue.getJob(`document-${documentId}`);
  if (!existing) return enqueueDocument(documentId, patientId, actorId);
  const state = await existing.getState();
  if (state === "failed") return existing.retry();
  if (state === "completed") {
    await existing.remove();
    return enqueueDocument(documentId, patientId, actorId);
  }
  throw new Error(`Document job is ${state} and cannot be retried.`);
}
export async function enqueueVoice(voiceId: string, patientId: string, actorId: string) { await processingQueue.add("transcribe-voice", { voiceId, patientId, actorId }, { jobId: `voice-${voiceId}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 } }); }
