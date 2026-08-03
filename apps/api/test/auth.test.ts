import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://salus:salus@localhost:5432/salus",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  WEB_ORIGIN: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "salus-test",
  S3_ACCESS_KEY: "test-access",
  S3_SECRET_KEY: "test-secret-key",
  OBJECT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
});

const { decryptMfaSecret, encryptMfaSecret, generateTotpCode, generateTotpSecret, verifyTotpCode } = await import("../src/auth.js");

describe("TOTP multi-factor authentication", () => {
  it("generates and verifies a six-digit code within the accepted window", () => {
    const secret = generateTotpSecret(); const timestamp = Date.UTC(2026, 6, 31, 12, 0, 0); const code = generateTotpCode(secret, timestamp);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, timestamp)).toBe(true);
    expect(verifyTotpCode(secret, code, timestamp + 120_000)).toBe(false);
  });

  it("encrypts MFA secrets with authenticated encryption", () => {
    const secret = generateTotpSecret(); const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
    const tampered = `${encrypted.slice(0, 10)}${encrypted[10] === "A" ? "B" : "A"}${encrypted.slice(11)}`;
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });
});
