import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./main";
import { createCapturedOutput, createStubRuntime } from "./main.test.helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("runCli arguments", () => {
  it("prints help when no command is provided", async () => {
    const output = createCapturedOutput();

    const exitCode = await runCli([], {
      output
    });

    expect(exitCode).toBe(0);
    expect(output.logs.join("\n")).toContain("publisher-cli <scan|build|preview|deploy>");
  });

  it("merges partial config from osp.config.json", async () => {
    const cwd = await createTempDirectory();
    const output = createCapturedOutput();
    const runtime = createStubRuntime();

    await writeFile(
      path.join(cwd, "osp.config.json"),
      JSON.stringify(
        {
          publishMode: "folder",
          publishRoot: "Public",
          strictMode: true,
          deployTarget: "local-export",
          deployOutputDir: "./exports/site",
          deployBranch: "site",
          deployCommitMessage: "Publish from config"
        },
        null,
        2
      ),
      "utf8"
    );

    const exitCode = await runCli(["scan"], {
      cwd,
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: cwd,
        publishMode: "folder",
        publishRoot: "Public",
        strictMode: true,
        deployTarget: "local-export",
        deployOutputDir: path.join(cwd, "exports", "site"),
        deployBranch: "site",
        deployCommitMessage: "Publish from config"
      })
    );
    expect(output.logs.join("\n")).toContain("Using config");
  });

  it("passes Quartz builder options into the runtime factory", async () => {
    const output = createCapturedOutput();
    const runtime = createStubRuntime();
    const createRuntime = vi.fn(() => runtime);

    const exitCode = await runCli(
      ["preview", "--vault-root", "./vault", "--static-preview", "--quartz-package-root", "./runtime/quartz"],
      {
        cwd: "c:\\workspace",
        output,
        createRuntime,
        waitForPreviewShutdown: vi.fn(async () => { })
      }
    );

    expect(exitCode).toBe(0);
    expect(createRuntime).toHaveBeenCalledWith({
      quartzPackageRoot: path.resolve("c:\\workspace", "runtime/quartz"),
      preferStaticPreview: true
    });
  });

  it("writes a bootstrap log when argument parsing fails", async () => {
    const cwd = await createTempDirectory();
    const output = createCapturedOutput();

    const exitCode = await runCli(["scan", "--preview-port"], {
      cwd,
      output
    });

    expect(exitCode).toBe(1);
    const logContents = await readLatestCliLog(path.join(cwd, ".osp", "logs"));

    expect(logContents).toContain("Missing value for --preview-port.");
    expect(logContents).toContain("CLI failed before command execution started.");
  });

  it("writes a bootstrap log when config resolution fails before the main reporter exists", async () => {
    const cwd = await createTempDirectory();
    const output = createCapturedOutput();

    await writeFile(path.join(cwd, "publisher.config.json"), "{ not-valid-json", "utf8");

    const exitCode = await runCli(["scan"], {
      cwd,
      output
    });

    expect(exitCode).toBe(1);
    const logContents = await readLatestCliLog(path.join(cwd, ".osp", "logs"));

    expect(logContents).toContain("CLI failed before the main reporter was initialized.");
    expect(logContents).toContain("Expected property name or '}' in JSON");
  });
});

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "osp-cli-"));

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function readLatestCliLog(logDirectory: string): Promise<string> {
  await mkdir(logDirectory, { recursive: true });
  const logFiles = (await readdir(logDirectory))
    .filter((entry) => entry.endsWith(".log"))
    .sort();
  const latestLog = logFiles.at(-1);

  if (latestLog === undefined) {
    throw new Error(`No log file found in ${logDirectory}`);
  }

  return readFile(path.join(logDirectory, latestLog), "utf8");
}
