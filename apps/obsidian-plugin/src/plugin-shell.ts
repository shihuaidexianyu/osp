import type { BuildIssue, BuildLogEntry, BuildResult, DeployResult, PreviewSession, PublisherConfig, VaultManifest } from "@osp/shared";

import type {
  PluginExecutionBackend,
  PluginPublishResult,
  PluginScanResult
} from "./plugin-backend.js";
import { getPluginErrorLogPath } from "./plugin-backend.js";

export const pluginManifest = {
  id: "obsidian-site-publisher",
  name: "站点发布"
} as const;

export type PluginCommand = "preview" | "build" | "publish" | "issues";

export type PluginCommandDefinition = {
  id: string;
  name: string;
  command: PluginCommand;
};

export type PluginExecutionState = {
  lastCommand?: PluginCommand | undefined;
  lastUpdatedAt?: string | undefined;
  statusMessage?: string | undefined;
  lastLogPath?: string | undefined;
  lastManifest?: VaultManifest | undefined;
  lastIssues: BuildIssue[];
  lastLogs: BuildLogEntry[];
  lastBuildResult?: BuildResult | undefined;
  lastPreviewSession?: PreviewSession | undefined;
  lastDeployResult?: DeployResult | undefined;
};

export type PluginCommandResult =
  | {
      command: "issues";
      manifest: VaultManifest;
      issues: BuildIssue[];
      statusMessage: string;
    }
  | {
      command: "build";
      result: BuildResult;
      statusMessage: string;
    }
  | {
      command: "preview";
      session: PreviewSession;
      statusMessage: string;
    }
  | {
      command: "publish";
      build: BuildResult;
      deploy?: DeployResult;
      statusMessage: string;
    };

const defaultState: PluginExecutionState = {
  lastIssues: [],
  lastLogs: []
};

const maxStoredLogEntries = 40;

export class PublisherPluginShell {
  private state: PluginExecutionState = defaultState;
  private activePreviewBackend: PluginExecutionBackend | undefined;
  private reusableBuild:
    | {
        configKey: string;
        build: BuildResult;
      }
    | undefined;

  public constructor(private readonly createBackend: () => PluginExecutionBackend = createUnavailableBackend) {}

  public getSupportedCommands(): PluginCommand[] {
    return this.getCommandDefinitions().map((definition) => definition.command);
  }

  public getCommandDefinitions(): PluginCommandDefinition[] {
    return [
      createCommandDefinition("preview", "启动站点预览"),
      createCommandDefinition("build", "构建站点"),
      createCommandDefinition("publish", "发布站点"),
      createCommandDefinition("issues", "检查发布问题")
    ];
  }

  public createInitialConfig(vaultRoot: string): PublisherConfig {
    return {
      vaultRoot,
      publishMode: "frontmatter",
      includeGlobs: [],
      excludeGlobs: ["**/.git/**", "**/.obsidian/**", "**/.osp/**", "**/.trash/**", "**/node_modules/**"],
      outputDir: `${vaultRoot}/.osp/dist`,
      builder: "quartz",
      deployTarget: "none",
      enableSearch: true,
      enableBacklinks: true,
      enableGraph: true,
      strictMode: false
    };
  }

  public getState(): PluginExecutionState {
    return {
      ...this.state,
      lastIssues: [...this.state.lastIssues],
      lastLogs: [...this.state.lastLogs]
    };
  }

  public async dispose(): Promise<void> {
    await this.stopActivePreview();
  }

  public async stopPreview(): Promise<boolean> {
    if (this.activePreviewBackend === undefined) {
      return false;
    }

    await this.stopActivePreview();
    this.updateState({
      lastCommand: "preview",
      statusMessage: "预览已停止。",
      lastPreviewSession: undefined,
      lastLogs: []
    });
    return true;
  }

  public invalidateReusableBuild(): void {
    this.reusableBuild = undefined;
  }

  public async runCommand(command: PluginCommand, config: PublisherConfig): Promise<PluginCommandResult> {
    switch (command) {
      case "issues":
        return this.withEphemeralBackend(async (backend) => this.runIssuesCommand(backend, config));
      case "build":
        return this.withEphemeralBackend(async (backend) => this.runBuildCommand(backend, config));
      case "preview":
        return this.runPreviewCommand(config);
      case "publish":
        return this.withEphemeralBackend(async (backend) => this.runPublishCommand(backend, config));
    }
  }

