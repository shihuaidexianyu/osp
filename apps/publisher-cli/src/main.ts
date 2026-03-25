import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDefaultPublisherRuntime } from "@osp/core";
import type { PublisherOrchestrator } from "@osp/core";
import { BuildResultSchema, type BuildIssue, type BuildLogEntry, type BuildResult, type CliJsonResult, type DeployResult, type PreviewSession, type PublisherConfig } from "@osp/shared";
import { startStaticPreviewServer } from "./static-preview-server.js";

import { createCliLogger, type CliLogger } from "./cli-logging.js";
import { parseCliArguments, resolveCliConfig, supportedCommands } from "./config.js";
import { resolveBundledNodeExecutablePath, waitForTerminationSignal } from "./cli-runtime-support.js";

type CliOutput = {
  log(message: string): void;
  error(message: string): void;
};

type CliOrchestrator = Pick<PublisherOrchestrator, "scan" | "build" | "preview" | "deployFromBuild">;

type CliSession = {
  orchestrator: CliOrchestrator;
  stop(): Promise<void>;
};

export type CliRuntime = {
  cwd?: string;
  output?: CliOutput;
  createRuntime?: (options: {
    nodeExecutablePath?: string;
    quartzPackageRoot?: string;
    preferStaticPreview: boolean;
    previewPort?: number;
  }) => CliSession;
  waitForPreviewShutdown?: () => Promise<void>;
};

type CliReporter = {
  json: boolean;
  logger: CliLogger;
  output: CliOutput;
};

export async function runCli(argv: string[], runtime: CliRuntime = {}): Promise<number> {
  const output = runtime.output ?? console;
  const cwd = runtime.cwd ?? process.cwd();
  const parsedArguments = parseCliArguments(argv);

  if (parsedArguments.kind === "help") {
    output.log(createHelpText());
    return 0;
  }

  if (parsedArguments.kind === "error") {
    output.error(parsedArguments.message);
    output.log(createHelpText());
    await writeBootstrapFailureLog({
      command: resolveBootstrapCommand(argv[0]),
      cwd,
      output,
      message: parsedArguments.message,
      details: ["CLI failed before command execution started."]
    });
    return 1;
  }

  let cliRuntime: CliSession | undefined;
  let reporter: CliReporter | undefined;

  try {
    const resolvedConfig = await resolveCliConfig(parsedArguments.options, cwd);
    const resolvedBuild =
      parsedArguments.options.buildResultPath === undefined
        ? undefined
        : await readBuildResult(path.resolve(cwd, parsedArguments.options.buildResultPath));
    const bundledNodeExecutablePath = resolveBundledNodeExecutablePath();
    const builderOptions = {
      ...(bundledNodeExecutablePath === undefined ? {} : { nodeExecutablePath: bundledNodeExecutablePath }),
      ...(parsedArguments.options.quartzPackageRoot === undefined
        ? {}
        : { quartzPackageRoot: path.resolve(cwd, parsedArguments.options.quartzPackageRoot) }),
      ...(parsedArguments.options.previewPort === undefined ? {} : { previewPort: parsedArguments.options.previewPort }),
      ...(parsedArguments.options.preferStaticPreview ? { preferStaticPreview: true } : {})
    };
    const logger = await createCliLogger({
      command: parsedArguments.command,
      ...(parsedArguments.options.logDir === undefined ? {} : { logDir: path.resolve(cwd, parsedArguments.options.logDir) }),
      vaultRoot: resolvedConfig.config.vaultRoot
    });

    reporter = {
      json: parsedArguments.options.json,
      logger,
      output
    };
    reporter.logger.info(`Resolved vault root: ${resolvedConfig.config.vaultRoot}`);

    cliRuntime =
      runtime.createRuntime?.({
        ...(builderOptions.nodeExecutablePath === undefined ? {} : { nodeExecutablePath: builderOptions.nodeExecutablePath }),
        ...(builderOptions.quartzPackageRoot === undefined ? {} : { quartzPackageRoot: builderOptions.quartzPackageRoot }),
        ...(builderOptions.previewPort === undefined ? {} : { previewPort: builderOptions.previewPort }),
        preferStaticPreview: parsedArguments.options.preferStaticPreview
      }) ??
      createDefaultPublisherRuntime({
        builder: builderOptions
      });

    if (!reporter.json) {
      writeInfo(reporter, createConfigSourceMessage(resolvedConfig.configPath, resolvedConfig.config.vaultRoot));
    }

    switch (parsedArguments.command) {
      case "scan":
        return await runScanCommand(cliRuntime.orchestrator, resolvedConfig.config, reporter);
      case "build":
        return await runBuildCommand(cliRuntime.orchestrator, resolvedConfig.config, reporter);
      case "preview":
        return await runPreviewCommand(
          cliRuntime,
          resolvedConfig.config,
          reporter,
          runtime.waitForPreviewShutdown,
          parsedArguments.options.previewPort,
          resolvedBuild
        );
      case "deploy":
        return await runDeployCommand(cliRuntime.orchestrator, resolvedConfig.config, reporter, resolvedBuild);
    }

    return 1;
  } catch (error) {
    const message = formatError(error);

    if (reporter === undefined) {
      output.error(message);
      await writeBootstrapFailureLog({
        command: parsedArguments.command,
        cwd,
        output,
        options: parsedArguments.options,
        message,
        details: ["CLI failed before the main reporter was initialized."]
      });
    } else {
      writeError(reporter, message);
    }

    return 1;
  } finally {
    await cliRuntime?.stop();
    await reporter?.logger.close();
  }
}

