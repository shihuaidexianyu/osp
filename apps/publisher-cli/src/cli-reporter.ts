import path from "node:path";

import type { BuildResult, DeployResult, PreviewSession, PublisherConfig } from "@osp/shared";

import { startStaticPreviewServer } from "./static-preview-server.js";
import type { CliOrchestrator, CliReporter, CliSession } from "./cli-types.js";
import {
  createConfigSourceMessage,
  printBuildResult,
  printDeployResult,
  printIssues,
  printJson,
  printPreviewSession,
  writeError,
  writeInfo,
  writeReadableDiagnosticsToLogger
} from "./cli-output.js";
import { waitForTerminationSignal } from "./cli-runtime-support.js";

export async function runScanCommand(orchestrator: CliOrchestrator, config: PublisherConfig, reporter: CliReporter): Promise<number> {
  const report = await orchestrator.scan(config);
  writeReadableDiagnosticsToLogger(reporter, {
    issues: report.issues,
    logs: []
  });

  if (reporter.json) {
    printJson(reporter, {
      command: "scan",
      success: true,
      logPath: reporter.logger.logPath,
      manifest: report.manifest,
      issues: report.issues
    });
    return 0;
  }

  writeInfo(
    reporter,
    [
      "Scan complete.",
      `Notes: ${report.manifest.notes.length}`,
      `Assets: ${report.manifest.assetFiles.length}`,
      `Unsupported: ${report.manifest.unsupportedObjects.length}`,
      `Issues: ${report.issues.length}`
    ].join(" ")
  );
  printIssues(reporter, report.issues);
  return 0;
}

export async function runBuildCommand(orchestrator: CliOrchestrator, config: PublisherConfig, reporter: CliReporter): Promise<number> {
  const result = await orchestrator.build(config);
  writeReadableDiagnosticsToLogger(reporter, {
    issues: result.issues,
    logs: result.logs
  });

  if (reporter.json) {
    printJson(reporter, {
      command: "build",
      success: result.success,
      logPath: reporter.logger.logPath,
      result
    });
    return result.success ? 0 : 1;
  }

  printBuildResult(reporter, result);
  return result.success ? 0 : 1;
}

export async function runPreviewCommand(
  runtime: CliSession,
  config: PublisherConfig,
  reporter: CliReporter,
  waitForPreviewShutdown: (() => Promise<void>) | undefined,
  previewPort: number | undefined,
  build: BuildResult | undefined
): Promise<number> {
  if (build !== undefined) {
    return runPreviewFromBuild(build, reporter, waitForPreviewShutdown, previewPort);
  }

  const session = await runtime.orchestrator.preview(config);

  if (reporter.json) {
    printJson(reporter, {
      command: "preview",
      success: true,
      logPath: reporter.logger.logPath,
      session
    });
  } else {
    printPreviewSession(reporter, session);
  }

  if (!session.success) {
    writeError(reporter, `Preview failed: ${session.message}`);
    return 1;
  }

  reporter.logger.info(`Preview active at ${session.url}`);
  await (waitForPreviewShutdown ?? waitForTerminationSignal)();
  return 0;
}

export async function runDeployCommand(
  orchestrator: CliOrchestrator,
  config: PublisherConfig,
  reporter: CliReporter,
  existingBuild: BuildResult | undefined
): Promise<number> {
  const build = existingBuild ?? (await orchestrator.build(config));
  writeReadableDiagnosticsToLogger(reporter, {
    issues: build.issues,
    logs: build.logs
  });

  if (!build.success) {
    if (reporter.json) {
      printJson(reporter, {
        command: "deploy",
        success: false,
        logPath: reporter.logger.logPath,
        build
      });
    } else {
      printBuildResult(reporter, build);
    }

    return 1;
  }

  const deploy = await orchestrator.deployFromBuild(build, config);

  if (reporter.json) {
    printJson(reporter, {
      command: "deploy",
      success: deploy.success,
      logPath: reporter.logger.logPath,
      build,
      deploy
    });
    return deploy.success ? 0 : 1;
  }

  printBuildResult(reporter, build);
  printDeployResult(reporter, deploy);
  return deploy.success ? 0 : 1;
}

async function runPreviewFromBuild(
  build: BuildResult,
  reporter: CliReporter,
  waitForPreviewShutdown: (() => Promise<void>) | undefined,
  previewPort: number | undefined
): Promise<number> {
  if (!build.success || build.outputDir === undefined) {
    throw new Error("Cannot preview from an unavailable build result.");
  }

  writeReadableDiagnosticsToLogger(reporter, {
    issues: build.issues,
    logs: build.logs
  });

  const port = previewPort ?? 8080;
  const server = await startStaticPreviewServer(build.outputDir, port);
  const session: PreviewSession = {
    success: true as const,
    url: `http://127.0.0.1:${port}`,
    workspaceRoot: build.outputDir,
    startedAt: new Date().toISOString()
  };

  try {
    if (reporter.json) {
      printJson(reporter, {
        command: "preview",
        success: true,
        logPath: reporter.logger.logPath,
        session
      });
    } else {
      printPreviewSession(reporter, session);
    }

    reporter.logger.info(`Preview reused existing build output at ${build.outputDir}`);
    reporter.logger.info(`Preview active at ${session.url}`);
    await (waitForPreviewShutdown ?? waitForTerminationSignal)();
    return 0;
  } finally {
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
}
