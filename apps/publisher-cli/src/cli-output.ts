import type { BuildIssue, BuildLogEntry, BuildResult, DeployResult, PreviewSession } from "@osp/shared";

import type { CliReporter } from "./cli-types.js";

export function printBuildResult(reporter: CliReporter, result: BuildResult): void {
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

export function writeBuildLogsToLogger(reporter: CliReporter, logs: BuildLogEntry[]): void {
  for (const log of logs) {
    reporter.logger.entry(log.level === "warning" || log.level === "error" ? log.level : "info", `[build] ${log.message}`);
  }
}

export function writeReadableDiagnosticsToLogger(reporter: CliReporter, input: {
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

export function writeIssuesToLogger(reporter: CliReporter, issues: BuildIssue[], scope: "scan" | "build"): void {
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

export function printPreviewSession(reporter: CliReporter, session: PreviewSession): void {
  if (!session.success) {
    writeInfo(reporter, `Preview failed: ${session.message}`);
    return;
  }

  writeInfo(reporter, `Preview ready at ${session.url}`);
  writeInfo(reporter, `Workspace: ${session.workspaceRoot}`);
  writeInfo(reporter, "Press Ctrl+C to stop preview.");
}

export function printDeployResult(reporter: CliReporter, result: DeployResult): void {
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

export function printIssues(reporter: CliReporter, issues: BuildIssue[]): void {
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

export function formatIssue(issue: BuildIssue): string {
  const location = issue.location === undefined ? issue.file : `${issue.file}:${issue.location.line}:${issue.location.column}`;

  return `[${issue.severity}] ${issue.code} ${location} ${issue.message}`;
}

export function createConfigSourceMessage(configPath: string | undefined, vaultRoot: string): string {
  if (configPath === undefined) {
    return `Using default CLI config for vault ${vaultRoot}`;
  }

  return `Using config ${configPath} for vault ${vaultRoot}`;
}

export function createHelpText(): string {
  return `publisher-cli <scan|build|preview|deploy> [--config <path>] [--vault-root <path>] [--json]`;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "CLI command failed with an unknown error.";
}

export function printJson(reporter: CliReporter, payload: { command: string; success: boolean; logPath?: string } & Record<string, unknown>): void {
  reporter.output.log(JSON.stringify(payload));
  reporter.logger.info(`JSON result emitted for ${payload.command}.`);
}

export function writeInfo(reporter: CliReporter, message: string): void {
  reporter.logger.info(message);

  if (!reporter.json) {
    reporter.output.log(message);
  }
}

export function writeError(reporter: CliReporter, message: string): void {
  reporter.logger.error(message);
  reporter.output.error(message);
}
