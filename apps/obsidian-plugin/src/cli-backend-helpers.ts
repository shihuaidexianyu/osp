import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BuildResultSchema, PublisherConfigSchema, type BuildResult, type DeployResult, type PublisherConfig } from "@osp/shared";

import { PluginExecutionError } from "./plugin-backend.js";

export type CliChildProcess = ReturnType<typeof spawn>;

export type CompletedCliProcess = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function writeCliConfig(configPath: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export async function writeBuildResult(buildResultPath: string, build: BuildResult): Promise<void> {
  await writeFile(buildResultPath, JSON.stringify(BuildResultSchema.parse(build), null, 2), "utf8");
}

export function normalizeDeployResult(result: {
  success: boolean;
  target: DeployResult["target"];
  message: string;
  destination?: string | undefined;
}): DeployResult {
  return {
    success: result.success,
    target: result.target,
    message: result.message,
    ...(result.destination === undefined ? {} : { destination: result.destination })
  };
}

export async function createCliTempDirectory(tempRoot: string | undefined): Promise<string> {
  const baseDirectory = tempRoot ?? path.join(os.tmpdir(), "osp-plugin-cli-");
  return mkdtemp(baseDirectory);
}

export function normalizePluginConfig(config: PublisherConfig): PublisherConfig {
  return PublisherConfigSchema.parse({
    ...config,
    vaultRoot: path.resolve(config.vaultRoot),
    outputDir: resolveVaultRelativePath(config.vaultRoot, config.outputDir),
    ...(config.deployOutputDir === undefined
      ? {}
      : {
          deployOutputDir: resolveVaultRelativePath(config.vaultRoot, config.deployOutputDir)
        })
  }) as PublisherConfig;
}

function resolveVaultRelativePath(vaultRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(vaultRoot, value);
}

export async function runCliProcess(
  cliCommand: string,
  args: string[],
  options: {
    cwd: string;
  }
): Promise<CompletedCliProcess> {
  const child = createCliChild(cliCommand, args, options);

  if (child.stdout === null || child.stderr === null) {
    throw new Error("外部 publisher-cli 未暴露 stdout/stderr 管道。");
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout.on("data", (chunk: string) => {
    stdoutChunks.push(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code ?? 1);
    });
  });

  return {
    exitCode,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join("")
  };
}

export function createCliChild(
  cliCommand: string,
  args: string[],
  options: {
    cwd: string;
  }
): CliChildProcess {
  const normalizedCliCommand = normalizeCliCommand(cliCommand);

  if (/\.(c|m)?js$/iu.test(normalizedCliCommand)) {
    return spawn(resolveNodeCommand(), [normalizedCliCommand, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
  }

  if (process.platform === "win32" && /\.(cmd|bat)$/iu.test(normalizedCliCommand)) {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", buildCommandLine(normalizedCliCommand, args)], {
      cwd: options.cwd,
      env: {
        ...process.env
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
  }

  return spawn(normalizedCliCommand, args, {
    cwd: options.cwd,
    env: {
      ...process.env
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

function resolveNodeCommand(): string {
  return process.env.OSP_NODE_BINARY ?? process.env.NODE ?? "node";
}

function buildCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteShellArgument).join(" ");
}

function quoteShellArgument(argument: string): string {
  return /[\s"]/u.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument;
}

function normalizeCliCommand(cliCommand: string): string {
  const trimmedCommand = cliCommand.trim();

  if (trimmedCommand.length >= 2) {
    const firstCharacter = trimmedCommand[0];
    const lastCharacter = trimmedCommand.at(-1);

    if ((firstCharacter === "\"" || firstCharacter === "'") && firstCharacter === lastCharacter) {
      return trimmedCommand.slice(1, -1).trim();
    }
  }

  return trimmedCommand;
}

export function createLoggedExecutionError(error: Error, logPath: string): PluginExecutionError {
  return new PluginExecutionError(error.message, {
    cause: error,
    logPath
  });
}

export function resolveFallbackLogPath(command: "scan" | "build" | "preview" | "deploy", vaultRoot: string, logDirectory: string | undefined): string {
  const directoryPath = logDirectory ?? path.join(vaultRoot, ".osp", "logs");
  return path.join(directoryPath, `${command}-fallback.log`);
}

export async function appendCliFailureLog(input: {
  logPath: string;
  command: "scan" | "build" | "preview" | "deploy";
  cliCommand: string;
  error: unknown;
  stdout?: string | undefined;
  stderr?: string | undefined;
}): Promise<void> {
  const lines = [
    `[${new Date().toISOString()}] ERROR Plugin observed CLI failure during ${input.command}.`,
    `CLI command: ${input.cliCommand}`,
    `Message: ${formatUnknownError(input.error)}`
  ];

  const stdout = normalizeLoggedOutput(input.stdout);
  const stderr = normalizeLoggedOutput(input.stderr);

  if (stderr !== undefined) {
    lines.push("stderr:");
    lines.push(stderr);
  }

  if (stdout !== undefined) {
    lines.push("stdout:");
    lines.push(stdout);
  }

  lines.push("");

  await mkdir(path.dirname(input.logPath), { recursive: true });
  await appendFile(input.logPath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeLoggedOutput(output: string | undefined): string | undefined {
  if (output === undefined) {
    return undefined;
  }

  const trimmedOutput = output.trim();
  return trimmedOutput === "" ? undefined : trimmedOutput;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  const serializedError = JSON.stringify(error);
  return serializedError ?? "Unknown error";
}
