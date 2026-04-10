import { describe, expect, it } from "vitest";

import { createQuartzLogger, getQuartzLogs, writeQuartzErrorLog, writeQuartzVersionLog } from "./quartz-logging.js";

describe("quartz logging", () => {
  it("prefixes adapter-managed log entries", () => {
    const logger = createQuartzLogger();

    writeQuartzVersionLog(logger, "4.1.0");
    writeQuartzErrorLog(logger, new Error("Workspace init failed."));

    expect(getQuartzLogs(logger)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "[adapter] Using Quartz 4.1.0."
      }),
      expect.objectContaining({
        level: "error",
        message: "[adapter] Workspace init failed."
      })
    ]);
  });
});
