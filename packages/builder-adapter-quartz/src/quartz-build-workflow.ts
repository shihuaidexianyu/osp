import type { BuildResult, Logger, PreparedWorkspace, PublisherConfig } from "@osp/shared";

import { createQuartzBuildCommandSpec } from "./quartz-command-spec.js";
import { runQuartzCommand } from "./quartz-command-runner.js";
import { getQuartzLogs, writeQuartzErrorLog, writeQuartzVersionLog } from "./quartz-logging.js";
import { ensureQuartzWorkspaceRuntime, readQuartzVersion } from "./quartz-runtime.js";

/**
 * Orchestrates the Quartz build path after the core pipeline has already prepared content.
 * The adapter entrypoint delegates here so build-specific runtime prep and result shaping stay local.
 */
export type QuartzBuildWorkflowInput = {
  config: PublisherConfig;
  logger: Logger;
  nodeExecutablePath?: string;
  quartzPackageRoot: string;
  workspace: PreparedWorkspace;
};

export async function runQuartzBuildWorkflow(input: QuartzBuildWorkflowInput): Promise<BuildResult> {
  const startedAt = Date.now();

  try {
    await ensureQuartzWorkspaceRuntime(input.workspace, input.config, input.quartzPackageRoot);
    writeQuartzVersionLog(input.logger, await readQuartzVersion(input.quartzPackageRoot));

    const execution = await runQuartzCommand({
      logger: input.logger,
      ...(input.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: input.nodeExecutablePath }),
      spec: createQuartzBuildCommandSpec(input.workspace)
    });

    return {
      success: execution.exitCode === 0,
      manifestPath: input.workspace.manifestPath,
      issues: [],
      logs: getQuartzLogs(input.logger),
      durationMs: Date.now() - startedAt,
      ...(execution.exitCode === 0 ? { outputDir: input.workspace.outputDir } : {})
    };
  } catch (error) {
    writeQuartzErrorLog(input.logger, error);

    return {
      success: false,
      manifestPath: input.workspace.manifestPath,
      issues: [],
      logs: getQuartzLogs(input.logger),
      durationMs: Date.now() - startedAt
    };
  }
}
