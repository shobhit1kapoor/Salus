import { Queue } from "bullmq";
import { env } from "./env.js";
const redis = new URL(env.REDIS_URL);
const connection = { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined };
export const processingQueue = new Queue("salus-processing", { connection });
export async function enqueueDocument(documentId: string, patientId: string, actorId: string) { await processingQueue.add("process-document", { documentId, patientId, actorId }, { jobId: `document-${documentId}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 200, removeOnFail: false }); }
export async function enqueueVoice(voiceId: string, patientId: string, actorId: string) { await processingQueue.add("transcribe-voice", { voiceId, patientId, actorId }, { jobId: `voice-${voiceId}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 } }); }
