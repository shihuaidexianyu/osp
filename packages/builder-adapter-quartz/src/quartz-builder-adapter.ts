import { createRequire } from "node:module";
import path from "node:path";
import { spawn } from "node:child_process";

import type { BuildLogEntry, BuildResult, PreviewSession, PreparedWorkspace, PublisherConfig } from "@osp/shared";

import type { BuilderAdapter } from "./contracts.js";
import {
  createErrorLog,
  createQuartzRuntimeResolutionMessage,
  stopPreviewProcess,
  toPosixRelativePath
} from "./quartz-builder-support.js";
import {
  createPreviewBuildFailureMessage,
  createPreviewFailureMessage,
  delay,
  startStaticPreviewServer,
  waitForPortReady
} from "./quartz-preview-support.js";
import { ensureQuartzWorkspaceRuntime, readQuartzVersion } from "./quartz-runtime.js";

type QuartzBuilderAdapterOptions = {
  nodeExecutablePath?: string;
  previewPort?: number;
  previewReadinessTimeoutMs?: number;
  previewWsPort?: number;
  quartzPackageRoot?: string;
  preferStaticPreview?: boolean;
};

type PreviewProcessRecord = {
  stop(): Promise<void>;
  logs: BuildLogEntry[];
};

const defaultPreviewPort = 8080;
const defaultPreviewReadinessTimeoutMs = 20_000;
const defaultPreviewWsPort = 3001;

export class QuartzBuilderAdapter implements BuilderAdapter {
  private readonly previewProcesses = new Map<string, PreviewProcessRecord>();
  private quartzPackageRoot: string | undefined;

  public constructor(private readonly options: QuartzBuilderAdapterOptions = {}) { }

  public async build(workspace: PreparedWorkspace, config: PublisherConfig): Promise<BuildResult> {
    const startedAt = Date.now();

    try {
      const quartzPackageRoot = this.getQuartzPackageRoot();

      await ensureQuartzWorkspaceRuntime(workspace, config, quartzPackageRoot);
      const execution = await runQuartzCommand({
        args: this.createBuildArgs(workspace),
        bootstrapCliPath: this.getBootstrapCliPath(workspace),
        cwd: workspace.rootDir,
        nodeExecutablePath: this.getNodeExecutablePath(),
        quartzPackageRoot
      });

      return {
        success: execution.exitCode === 0,
        manifestPath: workspace.manifestPath,
        issues: [],
        logs: execution.logs,
        durationMs: Date.now() - startedAt,
        ...(execution.exitCode === 0 ? { outputDir: workspace.outputDir } : {})
      };
    } catch (error) {
      return {
        success: false,
        manifestPath: workspace.manifestPath,
        issues: [],
        logs: [createErrorLog(error)],
        durationMs: Date.now() - startedAt
      };
    }
  }

  public async preview(workspace: PreparedWorkspace, config: PublisherConfig): Promise<PreviewSession> {
    const quartzPackageRoot = this.getQuartzPackageRoot();

    await ensureQuartzWorkspaceRuntime(workspace, config, quartzPackageRoot);
    await this.stopPreview(workspace.rootDir);

    const port = this.options.previewPort ?? defaultPreviewPort;
    const logs: BuildLogEntry[] = [];

    if (this.options.preferStaticPreview === true) {
      await ensurePreviewBuildReady({
        bootstrapCliPath: this.getBootstrapCliPath(workspace),
        cwd: workspace.rootDir,
        logs,
        nodeExecutablePath: this.getNodeExecutablePath(),
        quartzPackageRoot,
        workspace
      });

      const server = await startStaticPreviewServer(workspace.outputDir, port);

      this.previewProcesses.set(workspace.rootDir, {
        logs,
        stop: async () => {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error !== undefined) {
                reject(error);
                return;
              }

              resolve();
            });
          });
        }
      });

      return {
        success: true as const,
        url: `http://localhost:${port}`,
        workspaceRoot: workspace.rootDir,
        startedAt: new Date().toISOString()
      };
    }

    const wsPort = this.options.previewWsPort ?? defaultPreviewWsPort;
    const child = spawn(
      this.getNodeExecutablePath(),
      [this.getBootstrapCliPath(workspace), ...this.createPreviewArgs(workspace, port, wsPort)],
      {
        cwd: workspace.rootDir,
        env: createQuartzChildProcessEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    attachProcessLogs(child, logs);

    const exitPromise = onceProcessExit(child);

    try {
      await waitForPortReady({
        exitPromise,
        host: "127.0.0.1",
        port,
        timeoutMs: this.options.previewReadinessTimeoutMs ?? defaultPreviewReadinessTimeoutMs
      });
    } catch (error) {
      child.kill();
      this.previewProcesses.delete(workspace.rootDir);
      throw new Error(createPreviewFailureMessage(error, logs));
    }

    this.previewProcesses.set(workspace.rootDir, {
      logs,
      stop: async () => {
        if (child.killed || child.exitCode !== null) {
          return;
        }

        const exitPromise = onceProcessExit(child);

        child.kill();
        await Promise.race([exitPromise, delay(5_000)]);
      }
    });

    return {
      success: true as const,
      url: `http://localhost:${port}`,
      workspaceRoot: workspace.rootDir,
      startedAt: new Date().toISOString()
    };
  }

  public async stopPreview(workspaceRoot?: string): Promise<void> {
    if (workspaceRoot !== undefined) {
      await stopPreviewProcess(this.previewProcesses, workspaceRoot);
      return;
    }

    await Promise.all([...this.previewProcesses.keys()].map(async (rootDir) => stopPreviewProcess(this.previewProcesses, rootDir)));
  }

  private createBuildArgs(workspace: PreparedWorkspace): string[] {
    return [
      "build",
      "--directory",
      toPosixRelativePath(workspace.rootDir, workspace.contentDir),
      "--output",
      toPosixRelativePath(workspace.rootDir, workspace.outputDir)
    ];
  }

  private createPreviewArgs(workspace: PreparedWorkspace, port: number, wsPort: number): string[] {
    return [
      ...this.createBuildArgs(workspace),
      "--serve",
      "--watch",
      "--port",
      `${port}`,
      "--wsPort",
      `${wsPort}`
    ];
  }

  private getBootstrapCliPath(workspace: PreparedWorkspace): string {
    return path.join(workspace.rootDir, "quartz", "bootstrap-cli.mjs");
  }

  private getQuartzPackageRoot(): string {
    if (this.quartzPackageRoot !== undefined) {
      return this.quartzPackageRoot;
    }

    this.quartzPackageRoot = this.options.quartzPackageRoot ?? resolveQuartzPackageRoot();
    return this.quartzPackageRoot;
  }

  private getNodeExecutablePath(): string {
    return this.options.nodeExecutablePath ?? process.execPath;
  }
}

