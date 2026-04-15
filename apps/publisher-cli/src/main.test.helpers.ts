import type { BuildResult, DeployResult, PreviewSession, PublisherConfig, VaultManifest } from "@osp/shared";
import { vi } from "vitest";

export function createStubRuntime(options: {
  buildResult?: BuildResult;
  previewSession?: PreviewSession;
  deployResult?: DeployResult;
} = {}) {
  return {
    orchestrator: {
      scan: vi.fn(async (config: PublisherConfig) => ({
        manifest: createManifest(config.vaultRoot),
        issues: []
      })),
      build: vi.fn(async () => options.buildResult ?? createBuildResult()),
      preview: vi.fn(async () => options.previewSession ?? createPreviewSession()),
      deployFromBuild: vi.fn(async () => options.deployResult ?? createDeployResult())
    },
    stop: vi.fn(async () => { })
  };
}

export function createCapturedOutput() {
  return {
    logs: [] as string[],
    errors: [] as string[],
    log(message: string) {
      this.logs.push(message);
    },
    error(message: string) {
      this.errors.push(message);
    }
  };
}

export function createManifest(vaultRoot: string): VaultManifest {
  return {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    notes: [],
    assetFiles: [],
    unsupportedObjects: []
  };
}

export function createBuildResult(overrides: Partial<BuildResult> = {}): BuildResult {
  return {
    success: true,
    outputDir: "/workspace/dist",
    manifestPath: "/workspace/manifest.json",
    issues: [],
    logs: [
      {
        level: "info",
        message: "Quartz build finished.",
        timestamp: "2026-03-18T11:11:13.000Z"
      }
    ],
    durationMs: 12,
    ...overrides
  };
}

export function createPreviewSession(): PreviewSession {
  return {
    success: true as const,
    url: "http://localhost:8080",
    workspaceRoot: "/workspace",
    startedAt: new Date().toISOString()
  };
}

export function createDeployResult(): DeployResult {
  return {
    success: true,
    target: "none",
    destination: "/workspace/dist",
    message: "Deployed."
  };
}
