import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("Salus PWA manifest", () => {
  it("identifies the installed app and uses accessible standalone behavior", () => {
    expect(manifest()).toEqual(expect.objectContaining({
      name: "Salus",
      short_name: "Salus",
      start_url: "/",
      display: "standalone",
      theme_color: "#0c5f5b"
    }));
  });
});