function resolveQuartzPackageRoot(): string {
  try {
    return path.dirname(resolveNodeRequire().resolve("@jackyzha0/quartz/package.json"));
  } catch (error) {
    throw new Error(createQuartzRuntimeResolutionMessage(error));
  }
}

function resolveNodeRequire(): NodeJS.Require {
  const nativeRequire = readNativeRequire();

  if (nativeRequire !== undefined) {
    return nativeRequire;
  }

  return createRequire(import.meta.url);
}

function readNativeRequire(): NodeJS.Require | undefined {
  try {
    return Function("return typeof require === 'function' ? require : undefined;")() as NodeJS.Require | undefined;
  } catch {
    return undefined;
  }
}

function createQuartzChildProcessEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1"
  };
}

async function runQuartzCommand(input: {
  args: string[];
  bootstrapCliPath: string;
  cwd: string;
  nodeExecutablePath?: string;
  quartzPackageRoot: string;
}): Promise<{ exitCode: number; logs: BuildLogEntry[] }> {
  const logs: BuildLogEntry[] = [
    {
      level: "info",
      message: `Using Quartz ${await readQuartzVersion(input.quartzPackageRoot)}.`,
      timestamp: new Date().toISOString()
    }
  ];
  const child = spawn(input.nodeExecutablePath ?? process.execPath, [input.bootstrapCliPath, ...input.args], {
    cwd: input.cwd,
    env: createQuartzChildProcessEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  attachProcessLogs(child, logs);
  const exitCode = await onceProcessExit(child);

  return {
    exitCode,
    logs
  };
}

async function ensurePreviewBuildReady(input: {
  bootstrapCliPath: string;
  cwd: string;
  logs: BuildLogEntry[];
  nodeExecutablePath?: string;
  quartzPackageRoot: string;
  workspace: PreparedWorkspace;
}): Promise<void> {
  const execution = await runQuartzCommand({
    args: [
      "build",
      "--directory",
      toPosixRelativePath(input.workspace.rootDir, input.workspace.contentDir),
      "--output",
      toPosixRelativePath(input.workspace.rootDir, input.workspace.outputDir)
    ],
    bootstrapCliPath: input.bootstrapCliPath,
    cwd: input.cwd,
    ...(input.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: input.nodeExecutablePath }),
    quartzPackageRoot: input.quartzPackageRoot
  });

  input.logs.push(...execution.logs);

  if (execution.exitCode !== 0) {
    throw new Error(createPreviewBuildFailureMessage(execution.logs));
  }
}

function attachProcessLogs(child: ReturnType<typeof spawn>, logs: BuildLogEntry[]): void {
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => pushLogLines(logs, chunk, "info"));
  child.stderr?.on("data", (chunk: string) => pushLogLines(logs, chunk, "error"));
}

function pushLogLines(logs: BuildLogEntry[], chunk: string, level: BuildLogEntry["level"]): void {
  for (const line of chunk.split(/\r?\n/u)) {
    const message = line.trim();

    if (message === "") {
      continue;
    }

    logs.push({
      level,
      message,
      timestamp: new Date().toISOString()
    });
  }
}

function onceProcessExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
