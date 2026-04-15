import type { BuildResult, PublisherConfig } from "@osp/shared";

import { getPluginErrorLogPath, type PluginExecutionBackend } from "./plugin-backend.js";
import {
  createConfigKey,
  createFailureStatusMessage,
  createIssuesStatusMessage,
  retainRecentLogs
} from "./plugin-shell-helpers.js";
import type { PluginCommand, PluginCommandResult, PluginExecutionState } from "./plugin-shell-types.js";

export type PluginShellController = {
  getState(): PluginExecutionState;
  updateState(nextState: Partial<PluginExecutionState>): void;
  captureReusableBuild(config: PublisherConfig, build: BuildResult): void;
  getReusableBuild(config: PublisherConfig): BuildResult | undefined;
  stopActivePreview(): Promise<void>;
  setActivePreviewBackend(backend: PluginExecutionBackend | undefined): void;
  captureCommandFailure(command: PluginCommand, error: unknown, nextState: Partial<PluginExecutionState>): void;
  createBackend(): PluginExecutionBackend;
};

export async function runIssuesCommand(
  shell: PluginShellController,
  backend: PluginExecutionBackend,
  config: PublisherConfig
): Promise<Extract<PluginCommandResult, { command: "issues" }>> {
  try {
    const report = await backend.scan(config);
    const statusMessage = createIssuesStatusMessage(report.issues.length);

    shell.updateState({
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
    shell.captureCommandFailure("issues", error, {
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

export async function runBuildCommand(
  shell: PluginShellController,
  backend: PluginExecutionBackend,
  config: PublisherConfig
): Promise<Extract<PluginCommandResult, { command: "build" }>> {
  try {
    const build = await backend.build(config);
    const result = build.result;
    const statusMessage = result.success ? "站点构建完成。" : "站点构建失败，请检查问题和日志。";
    shell.captureReusableBuild(config, result);

    shell.updateState({
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
    shell.captureCommandFailure("build", error, {
      lastLogs: [],
      lastBuildResult: undefined,
      lastPreviewSession: undefined,
      lastDeployResult: undefined
    });
    throw error;
  }
}

export async function runPreviewCommand(
  shell: PluginShellController,
  config: PublisherConfig
): Promise<Extract<PluginCommandResult, { command: "preview" }>> {
  await shell.stopActivePreview();
  const reusableBuild = shell.getReusableBuild(config);

  const backend = shell.createBackend();

  try {
    const preview = reusableBuild === undefined ? await backend.preview(config) : await backend.previewBuilt(reusableBuild, config);
    const session = preview.session;
    const statusMessage = session.success
      ? `站点预览已启动：${session.url}`
      : `站点预览启动失败：${session.message}`;

    shell.setActivePreviewBackend(backend);
    shell.updateState({
      lastCommand: "preview",
      statusMessage,
      lastLogPath: preview.logPath,
      lastIssues: reusableBuild?.issues ?? shell.getState().lastIssues,
      lastLogs: [],
      lastBuildResult: reusableBuild ?? undefined,
      lastPreviewSession: session,
      lastDeployResult: undefined
    });

    return {
      command: "preview",
      session,
      statusMessage
    };
  } catch (error) {
    shell.captureCommandFailure("preview", error, {
      lastLogs: [],
      lastPreviewSession: undefined,
      lastDeployResult: undefined
    });
    await backend.dispose();
    throw error;
  }
}

export async function runPublishCommand(
  shell: PluginShellController,
  backend: PluginExecutionBackend,
  config: PublisherConfig
): Promise<Extract<PluginCommandResult, { command: "publish" }>> {
  try {
    const reusableBuild = shell.getReusableBuild(config);

    if (reusableBuild !== undefined) {
      const reusedDeploy = await backend.deployBuilt(reusableBuild, config);
      const statusMessage = reusedDeploy.deploy.success ? "站点发布成功。" : "构建成功，但发布失败。";

      shell.updateState({
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
    shell.captureReusableBuild(config, build);

    if (!build.success) {
      const statusMessage = "发布已停止，因为构建没有成功。";

      shell.updateState({
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

    shell.updateState({
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
    shell.captureCommandFailure("publish", error, {
      lastLogs: [],
      lastPreviewSession: undefined,
      lastDeployResult: undefined
    });
    throw error;
  }
}
