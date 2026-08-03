import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { FastifyRequest } from "fastify";
import { pool } from "./db.js";
import { env } from "./env.js";

const COOKIE = "salus_session";
export const hashAuthToken = (value: string) => createHash("sha256").update(value).digest("hex");
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(input: Buffer) {
  let bits = ""; let output = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  for (let index = 0; index < bits.length; index += 5) output += BASE32[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  return output;
}

function decodeBase32(input: string) {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const value = BASE32.indexOf(character);
    if (value < 0) throw new Error("Invalid base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret() { return encodeBase32(randomBytes(20)); }

export function generateTotpCode(secret: string, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function verifyTotpCode(secret: string, code: string, timestamp = Date.now()) {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = Buffer.from(generateTotpCode(secret, timestamp + window * 30_000));
    const actual = Buffer.from(normalized);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function encryptMfaSecret(secret: string) {
  const key = Buffer.from(env.OBJECT_ENCRYPTION_KEY, "base64"); const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv); const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptMfaSecret(payload: string) {
  const body = Buffer.from(payload, "base64url");
  if (body.length < 29) throw new Error("Invalid encrypted MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.OBJECT_ENCRYPTION_KEY, "base64"), body.subarray(0, 12));
  decipher.setAuthTag(body.subarray(12, 28));
  return Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString("utf8");
}

export function createRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export async function createSession(userId: string, request: FastifyRequest, mfaVerified = false) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await pool.query("INSERT INTO sessions(user_id, token_hash, expires_at, ip_hash, user_agent, mfa_verified_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() ELSE NULL END)", [userId, hashAuthToken(raw), expiresAt, hashAuthToken(request.ip), request.headers["user-agent"]?.slice(0, 500) ?? null, mfaVerified]);
  return { raw, expiresAt };
}

export function sessionCookie(token: string, expiresAt: Date) {
  return { name: COOKIE, value: token, options: { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax" as const, path: "/", expires: expiresAt } };
}

export async function currentUser(request: FastifyRequest) {
  const token = request.cookies[COOKIE];
  if (!token) return null;
  const result = await pool.query<{ id: string; email: string; display_name: string }>(`SELECT u.id,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.deleted_at IS NULL`, [hashAuthToken(token)]);
  return result.rows[0] ?? null;
}

export async function hasRecentMfa(request: FastifyRequest, windowMinutes = 10) {
  const token = request.cookies[COOKIE];
  if (!token) return false;
  const result = await pool.query<{ recent: boolean }>("SELECT COALESCE(mfa_verified_at > now()-make_interval(mins=>$2),false) AS recent FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [hashAuthToken(token), windowMinutes]);
  return result.rows[0]?.recent ?? false;
}

export async function markCurrentSessionMfa(request: FastifyRequest) {
  const token = request.cookies[COOKIE];
  if (!token) return false;
  const result = await pool.query("UPDATE sessions SET mfa_verified_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [hashAuthToken(token)]);
  return Boolean(result.rowCount);
}

export async function revokeCurrentSession(request: FastifyRequest) {
  const token = request.cookies[COOKIE];
  if (token) await pool.query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", [hashAuthToken(token)]);
}

export async function hashPassword(password: string) { return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }); }
export async function verifyPassword(hash: string, password: string) { return argon2.verify(hash, password); }