async function runScanCommand(orchestrator: CliOrchestrator, config: PublisherConfig, reporter: CliReporter): Promise<number> {
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

async function runBuildCommand(orchestrator: CliOrchestrator, config: PublisherConfig, reporter: CliReporter): Promise<number> {
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

async function runPreviewCommand(
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

  reporter.logger.info(`Preview active at ${session.url}`);
  await (waitForPreviewShutdown ?? waitForTerminationSignal)();
  return 0;
}

async function runDeployCommand(
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

function printBuildResult(reporter: CliReporter, result: BuildResult): void {
  writeInfo(
    reporter,
    [
      result.success ? "Build succeeded." : "Build failed.",
      `Issues: ${result.issues.length}`,
      `Logs: ${result.logs.length}`,
      `Duration: ${result.durationMs}ms`,
      ...(result.outputDir === undefined ? [] : [`Output: ${result.outputDir}`])
    ].join(" ")
  );
  printIssues(reporter, result.issues);

  const lastLog = result.logs.at(-1);

  if (lastLog !== undefined) {
    writeInfo(reporter, `Last log: [${lastLog.level}] ${lastLog.message}`);
  }
}

function writeBuildLogsToLogger(reporter: CliReporter, logs: BuildLogEntry[]): void {
  for (const log of logs) {
    reporter.logger.entry(log.level === "warning" || log.level === "error" ? log.level : "info", `[build] ${log.message}`);
  }
}

function writeReadableDiagnosticsToLogger(reporter: CliReporter, input: {
  issues: BuildIssue[];
  logs: BuildLogEntry[];
}): void {
  const issueStatistics = createIssueSummary(input.issues);
  reporter.logger.info(`Issue statistics: ${issueStatistics === "" ? "none" : issueStatistics}`);

  const groupedEntries = {
    error: [] as string[],
    warning: [] as string[],
    info: [] as string[]
  };

  for (const issue of input.issues) {
    groupedEntries[mapIssueSeverityToLogLevel(issue.severity)].push(`[issue] ${formatIssue(issue)}`);
  }

  for (const log of input.logs) {
    groupedEntries[mapBuildLogLevel(log.level)].push(`[build] ${log.message}`);
  }

  reporter.logger.info(
    `Log level totals: ERROR=${groupedEntries.error.length}, WARNING=${groupedEntries.warning.length}, INFO=${groupedEntries.info.length}`
  );

  writeGroupedLogSection(reporter, "error", groupedEntries.error);
  writeGroupedLogSection(reporter, "warning", groupedEntries.warning);
  writeGroupedLogSection(reporter, "info", groupedEntries.info);
}

function writeGroupedLogSection(reporter: CliReporter, level: "error" | "warning" | "info", entries: string[]): void {
  if (entries.length === 0) {
    return;
  }

  reporter.logger.entry(level, `===== ${level.toUpperCase()} (${entries.length}) =====`);

  for (const entry of entries) {
    reporter.logger.entry(level, entry);
  }
}

function mapBuildLogLevel(level: BuildLogEntry["level"]): "info" | "warning" | "error" {
  switch (level) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
    case "debug":
      return "info";
  }
}

function writeIssuesToLogger(reporter: CliReporter, issues: BuildIssue[], scope: "scan" | "build"): void {
  for (const issue of issues) {
    reporter.logger.entry(mapIssueSeverityToLogLevel(issue.severity), `[${scope}] ${formatIssue(issue)}`);
  }
}

function mapIssueSeverityToLogLevel(severity: BuildIssue["severity"]): "info" | "warning" | "error" {
  switch (severity) {
    case "info":
      return "info";
    case "warning":
      return "warning";
    case "error":
      return "error";
  }
}

function printPreviewSession(reporter: CliReporter, session: PreviewSession): void {
  writeInfo(reporter, `Preview ready at ${session.url}`);
  writeInfo(reporter, `Workspace: ${session.workspaceRoot}`);
  writeInfo(reporter, "Press Ctrl+C to stop preview.");
}

function printDeployResult(reporter: CliReporter, result: DeployResult): void {
  writeInfo(
    reporter,
    [
      result.success ? "Deploy succeeded." : "Deploy failed.",
      `Target: ${result.target}`,
      result.message,
      ...(result.destination === undefined ? [] : [`Destination: ${result.destination}`])
    ].join(" ")
  );
}

function printIssues(reporter: CliReporter, issues: BuildIssue[]): void {
  if (issues.length === 0) {
    writeInfo(reporter, "No issues found.");
    return;
  }

  writeInfo(reporter, `Issue summary: ${createIssueSummary(issues)}`);

  for (const issue of issues) {
    writeInfo(reporter, `- ${formatIssue(issue)}`);
  }
}

function createIssueSummary(issues: BuildIssue[]): string {
  const counts = new Map<string, number>();

  for (const issue of issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([leftCode], [rightCode]) => leftCode.localeCompare(rightCode))
    .map(([code, count]) => `${code}=${count}`)
    .join(", ");
}

function formatIssue(issue: BuildIssue): string {
  const location = issue.location === undefined ? issue.file : `${issue.file}:${issue.location.line}:${issue.location.column}`;

  return `[${issue.severity}] ${issue.code} ${location} ${issue.message}`;
}

function createConfigSourceMessage(configPath: string | undefined, vaultRoot: string): string {
  if (configPath === undefined) {
    return `Using default CLI config for vault ${vaultRoot}`;
  }

  return `Using config ${configPath} for vault ${vaultRoot}`;
}

function createHelpText(): string {
  return [
    `publisher-cli <${supportedCommands.join("|")}> [--config <path>] [--vault-root <path>] [--json]`,
    "",
    "Examples:",
    "  publisher-cli scan --vault-root ./test_vault/hw",
    "  publisher-cli build --config ./osp.config.json --log-dir ./.osp/logs",
    "  publisher-cli preview --vault-root ./my-vault --preview-port 8080",
    "  publisher-cli deploy --config ./publisher.config.json"
  ].join("\n");
}

async function readBuildResult(buildResultPath: string): Promise<BuildResult> {
  const fileContents = await readFile(buildResultPath, "utf8");
  return BuildResultSchema.parse(JSON.parse(fileContents)) as BuildResult;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "CLI command failed with an unknown error.";
}

function printJson(reporter: CliReporter, payload: CliJsonResult): void {
  reporter.output.log(JSON.stringify(payload));
  reporter.logger.info(`JSON result emitted for ${payload.command}.`);
}

function writeInfo(reporter: CliReporter, message: string): void {
  reporter.logger.info(message);

  if (!reporter.json) {
    reporter.output.log(message);
  }
}

function writeError(reporter: CliReporter, message: string): void {
  reporter.logger.error(message);
  reporter.output.error(message);
}

async function writeBootstrapFailureLog(input: {
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

function resolveBootstrapCommand(argvCommand: string | undefined): string {
  return argvCommand !== undefined && supportedCommands.includes(argvCommand as (typeof supportedCommands)[number]) ? argvCommand : "cli";
}
