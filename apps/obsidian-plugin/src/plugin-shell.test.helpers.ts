import type { BuildResult, DeployResult, PreviewSession, PublisherConfig, VaultManifest } from "@osp/shared";
import { vi } from "vitest";

import type { PluginExecutionBackend } from "./plugin-backend.js";

export function createBackend(options: {
  scanResult?: { manifest: VaultManifest; issues: BuildResult["issues"]; logPath?: string };
  buildResult?: { result: BuildResult; logPath?: string };
  previewResult?: { session: PreviewSession; logPath?: string };
  publishResult?: { build: BuildResult; deploy?: DeployResult; logPath?: string };
} = {}): PluginExecutionBackend & { dispose: ReturnType<typeof vi.fn> } {
  return {
    scan: vi.fn(async () => options.scanResult ?? { manifest: createManifest("/vault"), issues: [] }),
    build: vi.fn(async () => options.buildResult ?? { result: createBuildResult() }),
    preview: vi.fn(async () => options.previewResult ?? { session: createPreviewSession() }),
    previewBuilt: vi.fn(async () => options.previewResult ?? { session: createPreviewSession() }),
    publish: vi.fn(async () => options.publishResult ?? {
      build: createBuildResult(),
      deploy: createDeployResult()
    }),
    deployBuilt: vi.fn(async () => ({
      deploy: createDeployResult(),
      logPath: "/vault/.osp/logs/deploy.log"
    })),
    dispose: vi.fn(async () => {})
  };
}

export function createConfig(vaultRoot: string): PublisherConfig {
  return {
    vaultRoot,
    publishMode: "frontmatter",
    includeGlobs: [],
    excludeGlobs: [],
    outputDir: `${vaultRoot}/.osp/dist`,
    builder: "quartz",
    deployTarget: "none",
    enableSearch: true,
    enableBacklinks: true,
    enableGraph: true,
    strictMode: false
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
    outputDir: "/vault/.osp/dist",
    manifestPath: "/vault/.osp/build/manifest.json",
    issues: [],
    logs: [],
    durationMs: 1,
    ...overrides
  };
}

export function createPreviewSession(): PreviewSession {
  return {
    success: true as const,
    url: "http://localhost:8080",
    workspaceRoot: "/vault/.osp/preview",
    startedAt: new Date().toISOString()
  };
}

export function createDeployResult(): DeployResult {
  return {
    success: true,
    target: "none",
    destination: "/vault/.osp/dist",
    message: "Published."
  };
}