  private async runIssuesCommand(backend: PluginExecutionBackend, config: PublisherConfig): Promise<Extract<PluginCommandResult, { command: "issues" }>> {
    try {
      const report = await backend.scan(config);
      const statusMessage = createIssuesStatusMessage(report.issues.length);

      this.updateState({
        lastCommand: "issues",
        statusMessage,
        lastLogPath: report.logPath,
        lastManifest: report.manifest,
        lastIssues: report.issues,
        lastLogs: [],
        lastBuildResult: undefined,
        lastPreviewSession: undefined,
        lastDeployResult: undefined
      });

      return {
        command: "issues",
        manifest: report.manifest,
        issues: report.issues,
        statusMessage
      };
    } catch (error) {
      this.captureCommandFailure("issues", error, {
        lastManifest: undefined,
        lastIssues: [],
        lastLogs: [],
        lastBuildResult: undefined,
        lastPreviewSession: undefined,
        lastDeployResult: undefined
      });
      throw error;
    }
  }

  private async runBuildCommand(backend: PluginExecutionBackend, config: PublisherConfig): Promise<Extract<PluginCommandResult, { command: "build" }>> {
    try {
      const build = await backend.build(config);
      const result = build.result;
      const statusMessage = result.success ? "站点构建完成。" : "站点构建失败，请检查问题和日志。";
      this.captureReusableBuild(config, result);

      this.updateState({
        lastCommand: "build",
        statusMessage,
        lastLogPath: build.logPath,
        lastIssues: result.issues,
        lastLogs: retainRecentLogs(result.logs),
        lastBuildResult: result,
        lastPreviewSession: undefined,
        lastDeployResult: undefined
      });

      return {
        command: "build",
        result,
        statusMessage
      };
    } catch (error) {
      this.captureCommandFailure("build", error, {
        lastLogs: [],
        lastBuildResult: undefined,
        lastPreviewSession: undefined,
        lastDeployResult: undefined
      });
      throw error;
    }
  }

  private async runPreviewCommand(config: PublisherConfig): Promise<Extract<PluginCommandResult, { command: "preview" }>> {
    await this.stopActivePreview();
    const reusableBuild = this.getReusableBuild(config);

    const backend = this.createBackend();

    try {
      const preview = reusableBuild === undefined ? await backend.preview(config) : await backend.previewBuilt(reusableBuild, config);
      const session = preview.session;
      const statusMessage = session.success
        ? `站点预览已启动：${session.url}`
        : `站点预览启动失败：${session.message}`;

      this.activePreviewBackend = backend;
      this.updateState({
        lastCommand: "preview",
        statusMessage,
        lastLogPath: preview.logPath,
        lastIssues: reusableBuild?.issues ?? this.state.lastIssues,
        lastLogs: [],
        lastBuildResult: reusableBuild ?? this.state.lastBuildResult,
        lastPreviewSession: session,
        lastDeployResult: undefined
      });

      return {
        command: "preview",
        session,
        statusMessage
      };
    } catch (error) {
      this.captureCommandFailure("preview", error, {
        lastLogs: [],
        lastPreviewSession: undefined,
        lastDeployResult: undefined
      });
      await backend.dispose();
      throw error;
    }
  }

  private async runPublishCommand(backend: PluginExecutionBackend, config: PublisherConfig): Promise<Extract<PluginCommandResult, { command: "publish" }>> {
    try {
      const reusableBuild = this.getReusableBuild(config);

      if (reusableBuild !== undefined) {
        const reusedDeploy = await backend.deployBuilt(reusableBuild, config);
        const statusMessage = reusedDeploy.deploy.success ? "站点发布成功。" : "构建成功，但发布失败。";

        this.updateState({
          lastCommand: "publish",
          statusMessage,
          lastLogPath: reusedDeploy.logPath,
          lastIssues: reusableBuild.issues,
          lastLogs: retainRecentLogs(reusableBuild.logs),
          lastBuildResult: reusableBuild,
          lastPreviewSession: undefined,
          lastDeployResult: reusedDeploy.deploy
        });

        return {
          command: "publish",
          build: reusableBuild,
          deploy: reusedDeploy.deploy,
          statusMessage
        };
      }

      const publishResult = await backend.publish(config);
      const { build, deploy } = publishResult;
      this.captureReusableBuild(config, build);

      if (!build.success) {
        const statusMessage = "发布已停止，因为构建没有成功。";

        this.updateState({
          lastCommand: "publish",
          statusMessage,
          lastLogPath: publishResult.logPath,
          lastIssues: build.issues,
          lastLogs: retainRecentLogs(build.logs),
          lastBuildResult: build,
          lastPreviewSession: undefined,
          lastDeployResult: undefined
        });

        return {
          command: "publish",
          build,
          statusMessage
        };
      }

      const statusMessage =
        deploy === undefined
          ? "构建已完成，但发布步骤没有返回结果。"
          : deploy.success
            ? "站点发布成功。"
            : "构建成功，但发布失败。";

      this.updateState({
        lastCommand: "publish",
        statusMessage,
        lastLogPath: publishResult.logPath,
        lastIssues: build.issues,
        lastLogs: retainRecentLogs(build.logs),
        lastBuildResult: build,
        lastPreviewSession: undefined,
        lastDeployResult: deploy
      });

      return {
        command: "publish",
        build,
        ...(deploy === undefined ? {} : { deploy }),
        statusMessage
      };
    } catch (error) {
      this.captureCommandFailure("publish", error, {
        lastLogs: [],
        lastPreviewSession: undefined,
        lastDeployResult: undefined
      });
      throw error;
    }
  }

