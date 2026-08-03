import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://salus:salus@localhost:5432/salus",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "synthetic-test-session-secret-32-characters",
  TOOL_CAPABILITY_SECRET: "synthetic-test-tool-secret-32-characters",
  WEB_ORIGIN: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "salus-test",
  S3_ACCESS_KEY: "salus-test",
  S3_SECRET_KEY: "salus-test-secret",
  OBJECT_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
});
const { issueToolCapability, verifyToolCapability } = await import("../src/privacy.js");

const profileId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const traceId = "00000000-0000-4000-8000-000000000003";

describe("signed tool capabilities", () => {
  it("accepts the exact profile, actor, purpose, trace, scope, and validity", () => {
    const token = issueToolCapability({ profileId, actorId, purpose: "daily_care", scopes: ["timeline"], traceId });
    expect(verifyToolCapability(token, { profileId, actorId, purpose: "daily_care", traceId }, "timeline")).toBe(true);
  });

  it("rejects cross-profile, wrong-purpose, insufficient-scope, and forged capabilities", () => {
    const token = issueToolCapability({ profileId, actorId, purpose: "daily_care", scopes: ["timeline"], traceId });
    expect(verifyToolCapability(token, { profileId: "00000000-0000-4000-8000-000000000099", actorId, purpose: "daily_care", traceId }, "timeline")).toBe(false);
    expect(verifyToolCapability(token, { profileId, actorId, purpose: "medication_support", traceId }, "timeline")).toBe(false);
    expect(verifyToolCapability(token, { profileId, actorId, purpose: "daily_care", traceId }, "documents")).toBe(false);
    expect(verifyToolCapability(`${token.slice(0, -1)}x`, { profileId, actorId, purpose: "daily_care", traceId }, "timeline")).toBe(false);
  });

  it("rejects expired capabilities", () => {
    const token = issueToolCapability({ profileId, actorId, purpose: "daily_care", scopes: ["timeline"], traceId }, -1);
    expect(verifyToolCapability(token, { profileId, actorId, purpose: "daily_care", traceId }, "timeline")).toBe(false);
  });
});
