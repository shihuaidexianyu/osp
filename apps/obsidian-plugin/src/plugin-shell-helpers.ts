import type { BuildLogEntry, BuildResult, PublisherConfig } from "@osp/shared";

import { maxStoredLogEntries, type PluginCommand, type PluginCommandDefinition, type PluginExecutionState } from "./plugin-shell-types.js";
import type { PluginDeployFromBuildResult, PluginExecutionBackend, PluginPublishResult, PluginScanResult } from "./plugin-backend.js";

export function retainRecentLogs(logs: BuildLogEntry[]): BuildLogEntry[] {
  return logs.slice(-maxStoredLogEntries);
}

export function createUnavailableBackend(): PluginExecutionBackend {
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
    async deployBuilt(): Promise<PluginDeployFromBuildResult> {
      throw createError();
    },
    async dispose(): Promise<void> {}
  };
}

export function createCommandDefinition(command: PluginCommand, name: string): PluginCommandDefinition {
  return {
    id: `osp:${command}`,
    name,
    command
  };
}

export function createIssuesStatusMessage(issueCount: number): string {
  if (issueCount === 0) {
    return "没有发现发布问题。";
  }

  return `发现 ${issueCount} 个发布问题。`;
}

export function createFailureStatusMessage(command: PluginCommand, logPath: string | undefined): string {
  const commandLabel = command === "issues" ? "检查问题" : formatCommandLabel(command);
  return logPath === undefined ? `${commandLabel}失败。` : `${commandLabel}失败，请检查日志。`;
}

export function createConfigKey(config: PublisherConfig): string {
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
