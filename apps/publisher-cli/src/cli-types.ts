import type { PublisherOrchestrator } from "@osp/core";
import type { CliLogger } from "./cli-logging.js";

export type CliOutput = {
  log(message: string): void;
  error(message: string): void;
};

export type CliOrchestrator = Pick<PublisherOrchestrator, "scan" | "build" | "preview" | "deployFromBuild">;

export type CliSession = {
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

export type CliReporter = {
  json: boolean;
  logger: CliLogger;
  output: CliOutput;
};
