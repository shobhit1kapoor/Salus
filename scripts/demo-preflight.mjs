import "dotenv/config";
import { randomUUID } from "node:crypto";

const apiBase = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
const webBase = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const privacyBase = process.env.PRIVACY_GATEWAY_PUBLIC_URL ?? "http://localhost:8080";
const syntheticIdentifier = "123-45-6789";

function ensureConfigured(name) {
  const value = process.env[name];
  if (!value || /^(replace|your_|changeme|placeholder)/i.test(value)) {
    throw new Error(`${name} is missing or still contains a placeholder.`);
  }
  return value;
}

async function request(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function json(url, init = {}) {
  const response = await request(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}: ${body.message ?? body.detail ?? body.code ?? "unknown error"}`);
  return { response, body };
}

async function main() {
  ensureConfigured("NVIDIA_API_KEY");
  ensureConfigured("DEV_EDITION_EMAIL");
  ensureConfigured("DEV_EDITION_PASSWORD");
  ensureConfigured("DEV_EDITION_API_KEY");
  const reviewerEmail = ensureConfigured("SEED_REVIEWER_EMAIL");
  const reviewerPassword = ensureConfigured("SEED_REVIEWER_PASSWORD");

  const web = await request(webBase);
  if (!web.ok) throw new Error(`Web application returned ${web.status}.`);

  const readiness = (await json(`${apiBase}/health/ready`)).body;
  if (readiness.status !== "ready" || readiness.privacy?.mode !== "protegrity" || readiness.privacy?.protegrityConfigured !== true) {
    throw new Error("API is not ready in configured Protegrity mode.");
  }

  const traceId = randomUUID();
  const protectedResult = (await json(`${privacyBase}/v1/protect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `Synthetic patient SSN ${syntheticIdentifier}`, traceId, purpose: "demo_preflight" })
  })).body;
  if (protectedResult.provider !== "protegrity" || protectedResult.aiSafeText.includes(syntheticIdentifier) || protectedResult.discovery?.total < 1) {
    throw new Error("Protegrity protect smoke test did not satisfy the protection postcondition.");
  }
  const egress = (await json(`${privacyBase}/v1/egress/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: protectedResult.aiSafeText, traceId, prohibitedValues: [syntheticIdentifier] })
  })).body;
  if (!egress.safe || egress.discovery?.total !== 0 || egress.canaryMatches !== 0) {
    throw new Error("Protected egress smoke test failed.");
  }

  const login = await json(`${apiBase}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Salus Preflight" },
    body: JSON.stringify({ email: reviewerEmail, password: reviewerPassword })
  });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Reviewer login did not return a session cookie.");
  try {
    const profiles = (await json(`${apiBase}/v1/profiles`, { headers: { cookie } })).body;
    const attacks = (await json(`${apiBase}/v1/privacy/attacks`, { headers: { cookie } })).body;
    if (!Array.isArray(profiles) || profiles.length < 1) throw new Error("No synthetic reviewer profile is available. Run npm run demo:reset.");
    if (!Array.isArray(attacks) || attacks.length !== 40) throw new Error(`Attack Lab catalog contains ${Array.isArray(attacks) ? attacks.length : 0}/40 scenarios.`);

    console.table([
      { gate: "Web application", result: "PASS", evidence: `${web.status}` },
      { gate: "API readiness", result: "PASS", evidence: "Protegrity configured; fail-closed boundary ready" },
      { gate: "Discovery + protect", result: "PASS", evidence: `${protectedResult.discovery.total} synthetic identifier(s); raw absent` },
      { gate: "Protected egress", result: "PASS", evidence: "0 raw identifiers; 0 canaries" },
      { gate: "Reviewer workspace", result: "PASS", evidence: `${profiles.length} protected profile(s)` },
      { gate: "Attack Lab catalog", result: "PASS", evidence: `${attacks.length}/40 scenarios` },
      { gate: "NVIDIA configuration", result: "PASS", evidence: "credential present (not displayed)" }
    ]);
    console.log("Demo preflight passed. No credential or sensitive value was printed.");
  } finally {
    await request(`${apiBase}/v1/auth/logout`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Demo preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
