import type { spawn } from "node:child_process";

import { createMemoryLogger, type BuildLogEntry, type Logger } from "@osp/shared";

/**
 * Keeps all Quartz-related logs in the shared in-memory logger.
 * Adapter-generated messages are prefixed with `[adapter]`, while raw Quartz process output uses `[quartz]`.
 */
export class QuartzExecutionError extends Error {
  public readonly logs: BuildLogEntry[];

  public constructor(message: string, logs: BuildLogEntry[], options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "QuartzExecutionError";
    this.logs = logs;
  }
}

export function createQuartzLogger(): Logger {
  return createMemoryLogger();
}

export function writeQuartzVersionLog(logger: Logger, version: string): void {
  logger.info(`[adapter] Using Quartz ${version}.`);
}

export function writeQuartzErrorLog(logger: Logger, error: unknown): void {
  logger.error(`[adapter] ${error instanceof Error ? error.message : "Quartz build failed with an unknown error."}`);
}

export function attachQuartzProcessLogs(child: ReturnType<typeof spawn>, logger: Logger): void {
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => pushLogLines(logger, chunk, "info"));
  child.stderr?.on("data", (chunk: string) => pushLogLines(logger, chunk, "error"));
}

export function getQuartzLogs(logger: Logger): BuildLogEntry[] {
  return logger.entries();
}

export function createQuartzExecutionError(
  message: string,
  logger: Logger,
  options: { cause?: unknown } = {}
): QuartzExecutionError {
  return new QuartzExecutionError(message, getQuartzLogs(logger), options);
}

export function findLastQuartzLogMessage(
  logger: Logger,
  level?: BuildLogEntry["level"]
): string | undefined {
  const entries = logger.entries();

  if (level === undefined) {
    return entries.at(-1)?.message;
  }

  return [...entries].reverse().find((entry) => entry.level === level)?.message;
}

function pushLogLines(logger: Logger, chunk: string, level: BuildLogEntry["level"]): void {
  for (const line of chunk.split(/\r?\n/u)) {
    const message = line.trim();

    if (message === "") {
      continue;
    }

    if (level === "error") {
      logger.error(`[quartz] ${message}`);
      continue;
    }

    logger.info(`[quartz] ${message}`);
  }
}
