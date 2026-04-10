import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuartzCommandMock: vi.fn(),
  spawnQuartzCommandMock: vi.fn(),
  waitForQuartzProcessExitMock: vi.fn(),
  startStaticPreviewServerMock: vi.fn(),
  waitForPortReadyMock: vi.fn()
}));

vi.mock("./quartz-command-runner.js", () => ({
  runQuartzCommand: mocks.runQuartzCommandMock,
  spawnQuartzCommand: mocks.spawnQuartzCommandMock,
  waitForQuartzProcessExit: mocks.waitForQuartzProcessExitMock
}));

vi.mock("./quartz-preview-support.js", () => ({
  createPreviewBuildFailureMessage: vi.fn(() => "Quartz preview build failed before the static preview server could start."),
  createPreviewFailureMessage: vi.fn(() => "Quartz preview exited before becoming ready with code 1."),
  delay: vi.fn(async () => {}),
  startStaticPreviewServer: mocks.startStaticPreviewServerMock,
  waitForPortReady: mocks.waitForPortReadyMock
}));

import { createQuartzLogger } from "./quartz-logging.js";
import { startStaticQuartzPreview, startWatchedQuartzPreview } from "./quartz-preview-backends.js";

describe("quartz preview backends", () => {
  beforeEach(() => {
    mocks.runQuartzCommandMock.mockReset();
    mocks.spawnQuartzCommandMock.mockReset();
    mocks.waitForQuartzProcessExitMock.mockReset();
    mocks.startStaticPreviewServerMock.mockReset();
    mocks.waitForPortReadyMock.mockReset();
  });

  it("starts the static preview backend after a successful Quartz build", async () => {
    mocks.runQuartzCommandMock.mockResolvedValue({ exitCode: 0 });
    mocks.startStaticPreviewServerMock.mockResolvedValue({
      close: (callback: (error?: Error) => void) => callback()
    });

    const preview = await startStaticQuartzPreview({
      logger: createQuartzLogger(),
      port: 8080,
      workspace: createWorkspace()
    });

    expect(preview.session.success).toBe(true);
    if (preview.session.success) {
      expect(preview.session.url).toBe("http://localhost:8080");
    }
    await expect(preview.record.stop()).resolves.toBeUndefined();
  });

  it("starts the watched preview backend and returns a stoppable record", async () => {
    const child = {
      killed: false,
      exitCode: null,
      kill: vi.fn()
    };

    mocks.spawnQuartzCommandMock.mockReturnValue(child);
    mocks.waitForQuartzProcessExitMock.mockResolvedValue(0);
    mocks.waitForPortReadyMock.mockResolvedValue(undefined);

    const preview = await startWatchedQuartzPreview({
      logger: createQuartzLogger(),
      port: 8080,
      readinessTimeoutMs: 500,
      workspace: createWorkspace(),
      wsPort: 3001
    });

    expect(preview.session.success).toBe(true);
    if (preview.session.success) {
      expect(preview.session.url).toBe("http://localhost:8080");
    }
    await expect(preview.record.stop()).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledOnce();
  });
});

function createWorkspace() {
  return {
    mode: "build" as const,
    rootDir: "/workspace",
    contentDir: "/workspace/content",
    outputDir: "/workspace/dist",
    manifestPath: "/workspace/manifest.json"
  };
}
