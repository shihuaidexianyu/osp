import { readFile } from "node:fs/promises";
import path from "node:path";

import { BuildResultSchema, type BuildResult } from "@osp/shared";

import { createCliLogger } from "./cli-logging.js";
import type { CliOutput } from "./cli-types.js";
import { formatError } from "./cli-output.js";
import { supportedCommands } from "./config.js";

export async function readBuildResult(buildResultPath: string): Promise<BuildResult> {
  const fileContents = await readFile(buildResultPath, "utf8");
  return BuildResultSchema.parse(JSON.parse(fileContents)) as BuildResult;
}

export async function writeBootstrapFailureLog(input: {
  command: string;
  cwd: string;
  output: CliOutput;
  message: string;
  options?: {
    logDir?: string | undefined;
    vaultRoot?: string | undefined;
  };
  details?: string[] | undefined;
}): Promise<void> {
  try {
    const logger = await createCliLogger({
      command: input.command,
      ...(input.options?.logDir === undefined ? {} : { logDir: path.resolve(input.cwd, input.options.logDir) }),
      vaultRoot:
        input.options?.vaultRoot === undefined ? input.cwd : path.resolve(input.cwd, input.options.vaultRoot)
    });

    logger.error(input.message);

    for (const detail of input.details ?? []) {
      logger.info(detail);
    }

    await logger.close();
  } catch (loggingError) {
    input.output.error(`Failed to write CLI log: ${formatError(loggingError)}`);
  }
}

export function resolveBootstrapCommand(argvCommand: string | undefined): string {
  return argvCommand !== undefined && supportedCommands.includes(argvCommand as (typeof supportedCommands)[number]) ? argvCommand : "cli";
}
