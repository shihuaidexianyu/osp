import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureQuartzWorkspaceRuntimeMock: vi.fn(),
  readQuartzVersionMock: vi.fn(),
  startStaticQuartzPreviewMock: vi.fn(),
  startWatchedQuartzPreviewMock: vi.fn()
}));

vi.mock("./quartz-runtime.js", () => ({
  ensureQuartzWorkspaceRuntime: mocks.ensureQuartzWorkspaceRuntimeMock,
  readQuartzVersion: mocks.readQuartzVersionMock
}));

vi.mock("./quartz-preview-backends.js", () => ({
  startStaticQuartzPreview: mocks.startStaticQuartzPreviewMock,
  startWatchedQuartzPreview: mocks.startWatchedQuartzPreviewMock
}));

import { createQuartzLogger } from "./quartz-logging.js";
import { runQuartzPreviewWorkflow } from "./quartz-preview-workflow.js";

describe("quartz preview workflow", () => {
  beforeEach(() => {
    mocks.ensureQuartzWorkspaceRuntimeMock.mockReset();
    mocks.readQuartzVersionMock.mockReset();
    mocks.startStaticQuartzPreviewMock.mockReset();
    mocks.startWatchedQuartzPreviewMock.mockReset();
  });

  it("starts the static preview backend when requested", async () => {
    const stopExistingPreview = vi.fn(async () => {});
    const preview = createPreviewResult();

    mocks.ensureQuartzWorkspaceRuntimeMock.mockResolvedValue(undefined);
    mocks.readQuartzVersionMock.mockResolvedValue("4.1.0");
    mocks.startStaticQuartzPreviewMock.mockResolvedValue(preview);

    const result = await runQuartzPreviewWorkflow({
      config: createConfig(),
      logger: createQuartzLogger(),
      port: 8080,
      preferStaticPreview: true,
      quartzPackageRoot: "/quartz",
      readinessTimeoutMs: 1_000,
      stopExistingPreview,
      workspace: createWorkspace(),
      wsPort: 3001
    });

    expect(result).toBe(preview);
    expect(stopExistingPreview).toHaveBeenCalledOnce();
    expect(mocks.startStaticQuartzPreviewMock).toHaveBeenCalledOnce();
    expect(mocks.startWatchedQuartzPreviewMock).not.toHaveBeenCalled();
  });

  it("starts the watched preview backend by default", async () => {
    const stopExistingPreview = vi.fn(async () => {});
    const preview = createPreviewResult();

    mocks.ensureQuartzWorkspaceRuntimeMock.mockResolvedValue(undefined);
    mocks.readQuartzVersionMock.mockResolvedValue("4.1.0");
    mocks.startWatchedQuartzPreviewMock.mockResolvedValue(preview);

    const result = await runQuartzPreviewWorkflow({
      config: createConfig(),
      logger: createQuartzLogger(),
      nodeExecutablePath: "/node",
      port: 8080,
      quartzPackageRoot: "/quartz",
      readinessTimeoutMs: 1_000,
      stopExistingPreview,
      workspace: createWorkspace(),
      wsPort: 3001
    });

    expect(result).toBe(preview);
    expect(stopExistingPreview).toHaveBeenCalledOnce();
    expect(mocks.startWatchedQuartzPreviewMock).toHaveBeenCalledWith(expect.objectContaining({
      nodeExecutablePath: "/node",
      port: 8080,
      readinessTimeoutMs: 1_000,
      wsPort: 3001
    }));
    expect(mocks.startStaticQuartzPreviewMock).not.toHaveBeenCalled();
  });
});

function createPreviewResult() {
  return {
    record: {
      logs: [],
      stop: async () => {}
    },
    session: {
      url: "http://localhost:8080",
      workspaceRoot: "/workspace",
      startedAt: new Date().toISOString()
    }
  };
}

function createWorkspace() {
  return {
    mode: "build" as const,
    rootDir: "/workspace",
    contentDir: "/workspace/content",
    outputDir: "/workspace/dist",
    manifestPath: "/workspace/manifest.json"
  };
}

function createConfig() {
  return {
    vaultRoot: "/vault",
    publishMode: "frontmatter" as const,
    includeGlobs: [],
    excludeGlobs: [],
    outputDir: "/vault/.osp/dist",
    builder: "quartz" as const,
    deployTarget: "none" as const,
    enableSearch: true,
    enableBacklinks: true,
    enableGraph: true,
    strictMode: false
  };
}
