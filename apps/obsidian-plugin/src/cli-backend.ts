import { rm } from "node:fs/promises";
import path from "node:path";

import {
  CliBuildResultSchema,
  CliDeployResultSchema,
  CliPreviewResultSchema,
  CliScanResultSchema,
  type DeployResult,
  type BuildResult,
  type PreviewSession,
  type PublisherConfig
} from "@osp/shared";
import type { z } from "zod";

import {
  createCliFailureMessage,
  createCompletedProcessTracker,
  enrichCliLaunchError,
  stopChildProcess
} from "./cli-process.js";
import { tryParseCliPayload } from "./cli-json.js";
import type {
  PluginBuildResult,
  PluginDeployFromBuildResult,
  PluginExecutionBackend,
  PluginPreviewResult,
  PluginPublishResult,
  PluginScanResult
} from "./plugin-backend.js";
import { PluginExecutionError as LoggedPluginExecutionError } from "./plugin-backend.js";
import {
  appendCliFailureLog,
  createCliChild,
  createCliTempDirectory,
  createLoggedExecutionError,
  normalizeDeployResult,
  normalizePluginConfig,
  resolveFallbackLogPath,
  runCliProcess,
  writeBuildResult,
  writeCliConfig,
  type CliChildProcess
} from "./cli-backend-helpers.js";

type CliBackendOptions = {
  cliCommand: string;
  logDirectory?: string;
  previewPort?: number;
  quartzPackageRoot?: string;
  tempRoot?: string;
};

type RunningPreview = {
  child: CliChildProcess;
  tempDir: string;
  settled: Promise<void>;
};

export class CliPluginBackend implements PluginExecutionBackend {
  private activePreview: RunningPreview | undefined;

  public constructor(private readonly options: CliBackendOptions) {}

  public async scan(config: PublisherConfig): Promise<PluginScanResult> {
    const payload = await this.runOneShotCommand("scan", config, CliScanResultSchema);

    return {
      manifest: payload.manifest as PluginScanResult["manifest"],
      issues: payload.issues as PluginScanResult["issues"],
      logPath: payload.logPath
    };
  }

  public async build(config: PublisherConfig): Promise<PluginBuildResult> {
    const payload = await this.runOneShotCommand("build", config, CliBuildResultSchema);

    return {
      result: payload.result as BuildResult,
      logPath: payload.logPath
    };
  }

  public async preview(config: PublisherConfig): Promise<PluginPreviewResult> {
    return this.startPreviewCommand(config);
  }

  public async previewBuilt(build: BuildResult, config: PublisherConfig): Promise<PluginPreviewResult> {
    return this.startPreviewCommand(config, build);
  }

  public async publish(config: PublisherConfig): Promise<PluginPublishResult> {
    const payload = await this.runOneShotCommand("deploy", config, CliDeployResultSchema);

    if (payload.deploy === undefined) {
      return {
        build: payload.build as BuildResult,
        logPath: payload.logPath
      };
    }

    return {
      build: payload.build as BuildResult,
      deploy: payload.deploy as NonNullable<PluginPublishResult["deploy"]>,
      logPath: payload.logPath
    };
  }

  public async deployBuilt(build: BuildResult, config: PublisherConfig): Promise<PluginDeployFromBuildResult> {
    const payload = await this.runOneShotCommand("deploy", config, CliDeployResultSchema, build);

    return {
      deploy: normalizeDeployResult(
        payload.deploy ?? {
          success: false,
          target: config.deployTarget,
          message: "CLI deploy command did not return a deploy result."
        }
      ),
      logPath: payload.logPath
    };
  }

  public async dispose(): Promise<void> {
    await this.stopActivePreview();
  }

