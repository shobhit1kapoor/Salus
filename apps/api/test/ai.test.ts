import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://salus:salus@localhost:5432/salus",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  WEB_ORIGIN: "http://localhost:3000",
  NVIDIA_API_KEY: "nvapi-test-only",
  NVIDIA_CHAT_MODEL: "moonshotai/kimi-k2.6",
  NVIDIA_CHAT_FALLBACK_MODEL: "meta/llama-3.1-8b-instruct",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "salus-test",
  S3_ACCESS_KEY: "test-access",
  S3_SECRET_KEY: "test-secret-key",
  OBJECT_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64")
});

const { createGroundedReply, embed } = await import("../src/ai.js");
const { env } = await import("../src/env.js");

const source = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Care note",
  content: "The patient drank a glass of water."
};

function completion(answer: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ answer, citations: [{ sourceId: "source-1", label: source.label }] }) } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("hosted NVIDIA chat fallback", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses Kimi when the primary hosted model succeeds", async () => {
    fetchMock.mockResolvedValueOnce(completion("Primary answer"));

    const result = await createGroundedReply("What happened?", [source]);

    expect(result).toMatchObject({
      answer: "Primary answer",
      provider: "nvidia",
      requestedModel: env.NVIDIA_CHAT_MODEL,
      model: env.NVIDIA_CHAT_MODEL,
      fallbackUsed: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to another hosted NVIDIA model when Kimi is unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(completion("Fallback answer"));

    const result = await createGroundedReply("What happened?", [source]);

    expect(result).toMatchObject({
      answer: "Fallback answer",
      requestedModel: env.NVIDIA_CHAT_MODEL,
      model: env.NVIDIA_CHAT_FALLBACK_MODEL,
      fallbackUsed: true,
      fallbackReason: "provider_http_404"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ model: env.NVIDIA_CHAT_FALLBACK_MODEL });
  });

  it("fails closed for an invalid or unauthorized API key", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    await expect(createGroundedReply("What happened?", [source])).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      status: 401,
      fallbackEligible: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an outage when both hosted NVIDIA models are unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));

    await expect(createGroundedReply("What happened?", [source])).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      status: 404
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes optional nulls and uses authoritative citation labels", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        answer: "Grounded answer",
        citations: [{ sourceId: "source-1", label: "Model supplied label" }],
        uncertainty: null,
        proposedEvent: null
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await createGroundedReply("What happened?", [source]);

    expect(result.citations).toEqual([{ sourceId: source.id, label: source.label }]);
    expect(result.uncertainty).toBeUndefined();
  });

  it("repairs a malformed citation response once without weakening the allowlist", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: "No verified protocol was supplied.", citations: ["Caregiver message"] }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(completion("No verified protocol was supplied."));

    const result = await createGroundedReply("Apply an unknown protocol.", [source]);

    expect(result.answer).toBe("No verified protocol was supplied.");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("protects the complete prompt, hides database UUIDs, and inspects the exact provider payload", async () => {
    fetchMock.mockResolvedValueOnce(completion("Protected answer"));
    const protectPrompt = vi.fn(async (prompt: string) => prompt.replace("Care note", "Protected source"));
    let observedSerialized = "";
    const observePayload = vi.fn(async (payload: { serialized: string }) => { observedSerialized = payload.serialized; });

    const result = await createGroundedReply("What happened?", [source], observePayload, protectPrompt);

    expect(result.citations).toEqual([{ sourceId: source.id, label: source.label }]);
    expect(protectPrompt).toHaveBeenCalledTimes(1);
    expect(observePayload).toHaveBeenCalledTimes(1);
    expect(observedSerialized).toContain("source-1");
    expect(observedSerialized).toContain("Protected source");
    expect(observedSerialized).not.toContain(source.id);
  });
});

describe("hosted NVIDIA embeddings", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the supported OpenAI-compatible endpoint with explicit safe truncation", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 1024 }, () => 0.25) }] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const vector = await embed("care note", "passage");

    expect(vector).toHaveLength(1024);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://integrate.api.nvidia.com/v1/embeddings");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "nvidia/nv-embedqa-e5-v5", input: ["care note"], input_type: "passage", truncate: "END" });
  });
});
