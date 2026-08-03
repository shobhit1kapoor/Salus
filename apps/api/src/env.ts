import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());
const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  TOOL_CAPABILITY_SECRET: optionalNonEmptyString,
  COOKIE_SECURE: z.preprocess((value) => value === "true" || value === true, z.boolean()).default(false),
  WEB_ORIGIN: z.string().url(),
  DEMO_LOGIN_ENABLED: z.preprocess((value) => value === "true" || value === true, z.boolean()).default(false),
  SEED_REVIEWER_EMAIL: z.string().email().default("reviewer@salus.local"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  PRIVACY_GATEWAY_URL: z.string().url().default("http://localhost:8080"),
  PRIVACY_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(35_000),
  NVIDIA_API_KEY: optionalNonEmptyString,
  NVIDIA_CHAT_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_CHAT_MODEL: z.string().default("moonshotai/kimi-k2.6"),
  NVIDIA_CHAT_FALLBACK_MODEL: optionalNonEmptyString.default("meta/llama-3.1-8b-instruct"),
  NVIDIA_EMBEDDING_BASE_URL: z.string().url().default("https://ai.api.nvidia.com/v1/retrieval/nvidia"),
  NVIDIA_EMBEDDING_MODEL: z.string().default("NV-Embed-QA"),
  NVIDIA_EMBEDDING_FALLBACK_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_EMBEDDING_FALLBACK_MODEL: optionalNonEmptyString.default("nvidia/nv-embedqa-e5-v5"),
  NVIDIA_ASR_BASE_URL: optionalUrl,
  S3_ENDPOINT: z.string().url(), S3_REGION: z.string().default("us-east-1"), S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(3), S3_SECRET_KEY: z.string().min(8),
  OBJECT_ENCRYPTION_KEY: z.string().refine((value) => {
    try { return Buffer.from(value, "base64").length === 32; } catch { return false; }
  }, "OBJECT_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
  CLAMAV_HOST: z.string().min(1).default("localhost"), CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  SMTP_HOST: optionalNonEmptyString, SMTP_PORT: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional()), SMTP_FROM: z.preprocess((value) => value === "" ? undefined : value, z.string().min(3).optional()),
  VAPID_PUBLIC_KEY: optionalNonEmptyString,
  VAPID_PRIVATE_KEY: optionalNonEmptyString,
  VAPID_SUBJECT: z.string().default("mailto:security@example.com")
});
const parsed = schema.parse(process.env);
export const env = { ...parsed, TOOL_CAPABILITY_SECRET: parsed.TOOL_CAPABILITY_SECRET ?? parsed.SESSION_SECRET };
export type Env = typeof env;
