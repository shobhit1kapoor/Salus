import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./env.js";
import { pool } from "./db.js";
import { validationIssues } from "./errors.js";
import { authRoutes } from "./routes-auth.js";
import { patientRoutes } from "./routes-patients.js";
import { fhirRoutes } from "./routes-fhir.js";
import { privacyRoutes } from "./routes-privacy.js";
import { metricsRegistry, observeRequest } from "./metrics.js";
import { PrivacyUnavailableError, privacyHealth } from "./privacy.js";

const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie", "*.password", "*.token"] }, genReqId: () => crypto.randomUUID(), bodyLimit: 12 * 1024 * 1024 });
await app.register(helmet, { global: true, contentSecurityPolicy: false });
await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PATCH", "PUT", "DELETE"] });
await app.register(cookie, { secret: env.SESSION_SECRET });
await app.register(rateLimit, { global: true, max: 200, timeWindow: "1 minute" });
await app.register(multipart, { limits: { files: 1, fileSize: 20 * 1024 * 1024 } });
await app.register(swagger, { openapi: { info: { title: "Salus API", version: "0.1.0", description: "Patient-scoped caregiving APIs. Every patient route enforces authenticated membership." }, servers: [{ url: "http://localhost:4000" }], components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "salus_session" } } } } });
await app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { docExpansion: "list", deepLinking: true } });

app.addHook("onRequest", async (request, reply) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.cookies.salus_session) {
    const origin = request.headers.origin;
    if (origin && origin !== env.WEB_ORIGIN) return reply.code(403).send({ code: "CSRF_ORIGIN_REJECTED" });
  }
});

app.addHook("onResponse", async (request, reply) => {
  observeRequest(request.method, request.routeOptions.url ?? "unmatched", reply.statusCode, reply.elapsedTime);
});

app.get("/health/live", async () => ({ status: "ok" }));
app.get("/health/ready", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    const privacy = await privacyHealth();
    if (privacy.mode !== "protegrity" || !privacy.protegrityConfigured) return reply.code(503).send({ status: "not_ready", reason: "protegrity_not_configured", privacy });
    return { status: "ready", aiConfigured: Boolean(env.NVIDIA_API_KEY), privacy };
  }
  catch { return reply.code(503).send({ status: "not_ready" }); }
});
app.get("/metrics", async (_request, reply) => {
  reply.header("content-type", metricsRegistry.contentType);
  return metricsRegistry.metrics();
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "request failed");
  if (error instanceof PrivacyUnavailableError) return reply.code(error.status >= 400 && error.status < 500 ? error.status : 503).send({ code: "PRIVACY_CONTROL_UNAVAILABLE", message: error.message, correlationId: request.id });
  const issues = validationIssues(error);
  if (issues) return reply.code(400).send({ code: "VALIDATION_ERROR", issues: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
  if ((error as { code?: string }).code === "23505") return reply.code(409).send({ code: "CONFLICT", message: "A record with that value already exists." });
  if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ code: "FILE_TOO_LARGE" });
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({ code: (error as { code?: string }).code ?? "REQUEST_ERROR", message: "The request is invalid." });
  }
  return reply.code(500).send({ code: "INTERNAL_ERROR", message: "The operation could not be completed.", correlationId: request.id });
});

await app.register(authRoutes);
await app.register(patientRoutes);
await app.register(fhirRoutes);
await app.register(privacyRoutes);

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on("SIGINT", close); process.on("SIGTERM", close);
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
