import { createMemoryLogger } from "@osp/shared";
import { describe, expect, it } from "vitest";

import { createPreviewBuildFailureMessage, createPreviewFailureMessage } from "./quartz-preview-support.js";

describe("quartz preview logging", () => {
  it("uses the shared logger entries when formatting preview startup failures", () => {
    const logger = createMemoryLogger();

    logger.info("[quartz] Quartz booting");
    logger.error("[quartz] EADDRINUSE");

    expect(createPreviewFailureMessage(new Error("Quartz preview failed to start."), logger.entries())).toBe(
      "Quartz preview failed to start. Last Quartz log: [quartz] EADDRINUSE"
    );
  });

  it("prefers the last error entry for preview build failures", () => {
    const logger = createMemoryLogger();

    logger.info("[quartz] Generating pages");
    logger.error("[quartz] Cannot find module remark-math");

    expect(createPreviewBuildFailureMessage(logger.entries())).toBe(
      "Quartz preview build failed before the static preview server could start. Last Quartz log: [quartz] Cannot find module remark-math"
    );
  });
});
