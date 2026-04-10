import path from "node:path";

import type { PreparedWorkspace } from "@osp/shared";

import { toPosixRelativePath } from "./quartz-builder-support.js";

/**
 * Builds the exact Quartz CLI invocation we want to run inside a prepared workspace.
 * This keeps command arguments, working directory, and child-process environment in one place
 * so later Quartz CLI changes only need a local patch.
 */
export type QuartzCommandSpec = {
  args: string[];
  bootstrapCliPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export function createQuartzBuildCommandSpec(workspace: PreparedWorkspace): QuartzCommandSpec {
  return {
    args: [
      "build",
      "--directory",
      toPosixRelativePath(workspace.rootDir, workspace.contentDir),
      "--output",
      toPosixRelativePath(workspace.rootDir, workspace.outputDir)
    ],
    bootstrapCliPath: resolveQuartzBootstrapCliPath(workspace),
    cwd: workspace.rootDir,
    env: createQuartzChildProcessEnv()
  };
}

export function createQuartzPreviewCommandSpec(
  workspace: PreparedWorkspace,
  port: number,
  wsPort: number
): QuartzCommandSpec {
  const buildSpec = createQuartzBuildCommandSpec(workspace);

  return {
    ...buildSpec,
    args: [...buildSpec.args, "--serve", "--watch", "--port", `${port}`, "--wsPort", `${wsPort}`]
  };
}

export function createQuartzChildProcessEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Electron-hosted runtimes need this so the spawned process behaves like plain Node.
    ELECTRON_RUN_AS_NODE: "1"
  };
}

export function resolveQuartzBootstrapCliPath(workspace: PreparedWorkspace): string {
  return path.join(workspace.rootDir, "quartz", "bootstrap-cli.mjs");
}
