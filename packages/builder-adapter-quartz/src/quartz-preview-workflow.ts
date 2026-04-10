import type { Logger, PreparedWorkspace, PreviewSession, PublisherConfig } from "@osp/shared";

import {
  startStaticQuartzPreview,
  startWatchedQuartzPreview,
  type QuartzPreviewRecord,
  type QuartzPreviewStartResult
} from "./quartz-preview-backends.js";
import { ensureQuartzWorkspaceRuntime, readQuartzVersion } from "./quartz-runtime.js";
import { writeQuartzVersionLog } from "./quartz-logging.js";

/**
 * Owns preview-specific policy: refresh the runtime, stop any existing preview for the workspace,
 * record the Quartz version, then choose the watched or static backend.
 */
export type QuartzPreviewWorkflowInput = {
  config: PublisherConfig;
  logger: Logger;
  nodeExecutablePath?: string;
  port: number;
  preferStaticPreview?: boolean;
  quartzPackageRoot: string;
  readinessTimeoutMs: number;
  stopExistingPreview(): Promise<void>;
  workspace: PreparedWorkspace;
  wsPort: number;
};

export type QuartzPreviewWorkflowResult = {
  record: QuartzPreviewRecord;
  session: PreviewSession;
};

export async function runQuartzPreviewWorkflow(
  input: QuartzPreviewWorkflowInput
): Promise<QuartzPreviewWorkflowResult> {
  await ensureQuartzWorkspaceRuntime(input.workspace, input.config, input.quartzPackageRoot);
  await input.stopExistingPreview();

  writeQuartzVersionLog(input.logger, await readQuartzVersion(input.quartzPackageRoot));

  if (input.preferStaticPreview === true) {
    return startStaticQuartzPreview({
      logger: input.logger,
      ...(input.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: input.nodeExecutablePath }),
      port: input.port,
      workspace: input.workspace
    });
  }

  return startWatchedQuartzPreview({
    logger: input.logger,
    ...(input.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: input.nodeExecutablePath }),
    port: input.port,
    readinessTimeoutMs: input.readinessTimeoutMs,
    workspace: input.workspace,
    wsPort: input.wsPort
  });
}
