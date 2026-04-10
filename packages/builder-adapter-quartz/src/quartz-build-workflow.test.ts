import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureQuartzWorkspaceRuntimeMock: vi.fn(),
  readQuartzVersionMock: vi.fn(),
  runQuartzCommandMock: vi.fn()
}));

vi.mock("./quartz-runtime.js", () => ({
  ensureQuartzWorkspaceRuntime: mocks.ensureQuartzWorkspaceRuntimeMock,
  readQuartzVersion: mocks.readQuartzVersionMock
}));

vi.mock("./quartz-command-runner.js", () => ({
  runQuartzCommand: mocks.runQuartzCommandMock
}));

import { createQuartzLogger } from "./quartz-logging.js";
import { runQuartzBuildWorkflow } from "./quartz-build-workflow.js";

describe("quartz build workflow", () => {
  beforeEach(() => {
    mocks.ensureQuartzWorkspaceRuntimeMock.mockReset();
    mocks.readQuartzVersionMock.mockReset();
    mocks.runQuartzCommandMock.mockReset();
  });

  it("returns a successful build result with adapter and Quartz logs", async () => {
    mocks.ensureQuartzWorkspaceRuntimeMock.mockResolvedValue(undefined);
    mocks.readQuartzVersionMock.mockResolvedValue("4.1.0");
    mocks.runQuartzCommandMock.mockResolvedValue({ exitCode: 0 });

    const logger = createQuartzLogger();
    const result = await runQuartzBuildWorkflow({
      config: createConfig(),
      logger,
      quartzPackageRoot: "/quartz",
      workspace: createWorkspace()
    });

    expect(result).toMatchObject({
      success: true,
      outputDir: "/workspace/dist",
      manifestPath: "/workspace/manifest.json"
    });
    expect(result.logs).toEqual([
      expect.objectContaining({ level: "info", message: "[adapter] Using Quartz 4.1.0." })
    ]);
  });

  it("captures a failed workspace setup as a structured failed build", async () => {
    mocks.ensureQuartzWorkspaceRuntimeMock.mockRejectedValue(new Error("Workspace init failed."));

    const result = await runQuartzBuildWorkflow({
      config: createConfig(),
      logger: createQuartzLogger(),
      quartzPackageRoot: "/quartz",
      workspace: createWorkspace()
    });

    expect(result.success).toBe(false);
    expect(result.logs).toEqual([
      expect.objectContaining({ level: "error", message: "[adapter] Workspace init failed." })
    ]);
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
