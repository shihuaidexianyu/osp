import type { BuilderAdapter } from "@osp/builder-adapter-quartz";
import type { DeployAdapter } from "@osp/deploy-adapters";
import type { DiagnosticsEngine } from "@osp/diagnostics";
import type { ScanResult, VaultParser } from "@osp/parser";
import type { StagingService } from "@osp/staging";
import type { BuildIssue, BuildResult, DeployResult, PreviewSession, PublisherConfig, VaultManifest } from "@osp/shared";

export type ScanReport = {
  manifest: VaultManifest;
  issues: BuildIssue[];
};

export type PublisherDependencies = {
  parser: VaultParser;
  diagnostics: DiagnosticsEngine;
  staging: StagingService;
  builder: BuilderAdapter;
  deploy: DeployAdapter;
};

export class PublisherOrchestrator {
  public constructor(private readonly dependencies: PublisherDependencies) {}

  public async scan(config: PublisherConfig): Promise<ScanReport> {
    const scanResult = await this.dependencies.parser.scanVault({
      vaultRoot: config.vaultRoot,
      config
    });

    return this.createScanReport(scanResult, config);
  }

  public async build(config: PublisherConfig): Promise<BuildResult> {
    const { manifest, issues } = await this.scan(config);
    const workspace = await this.dependencies.staging.prepare({
      config,
      manifest,
      mode: "build"
    });

    if (shouldBlockAction(issues, config)) {
      return createBlockedBuildResult(workspace.manifestPath, issues, config);
    }

    const result = await this.dependencies.builder.build(workspace, config);

    return {
      ...result,
      issues: [...issues, ...result.issues]
    };
  }

  public async preview(config: PublisherConfig): Promise<PreviewSession> {
    const { manifest, issues } = await this.scan(config);

    if (shouldBlockAction(issues, config)) {
      return createBlockedPreviewResult(issues, config);
    }

    if (this.dependencies.builder.preview === undefined) {
      return {
        success: false as const,
        issues: [],
        message: "Active builder adapter does not support preview."
      };
    }

    const workspace = await this.dependencies.staging.prepare({
      config,
      manifest,
      mode: "preview"
    });

    return this.dependencies.builder.preview(workspace, config);
  }

  public async deployFromBuild(build: BuildResult, config: PublisherConfig): Promise<DeployResult> {
    try {
      return await this.dependencies.deploy.deploy(build, config);
    } catch (error) {
      return {
        success: false,
        target: config.deployTarget,
        message: formatDeployError(error)
      };
    }
  }

  private createScanReport(scanResult: ScanResult, config: PublisherConfig): ScanReport {
    return {
      manifest: scanResult.manifest,
      issues: this.dependencies.diagnostics.analyze(scanResult.manifest, config)
    };
  }
}

function shouldBlockAction(issues: BuildIssue[], config: PublisherConfig): boolean {
  return issues.some((issue) => issue.severity === "error" || (config.strictMode && issue.severity === "warning"));
}

function createBlockedBuildResult(
  manifestPath: string,
  issues: BuildIssue[],
  config: PublisherConfig
): BuildResult {
  return {
    success: false,
    manifestPath,
    issues,
    logs: [
      {
        level: "warning",
        message: createBlockedActionMessage("build", issues, config),
        timestamp: new Date().toISOString()
      }
    ],
    durationMs: 0
  };
}

function createBlockedPreviewResult(
  issues: BuildIssue[],
  config: PublisherConfig
): PreviewSession & { success: false } {
  return {
    success: false as const,
    issues,
    message: createBlockedActionMessage("preview", issues, config)
  };
}

function createBlockedActionMessage(
  action: "build" | "preview",
  issues: BuildIssue[],
  config: PublisherConfig
): string {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  if (errorCount > 0) {
    return `Cannot ${action} while ${errorCount} error issue(s) remain unresolved.`;
  }

  if (config.strictMode && warningCount > 0) {
    return `Cannot ${action} in strict mode while ${warningCount} warning issue(s) remain unresolved.`;
  }

  return `Cannot ${action} because blocking issues were detected.`;
}

function formatDeployError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return `Deploy failed: ${String(error)}`;
}
