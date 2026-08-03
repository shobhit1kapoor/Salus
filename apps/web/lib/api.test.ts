import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api request headers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not declare JSON content for an empty request body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await api("/v1/empty-action", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/empty-action",
      expect.objectContaining({ headers: undefined })
    );
  });

  it("declares JSON content when a JSON body is present", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await api("/v1/example", { method: "POST", body: JSON.stringify({ value: 1 }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/example",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) })
    );
  });
});
