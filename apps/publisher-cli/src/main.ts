import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDefaultPublisherRuntime } from "@osp/core";

import { createCliLogger } from "./cli-logging.js";
import { parseCliArguments, resolveCliConfig } from "./config.js";
import { resolveBundledNodeExecutablePath } from "./cli-runtime-support.js";
import { createHelpText, formatError, writeError } from "./cli-output.js";
import { readBuildResult, resolveBootstrapCommand, writeBootstrapFailureLog } from "./cli-bootstrap.js";
import { runBuildCommand, runDeployCommand, runPreviewCommand, runScanCommand } from "./cli-reporter.js";
import type { CliReporter, CliRuntime, CliSession } from "./cli-types.js";

export type { CliOutput, CliOrchestrator, CliSession, CliRuntime, CliReporter } from "./cli-types.js";

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
      const { createConfigSourceMessage } = await import("./cli-output.js");

      output.log(createConfigSourceMessage(resolvedConfig.configPath, resolvedConfig.config.vaultRoot));
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