  private updateState(nextState: Partial<PluginExecutionState>): void {
    this.state = {
      ...this.state,
      ...nextState,
      lastUpdatedAt: new Date().toISOString(),
      lastIssues: nextState.lastIssues ?? this.state.lastIssues,
      lastLogs: nextState.lastLogs ?? this.state.lastLogs
    };
  }

  private async withEphemeralBackend<T>(callback: (backend: PluginExecutionBackend) => Promise<T>): Promise<T> {
    const backend = this.createBackend();

    try {
      return await callback(backend);
    } finally {
      await backend.dispose();
    }
  }

  private async stopActivePreview(): Promise<void> {
    if (this.activePreviewBackend === undefined) {
      return;
    }

    await this.activePreviewBackend.dispose();
    this.activePreviewBackend = undefined;
  }

  private getReusableBuild(config: PublisherConfig): BuildResult | undefined {
    if (this.reusableBuild?.configKey !== createConfigKey(config)) {
      return undefined;
    }

    return this.reusableBuild.build.success ? this.reusableBuild.build : undefined;
  }

  private captureReusableBuild(config: PublisherConfig, build: BuildResult): void {
    if (!build.success || build.outputDir === undefined) {
      this.reusableBuild = undefined;
      return;
    }

    this.reusableBuild = {
      configKey: createConfigKey(config),
      build
    };
  }

  private captureCommandFailure(command: PluginCommand, error: unknown, nextState: Partial<PluginExecutionState>): void {
    const logPath = getPluginErrorLogPath(error);

    this.updateState({
      lastCommand: command,
      statusMessage: createFailureStatusMessage(command, logPath),
      lastLogPath: logPath,
      ...nextState
    });
  }
}

function retainRecentLogs(logs: BuildLogEntry[]): BuildLogEntry[] {
  return logs.slice(-maxStoredLogEntries);
}

function createUnavailableBackend(): PluginExecutionBackend {
  const createError = (): Error => new Error("插件尚未配置外部 publisher-cli。");

  return {
    async scan(): Promise<PluginScanResult> {
      throw createError();
    },
    async build() {
      throw createError();
    },
    async preview() {
      throw createError();
    },
    async previewBuilt() {
      throw createError();
    },
    async publish(): Promise<PluginPublishResult> {
      throw createError();
    },
    async deployBuilt(): Promise<import("./plugin-backend.js").PluginDeployFromBuildResult> {
      throw createError();
    },
    async dispose(): Promise<void> {}
  };
}

function createCommandDefinition(command: PluginCommand, name: string): PluginCommandDefinition {
  return {
    id: `osp:${command}`,
    name,
    command
  };
}

function createIssuesStatusMessage(issueCount: number): string {
  if (issueCount === 0) {
    return "没有发现发布问题。";
  }

  return `发现 ${issueCount} 个发布问题。`;
}

function createFailureStatusMessage(command: PluginCommand, logPath: string | undefined): string {
  const commandLabel = command === "issues" ? "检查问题" : formatCommandLabel(command);
  return logPath === undefined ? `${commandLabel}失败。` : `${commandLabel}失败，请检查日志。`;
}

function createConfigKey(config: PublisherConfig): string {
  return JSON.stringify(config);
}

function formatCommandLabel(command: Exclude<PluginCommand, "issues">): string {
  switch (command) {
    case "preview":
      return "预览";
    case "build":
      return "构建";
    case "publish":
      return "发布";
  }
}
