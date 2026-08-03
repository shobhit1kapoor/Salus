import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRecoveryCodes, createSession, currentUser, decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashAuthToken, hashPassword, markCurrentSessionMfa, revokeCurrentSession, sessionCookie, verifyPassword, verifyTotpCode } from "./auth.js";
import { pool, withUser } from "./db.js";
import { sendMail } from "./mail.js";
import { env } from "./env.js";
import { privacyTraceId, protectText, recordProtectionReceipt } from "./privacy.js";

const credentials = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(12).max(128) });
const tokenHash = hashAuthToken;
const demoLoginEnabled = () => {
  const hostname = new URL(env.WEB_ORIGIN).hostname;
  return env.DEMO_LOGIN_ENABLED && (hostname === "localhost" || hostname === "127.0.0.1");
};

export async function authRoutes(app: FastifyInstance) {
  app.get("/v1/auth/demo-status", async () => ({ enabled: demoLoginEnabled() }));

  app.post("/v1/auth/demo-login", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (request, reply) => {
    if (!demoLoginEnabled()) return reply.code(404).send({ code: "NOT_FOUND", message: "Demo login is unavailable." });
    const protectedEmail = await protectText(env.SEED_REVIEWER_EMAIL.toLowerCase(), privacyTraceId(), "account_security");
    const result = await pool.query<{ id: string }>("SELECT id FROM users WHERE identity_fingerprint=$1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL", [protectedEmail.fingerprint]);
    const user = result.rows[0];
    if (!user) return reply.code(503).send({ code: "DEMO_UNAVAILABLE", message: "The synthetic demo workspace has not been seeded." });
    const session = await createSession(user.id, request);
    const cookie = sessionCookie(session.raw, session.expiresAt);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    return { message: "Synthetic demo session started." };
  });

  app.post("/v1/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = credentials.extend({ displayName: z.string().trim().min(1).max(120) }).parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const traceId = privacyTraceId();
    const [email, displayName] = await Promise.all([protectText(body.email, traceId, "account_security"), protectText(body.displayName, traceId, "account_security")]);
    const result = await pool.query<{ id: string }>(`INSERT INTO users(email,email_protected,password_hash,display_name,display_name_protected,identity_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (identity_fingerprint) WHERE identity_fingerprint IS NOT NULL AND deleted_at IS NULL DO NOTHING
      RETURNING id`, [email.aiSafeText, email.canonicalProtected, passwordHash, displayName.aiSafeText, displayName.canonicalProtected, email.fingerprint]);
    if (!result.rows[0]) return reply.code(409).send({ code: "ACCOUNT_EXISTS", message: "An account already exists for this email." });
    const raw = randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES($1,'verify_email',$2,now()+interval '24 hours')", [result.rows[0].id, tokenHash(raw)]);
    await sendMail(body.email, "Verify your Salus email", `Open ${env.WEB_ORIGIN}/verify-email?token=${raw} to verify your account. This link expires in 24 hours.`);
    await withUser(result.rows[0].id, (db) => recordProtectionReceipt(db, { traceId, actorId: result.rows[0].id, operation: "account.register", purpose: "account_security", status: "protected", stages: [{ stage: "discover", outcome: "passed" }, { stage: "protect", outcome: "passed", durationMs: email.durationMs }, { stage: "persist", outcome: "passed", detail: "protected identity envelope and pseudonym" }], entityCounts: email.entityCounts, provider: email.provider }));
    return reply.code(201).send({ message: "Registration created. Check your email to verify the account." });
  });

  app.post("/v1/auth/verify-email", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(request.body);
    const result = await pool.query<{ user_id: string }>(`UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND kind='verify_email' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id`, [tokenHash(token)]);
    if (!result.rowCount) return reply.code(400).send({ code: "INVALID_TOKEN", message: "Verification link is invalid or expired." });
    await pool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [result.rows[0].user_id]);
    return { message: "Email verified." };
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = credentials.parse(request.body);
    const protectedEmail = await protectText(body.email, privacyTraceId(), "account_security");
    const result = await pool.query<{ id: string; password_hash: string; email_verified_at: Date | null; mfa_enabled_at: Date | null }>("SELECT id,password_hash,email_verified_at,mfa_enabled_at FROM users WHERE identity_fingerprint=$1 AND deleted_at IS NULL", [protectedEmail.fingerprint]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(user.password_hash, body.password))) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." });
    if (!user.email_verified_at) return reply.code(403).send({ code: "EMAIL_NOT_VERIFIED", message: "Verify your email before signing in." });
    if (user.mfa_enabled_at) {
      const raw = randomBytes(32).toString("base64url");
      await pool.query("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES($1,'mfa_login',$2,now()+interval '5 minutes')", [user.id, tokenHash(raw)]);
      return reply.code(202).send({ mfaRequired: true, challengeToken: raw, message: "Enter your authenticator code." });
    }
    const session = await createSession(user.id, request);
    const cookie = sessionCookie(session.raw, session.expiresAt);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    return { message: "Signed in." };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await revokeCurrentSession(request); reply.clearCookie("salus_session", { path: "/" }); return { message: "Signed out." };
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Sign in required." });
    const security = await pool.query<{ mfa_enabled_at: Date | null }>("SELECT mfa_enabled_at FROM users WHERE id=$1", [user.id]);
    return { id: user.id, email: "Protected email", displayName: "Salus member", mfaEnabled: Boolean(security.rows[0]?.mfa_enabled_at) };
  });

  app.post("/v1/auth/mfa/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = z.object({ challengeToken: z.string().min(20), code: z.string().optional(), recoveryCode: z.string().optional() }).refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), "Provide either an authenticator code or a recovery code.").parse(request.body);
    const challenge = await pool.query<{ id: string; user_id: string; mfa_secret_encrypted: string }>(`SELECT t.id,t.user_id,u.mfa_secret_encrypted FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.kind='mfa_login' AND t.consumed_at IS NULL AND t.expires_at>now() AND u.mfa_enabled_at IS NOT NULL AND u.deleted_at IS NULL`, [tokenHash(body.challengeToken)]);
    const row = challenge.rows[0];
    if (!row) return reply.code(401).send({ code: "INVALID_MFA_CHALLENGE", message: "The MFA challenge is invalid or expired." });
    let recoveryHash: string | undefined;
    if (body.code) {
      if (!verifyTotpCode(decryptMfaSecret(row.mfa_secret_encrypted), body.code)) return reply.code(401).send({ code: "INVALID_MFA_CODE", message: "The authenticator code is incorrect." });
    } else {
      recoveryHash = tokenHash(body.recoveryCode!.replace(/[^a-z0-9]/gi, "").toUpperCase());
      const recovery = await pool.query("SELECT 1 FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL", [row.user_id, recoveryHash]);
      if (!recovery.rowCount) return reply.code(401).send({ code: "INVALID_RECOVERY_CODE", message: "The recovery code is invalid or already used." });
    }
    const consumed = await pool.query("UPDATE auth_tokens SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id", [row.id]);
    if (!consumed.rowCount) return reply.code(401).send({ code: "INVALID_MFA_CHALLENGE" });
    if (recoveryHash) await pool.query("UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL", [row.user_id, recoveryHash]);
    const session = await createSession(row.user_id, request, true); const cookie = sessionCookie(session.raw, session.expiresAt);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    return { message: "Signed in with multi-factor authentication." };
  });

  app.post("/v1/auth/mfa/step-up", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const result = await pool.query<{ mfa_secret_encrypted: string | null; mfa_enabled_at: Date | null }>("SELECT mfa_secret_encrypted,mfa_enabled_at FROM users WHERE id=$1", [user.id]);
    const account = result.rows[0];
    if (!account?.mfa_enabled_at || !account.mfa_secret_encrypted) return reply.code(409).send({ code: "MFA_REQUIRED", message: "Enable multi-factor authentication before revealing sensitive health information." });
    if (!verifyTotpCode(decryptMfaSecret(account.mfa_secret_encrypted), code)) return reply.code(401).send({ code: "INVALID_MFA_CODE" });
    if (!await markCurrentSessionMfa(request)) return reply.code(401).send({ code: "SESSION_EXPIRED" });
    return { verified: true, validForMinutes: 10 };
  });

  app.post("/v1/auth/mfa/setup", async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const current = await pool.query<{ mfa_enabled_at: Date | null }>("SELECT mfa_enabled_at FROM users WHERE id=$1", [user.id]);
    if (current.rows[0]?.mfa_enabled_at) return reply.code(409).send({ code: "MFA_ALREADY_ENABLED" });
    const secret = generateTotpSecret();
    await pool.query("UPDATE users SET mfa_secret_encrypted=$1 WHERE id=$2", [encryptMfaSecret(secret), user.id]);
    const issuer = encodeURIComponent("Salus"); const label = encodeURIComponent("Salus:protected-account");
    return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
  });

  app.post("/v1/auth/mfa/confirm", async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const result = await pool.query<{ mfa_secret_encrypted: string | null; mfa_enabled_at: Date | null }>("SELECT mfa_secret_encrypted,mfa_enabled_at FROM users WHERE id=$1", [user.id]);
    const account = result.rows[0];
    if (!account?.mfa_secret_encrypted || account.mfa_enabled_at) return reply.code(409).send({ code: "MFA_SETUP_NOT_PENDING" });
    if (!verifyTotpCode(decryptMfaSecret(account.mfa_secret_encrypted), code)) return reply.code(400).send({ code: "INVALID_MFA_CODE", message: "The authenticator code is incorrect." });
    const recoveryCodes = createRecoveryCodes();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET mfa_enabled_at=now() WHERE id=$1", [user.id]);
      await client.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [user.id]);
      for (const recoveryCode of recoveryCodes) await client.query("INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)", [user.id, tokenHash(recoveryCode.replace("-", ""))]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { message: "Multi-factor authentication enabled.", recoveryCodes };
  });

  app.post("/v1/auth/mfa/disable", async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const body = z.object({ password: z.string().min(12).max(128), code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const result = await pool.query<{ password_hash: string; mfa_secret_encrypted: string | null; mfa_enabled_at: Date | null }>("SELECT password_hash,mfa_secret_encrypted,mfa_enabled_at FROM users WHERE id=$1", [user.id]);
    const account = result.rows[0];
    if (!account?.mfa_enabled_at || !account.mfa_secret_encrypted) return reply.code(409).send({ code: "MFA_NOT_ENABLED" });
    if (!await verifyPassword(account.password_hash, body.password) || !verifyTotpCode(decryptMfaSecret(account.mfa_secret_encrypted), body.code)) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Password or authenticator code is incorrect." });
    await pool.query("UPDATE users SET mfa_secret_encrypted=NULL,mfa_enabled_at=NULL WHERE id=$1", [user.id]);
    await pool.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [user.id]);
    return { message: "Multi-factor authentication disabled." };
  });

  app.get("/v1/auth/sessions", async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const result = await pool.query("SELECT id,created_at,expires_at,user_agent,revoked_at IS NULL AS active FROM sessions WHERE user_id=$1 ORDER BY created_at DESC", [user.id]);
    return result.rows;
  });

  app.delete("/v1/auth/sessions/:sessionId", async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2", [sessionId, user.id]);
    return reply.code(204).send();
  });

  app.post("/v1/auth/password-reset/request", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const { email } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()) }).parse(request.body);
    const protectedEmail = await protectText(email, privacyTraceId(), "account_security");
    const result = await pool.query<{ id: string }>("SELECT id FROM users WHERE identity_fingerprint=$1 AND deleted_at IS NULL", [protectedEmail.fingerprint]);
    if (result.rows[0]) {
      const raw = randomBytes(32).toString("base64url");
      await pool.query("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES($1,'reset_password',$2,now()+interval '1 hour')", [result.rows[0].id, tokenHash(raw)]);
      await sendMail(email, "Reset your Salus password", `Open ${env.WEB_ORIGIN}/reset-password?token=${raw} to reset your password. This link expires in one hour.`);
    }
    return reply.code(202).send({ message: "If the account exists, a reset email has been sent." });
  });

  app.post("/v1/auth/password-reset/confirm", async (request, reply) => {
    const body = z.object({ token: z.string().min(20), password: z.string().min(12).max(128) }).parse(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ user_id: string }>(`UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND kind='reset_password' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id`, [tokenHash(body.token)]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ code: "INVALID_TOKEN" }); }
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await hashPassword(body.password), result.rows[0].user_id]);
      await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [result.rows[0].user_id]);
      await client.query("COMMIT");
      return { message: "Password reset. Sign in again." };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });

  app.delete("/v1/auth/account", async (request, reply) => {
    const user = await currentUser(request); if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED" });
    const { password } = z.object({ password: z.string().min(12).max(128) }).parse(request.body);
    const account = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1 AND deleted_at IS NULL", [user.id]);
    if (!account.rows[0] || !await verifyPassword(account.rows[0].password_hash, password)) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Password is incorrect." });
    const soleOwnership = await pool.query(`SELECT p.id FROM patients p JOIN patient_members m ON m.patient_id=p.id AND m.user_id=$1 AND m.role='owner' AND m.revoked_at IS NULL WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM patient_members other WHERE other.patient_id=p.id AND other.user_id<>$1 AND other.role='owner' AND other.revoked_at IS NULL) LIMIT 1`, [user.id]);
    if (soleOwnership.rowCount) return reply.code(409).send({ code: "TRANSFER_OR_DELETE_PATIENTS_FIRST", message: "Transfer ownership or permanently delete every solely owned patient workspace first." });
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [user.id]);
    await pool.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [user.id]);
    reply.clearCookie("salus_session", { path: "/" });
    return reply.code(204).send();
  });
}
