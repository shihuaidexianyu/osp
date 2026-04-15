import type { BuildResult, PublisherConfig } from "@osp/shared";

import { getPluginErrorLogPath } from "./plugin-backend.js";
import type { PluginExecutionBackend } from "./plugin-backend.js";
import {
  runBuildCommand,
  runIssuesCommand,
  runPreviewCommand,
  runPublishCommand,
  type PluginShellController
} from "./plugin-command-runners.js";
import {
  createCommandDefinition,
  createConfigKey,
  createFailureStatusMessage,
  createUnavailableBackend
} from "./plugin-shell-helpers.js";
import {
  defaultState,
  type PluginCommand,
  type PluginCommandDefinition,
  type PluginCommandResult,
  type PluginExecutionState
} from "./plugin-shell-types.js";

export { pluginManifest, type PluginCommand, type PluginCommandDefinition, type PluginExecutionState, type PluginCommandResult } from "./plugin-shell-types.js";

export class PublisherPluginShell implements PluginShellController {
  private state: PluginExecutionState = defaultState;
  private activePreviewBackend: PluginExecutionBackend | undefined;
  private reusableBuild:
    | {
        configKey: string;
        build: BuildResult;
      }
    | undefined;

  public constructor(public readonly createBackend: () => PluginExecutionBackend = createUnavailableBackend) {}

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
        return this.withEphemeralBackend(async (backend) => runIssuesCommand(this, backend, config));
      case "build":
        return this.withEphemeralBackend(async (backend) => runBuildCommand(this, backend, config));
      case "preview":
        return runPreviewCommand(this, config);
      case "publish":
        return this.withEphemeralBackend(async (backend) => runPublishCommand(this, backend, config));
    }
  }

  public updateState(nextState: Partial<PluginExecutionState>): void {
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

  public async stopActivePreview(): Promise<void> {
    if (this.activePreviewBackend === undefined) {
      return;
    }

    await this.activePreviewBackend.dispose();
    this.activePreviewBackend = undefined;
  }

  public getReusableBuild(config: PublisherConfig): BuildResult | undefined {
    if (this.reusableBuild?.configKey !== createConfigKey(config)) {
      return undefined;
    }

    return this.reusableBuild.build.success ? this.reusableBuild.build : undefined;
  }

  public setActivePreviewBackend(backend: PluginExecutionBackend | undefined): void {
    this.activePreviewBackend = backend;
  }

  public captureReusableBuild(config: PublisherConfig, build: BuildResult): void {
    if (!build.success || build.outputDir === undefined) {
      this.reusableBuild = undefined;
      return;
    }

    this.reusableBuild = {
      configKey: createConfigKey(config),
      build
    };
  }

  public captureCommandFailure(command: PluginCommand, error: unknown, nextState: Partial<PluginExecutionState>): void {
    const logPath = getPluginErrorLogPath(error);

    this.updateState({
      lastCommand: command,
      statusMessage: createFailureStatusMessage(command, logPath),
      lastLogPath: logPath,
      ...nextState
    });
  }
}
