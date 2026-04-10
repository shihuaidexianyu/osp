import { spawn } from "node:child_process";

import type { Logger } from "@osp/shared";

import { attachQuartzProcessLogs } from "./quartz-logging.js";
import type { QuartzCommandSpec } from "./quartz-command-spec.js";

/**
 * Runs Quartz as a child process and attaches its stdout/stderr to the shared logger.
 * The rest of the adapter only depends on this small execution surface instead of raw spawn details.
 */
export type QuartzCommandRunnerInput = {
  logger: Logger;
  nodeExecutablePath?: string;
  spec: QuartzCommandSpec;
};

type QuartzChildProcess = ReturnType<typeof spawn>;

export function spawnQuartzCommand(input: QuartzCommandRunnerInput): QuartzChildProcess {
  const child = spawn(input.nodeExecutablePath ?? process.execPath, [input.spec.bootstrapCliPath, ...input.spec.args], {
    cwd: input.spec.cwd,
    env: input.spec.env,
    // Quartz output is piped into our shared logger so CLI/plugin callers see one consistent log stream.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  attachQuartzProcessLogs(child, input.logger);
  return child;
}

export async function runQuartzCommand(input: QuartzCommandRunnerInput): Promise<{ exitCode: number }> {
  const child = spawnQuartzCommand(input);
  const exitCode = await waitForQuartzProcessExit(child);

  return { exitCode };
}

export function waitForQuartzProcessExit(child: QuartzChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