  private async startPreviewCommand(config: PublisherConfig, build: BuildResult | undefined = undefined): Promise<PluginPreviewResult> {
    await this.stopActivePreview();

    const cliCommand = this.options.cliCommand;
    const normalizedConfig = normalizePluginConfig(config);
    const fallbackLogPath = resolveFallbackLogPath("preview", normalizedConfig.vaultRoot, this.options.logDirectory);
    const tempDir = await createCliTempDirectory(this.options.tempRoot);
    const configPath = tempDir + "/publisher.config.json";

    await writeCliConfig(configPath, normalizedConfig);
    if (build !== undefined) {
      await writeBuildResult(tempDir + "/build-result.json", build);
    }

    const child = createCliChild(this.options.cliCommand, this.createCliArgs("preview", configPath, build), {
      cwd: normalizedConfig.vaultRoot
    });

    if (child.stdout === null || child.stderr === null) {
      throw new Error("外部 publisher-cli 未暴露 stdout/stderr 管道。");
    }

    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;

    stdoutStream.setEncoding("utf8");
    stderrStream.setEncoding("utf8");

    const exitState = createCompletedProcessTracker(child);
    let stdout = "";
    let stderr = "";
    let previewResolved = false;

    stdoutStream.on("data", (chunk: string) => {
      stdout += chunk;
    });
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      const previewResult = await new Promise<PluginPreviewResult>((resolve, reject) => {
        const resolveIfReady = (): void => {
          const payload = tryParseCliPayload(stdout, CliPreviewResultSchema);

          if (payload === undefined) {
            return;
          }

          previewResolved = true;
          resolve({
            session: payload.session as PreviewSession,
            logPath: payload.logPath
          }) as void;
        };

        stdoutStream.on("data", resolveIfReady);
        child.once("error", reject);
        child.once("exit", (exitCode) => {
          if (previewResolved) {
            return;
          }

          reject(new Error(createCliFailureMessage("preview", exitCode ?? 1, stdout, stderr)));
        });
        resolveIfReady();
      });

      this.activePreview = {
        child,
        tempDir,
        settled: exitState.finally(async () => {
          if (this.activePreview?.child === child) {
            this.activePreview = undefined;
          }

          await rm(tempDir, { recursive: true, force: true });
        })
      };

      return previewResult;
    } catch (error) {
      await stopChildProcess(child);
      await exitState.catch(() => undefined);
      await appendCliFailureLog({
        logPath: fallbackLogPath,
        command: "preview",
        cliCommand,
        error,
        stdout,
        stderr
      }).catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
      throw createLoggedExecutionError(enrichCliLaunchError(cliCommand, error), fallbackLogPath);
    }
  }

  private async runOneShotCommand<TSchema extends z.ZodTypeAny>(
    command: "scan" | "build" | "deploy",
    config: PublisherConfig,
    schema: TSchema,
    build: BuildResult | undefined = undefined
  ): Promise<z.output<TSchema>> {
    const cliCommand = this.options.cliCommand;
    const normalizedConfig = normalizePluginConfig(config);
    const fallbackLogPath = resolveFallbackLogPath(command, normalizedConfig.vaultRoot, this.options.logDirectory);
    const tempDir = await createCliTempDirectory(this.options.tempRoot);
    const configPath = tempDir + "/publisher.config.json";
    let completed: { exitCode: number; stdout: string; stderr: string } | undefined;

    await writeCliConfig(configPath, normalizedConfig);
    if (build !== undefined) {
      await writeBuildResult(tempDir + "/build-result.json", build);
    }

    try {
      completed = await runCliProcess(this.options.cliCommand, this.createCliArgs(command, configPath, build), {
        cwd: normalizedConfig.vaultRoot
      });
      const payload = tryParseCliPayload(completed.stdout, schema);

      if (payload === undefined) {
        throw new Error(createCliFailureMessage(command, completed.exitCode, completed.stdout, completed.stderr));
      }

      return payload;
    } catch (error) {
      await appendCliFailureLog({
        logPath: fallbackLogPath,
        command,
        cliCommand,
        error,
        stdout: completed?.stdout,
        stderr: completed?.stderr
      }).catch(() => undefined);
      throw createLoggedExecutionError(enrichCliLaunchError(cliCommand, error), fallbackLogPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private createCliArgs(command: "scan" | "build" | "preview" | "deploy", configPath: string, build: BuildResult | undefined): string[] {
    return [
      command,
      "--config",
      configPath,
      "--json",
      ...(build === undefined ? [] : ["--build-result", path.join(path.dirname(configPath), "build-result.json")]),
      ...(this.options.logDirectory === undefined ? [] : ["--log-dir", this.options.logDirectory]),
      ...(this.options.previewPort === undefined ? [] : ["--preview-port", `${this.options.previewPort}`]),
      ...(this.options.quartzPackageRoot === undefined ? [] : ["--quartz-package-root", this.options.quartzPackageRoot])
    ];
  }

  private async stopActivePreview(): Promise<void> {
    if (this.activePreview === undefined) {
      return;
    }

    const { child, settled } = this.activePreview;

    this.activePreview = undefined;
    await stopChildProcess(child);
    await settled.catch(() => undefined);
  }
}
