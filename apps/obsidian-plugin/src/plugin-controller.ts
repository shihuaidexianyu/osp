import type { PublisherConfig } from "@osp/shared";

import { getPluginErrorLogPath } from "./plugin-backend.js";
import type { PluginCommand, PluginCommandDefinition, PluginCommandResult } from "./plugin-shell.js";

export type PluginHost = {
  registerCommand(definition: PluginCommandDefinition, callback: () => Promise<void>): void;
  setStatus(message: string): void;
  beginProgress(command: PluginCommand): () => void;
  openUrl(url: string): void;
  showNotice(message: string): void;
  revealIssueListView(): Promise<void>;
  revealBuildLogView(): Promise<void>;
  refreshViews(): void;
};

type PluginCommandRunner = {
  getCommandDefinitions(): PluginCommandDefinition[];
  runCommand(command: PluginCommand, config: PublisherConfig): Promise<PluginCommandResult>;
};

export class PluginCommandController {
  private activeCommand: PluginCommand | undefined;

  public constructor(
    private readonly shell: PluginCommandRunner,
    private readonly host: PluginHost,
    private readonly getConfig: () => PublisherConfig
  ) {}

  public registerCommands(): void {
    for (const definition of this.shell.getCommandDefinitions()) {
      this.host.registerCommand(definition, async () => {
        await this.runCommand(definition.command);
      });
    }
  }

  public getActiveCommand(): PluginCommand | undefined {
    return this.activeCommand;
  }

  public async runCommand(command: PluginCommand): Promise<void> {
    if (this.activeCommand !== undefined) {
      this.host.showNotice(`已有任务正在运行：${formatCommandLabel(this.activeCommand)}。请等待当前任务完成。`);
      return;
    }

    this.activeCommand = command;
    const stopProgress = this.host.beginProgress(command);
    this.host.refreshViews();

    try {
      const result = await this.shell.runCommand(command, this.getConfig());

      stopProgress();
      this.host.setStatus(createStatusBarMessage(result));
      if (result.command === "preview" && result.session.success) {
        this.host.openUrl(result.session.url);
      }
      this.host.showNotice(result.statusMessage);
    } catch (error) {
      const message = formatPluginCommandError(command, error);

      stopProgress();
      this.host.setStatus(createErrorStatusBarMessage(command));
      this.host.showNotice(message);
    } finally {
      this.activeCommand = undefined;
      this.host.refreshViews();
    }
  }
}

function formatPluginCommandError(command: PluginCommand, error: unknown): string {
  const commandLabel = formatCommandLabel(command);
  const logPath = getPluginErrorLogPath(error);
  const logSuffix = logPath === undefined ? "" : ` 请查看日志：${logPath}`;

  if (error instanceof Error) {
    return `${commandLabel}失败：${error.message}${logSuffix}`;
  }

  return `${commandLabel}失败：发生了未知错误。${logSuffix}`;
}

function createStatusBarMessage(result: PluginCommandResult): string {
  switch (result.command) {
    case "preview":
      return "站点发布：预览已启动";
    case "build":
      return result.result.success ? "站点发布：构建完成" : "站点发布：构建失败";
    case "publish":
      if (!result.build.success) {
        return "站点发布：发布已停止";
      }

      return result.deploy?.success === false ? "站点发布：发布失败" : "站点发布：发布完成";
    case "issues":
      return "站点发布：检查完成";
  }
}

function createErrorStatusBarMessage(command: PluginCommand): string {
  const commandLabel = command === "issues" ? "检查" : formatCommandLabel(command);

  return `站点发布：${commandLabel}失败`;
}

function formatCommandLabel(command: PluginCommand): string {
  switch (command) {
    case "preview":
      return "预览";
    case "build":
      return "构建";
    case "publish":
      return "发布";
    case "issues":
      return "检查问题";
  }
}
