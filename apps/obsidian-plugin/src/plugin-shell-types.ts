import type { BuildIssue, BuildLogEntry, BuildResult, DeployResult, PreviewSession, VaultManifest } from "@osp/shared";

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

export const defaultState: PluginExecutionState = {
  lastIssues: [],
  lastLogs: []
};

export const maxStoredLogEntries = 40;
