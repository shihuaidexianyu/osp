import type { BuildLogEntry, Logger, PreparedWorkspace, PreviewSession } from "@osp/shared";

import { createQuartzBuildCommandSpec, createQuartzPreviewCommandSpec } from "./quartz-command-spec.js";
import { runQuartzCommand, spawnQuartzCommand, waitForQuartzProcessExit } from "./quartz-command-runner.js";
import { createQuartzExecutionError, getQuartzLogs } from "./quartz-logging.js";
import {
  createPreviewBuildFailureMessage,
  createPreviewFailureMessage,
  delay,
  startStaticPreviewServer,
  waitForPortReady
} from "./quartz-preview-support.js";

/**
 * Implements the two concrete preview backends we expose today:
 * a watched Quartz process and a static-server fallback built from a one-shot Quartz build.
 */
export type QuartzPreviewRecord = {
  stop(): Promise<void>;
  logs: BuildLogEntry[];
};

export type QuartzStaticPreviewInput = {
  logger: Logger;
  nodeExecutablePath?: string;
  port: number;
  workspace: PreparedWorkspace;
};

export type QuartzWatchedPreviewInput = {
  logger: Logger;
  nodeExecutablePath?: string;
  port: number;
  readinessTimeoutMs: number;
  workspace: PreparedWorkspace;
  wsPort: number;
};

export type QuartzPreviewStartResult = {
  record: QuartzPreviewRecord;
  session: PreviewSession;
};

export async function startStaticQuartzPreview(input: QuartzStaticPreviewInput): Promise<QuartzPreviewStartResult> {
  const execution = await runQuartzCommand({
    logger: input.logger,
    ...(input.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: input.nodeExecutablePath }),
    spec: createQuartzBuildCommandSpec(input.workspace)
  });

  if (execution.exitCode !== 0) {
    throw createQuartzExecutionError(createPreviewBuildFailureMessage(input.logger.entries()), input.logger);
  }

  const server = await startStaticPreviewServer(input.workspace.outputDir, input.port);

  return {
    record: {
      logs: getQuartzLogs(input.logger),
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
    },
    session: {
      success: true as const,
      url: `http://localhost:${input.port}`,
      workspaceRoot: input.workspace.rootDir,
      startedAt: new Date().toISOString()
    }
  };
}

export async function startWatchedQuartzPreview(input: QuartzWatchedPreviewInput): Promise<QuartzPreviewStartResult> {
  const child = spawnQuartzCommand({
    logger: input.logger,
    ...(input.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: input.nodeExecutablePath }),
    spec: createQuartzPreviewCommandSpec(input.workspace, input.port, input.wsPort)
  });

  const exitPromise = waitForQuartzProcessExit(child);

  try {
    await waitForPortReady({
      exitPromise,
      host: "127.0.0.1",
      port: input.port,
      timeoutMs: input.readinessTimeoutMs
    });
  } catch (error) {
    // If Quartz exits early or never opens its port, do not leave the child process behind.
    child.kill();
    throw createQuartzExecutionError(createPreviewFailureMessage(error, input.logger.entries()), input.logger, { cause: error });
  }

  return {
    record: {
      logs: getQuartzLogs(input.logger),
      stop: async () => {
        if (child.killed || child.exitCode !== null) {
          return;
        }

        const stopExitPromise = waitForQuartzProcessExit(child);

        child.kill();
        // Quartz watch mode should exit quickly, but we cap shutdown wait time to avoid hanging stopPreview().
        await Promise.race([stopExitPromise, delay(5_000)]);
      }
    },
    session: {
      success: true as const,
      url: `http://localhost:${input.port}`,
      workspaceRoot: input.workspace.rootDir,
      startedAt: new Date().toISOString()
    }
  };
}
