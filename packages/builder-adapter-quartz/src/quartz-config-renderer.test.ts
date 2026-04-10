import { describe, expect, it } from "vitest";

import { resolveQuartzBaseUrl } from "./quartz-config-renderer.js";

describe("quartz config renderer", () => {
  it("normalizes the configured site base url into Quartz format", () => {
    expect(resolveQuartzBaseUrl("https://example.com/docs/")).toBe("example.com/docs");
    expect(resolveQuartzBaseUrl("docs.example.com/subsite/")).toBe("docs.example.com/subsite");
    expect(resolveQuartzBaseUrl(undefined)).toBe("localhost");
  });
});
