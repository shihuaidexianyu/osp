import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BuildResult, DeployResult, PreviewSession, PublisherConfig, VaultManifest } from "@osp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./main";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("runCli", () => {
  it("prints help when no command is provided", async () => {
    const output = createCapturedOutput();

    const exitCode = await runCli([], {
      output
    });

    expect(exitCode).toBe(0);
    expect(output.logs.join("\n")).toContain("publisher-cli <scan|build|preview|deploy>");
  });

  it("runs scan with default config resolved from --vault-root", async () => {
    const output = createCapturedOutput();
    const runtime = createStubRuntime();

    const exitCode = await runCli(["scan", "--vault-root", "./test_vault/hw"], {
      cwd: "c:\\workspace",
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: path.resolve("c:\\workspace", "test_vault/hw"),
        outputDir: path.join(path.resolve("c:\\workspace", "test_vault/hw"), ".osp", "dist")
      })
    );
    expect(output.logs.join("\n")).toContain("Scan complete.");
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

  it("returns exit code 1 when build fails", async () => {
    const output = createCapturedOutput();
    const runtime = createStubRuntime({
      buildResult: {
        success: false,
        manifestPath: "/workspace/manifest.json",
        issues: [],
        logs: [],
        durationMs: 12
      }
    });

    const exitCode = await runCli(["build", "--vault-root", "./vault"], {
      cwd: "c:\\workspace",
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(1);
    expect(output.logs.join("\n")).toContain("Build failed.");
  });

  it("builds and deploys when deploy command is used", async () => {
    const output = createCapturedOutput();
    const runtime = createStubRuntime();

    const exitCode = await runCli(["deploy", "--vault-root", "./vault"], {
      cwd: "c:\\workspace",
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.build).toHaveBeenCalledOnce();
    expect(runtime.orchestrator.deployFromBuild).toHaveBeenCalledOnce();
    expect(output.logs.join("\n")).toContain("Deploy succeeded.");
  });

  it("starts preview and waits for shutdown signal hook", async () => {
    const output = createCapturedOutput();
    const runtime = createStubRuntime();
    const waitForPreviewShutdown = vi.fn(async () => { });

    const exitCode = await runCli(["preview", "--vault-root", "./vault"], {
      cwd: "c:\\workspace",
      output,
      createRuntime: () => runtime,
      waitForPreviewShutdown
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.preview).toHaveBeenCalledOnce();
    expect(waitForPreviewShutdown).toHaveBeenCalledOnce();
    expect(output.logs.join("\n")).toContain("Preview ready at http://localhost:8080");
  });

  it("reuses an existing build for preview when --build-result is provided", async () => {
    const cwd = await createTempDirectory();
    const output = createCapturedOutput();
    const runtime = createStubRuntime();
    const waitForPreviewShutdown = vi.fn(async () => { });
    const buildResultPath = path.join(cwd, "build-result.json");
    const outputDir = path.join(cwd, "dist");

    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "index.html"), "<html><body>Preview</body></html>", "utf8");
    await writeFile(buildResultPath, JSON.stringify(createBuildResult({ outputDir }), null, 2), "utf8");

    const exitCode = await runCli(["preview", "--vault-root", "./vault", "--build-result", buildResultPath], {
      cwd,
      output,
      createRuntime: () => runtime,
      waitForPreviewShutdown
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.preview).not.toHaveBeenCalled();
    expect(waitForPreviewShutdown).toHaveBeenCalledOnce();
    expect(output.logs.join("\n")).toContain("Preview ready at http://127.0.0.1:8080");
  });

  it("writes reused build logs into the preview CLI log file when --build-result is provided", async () => {
    const cwd = await createTempDirectory();
    const output = createCapturedOutput();
    const runtime = createStubRuntime();
    const waitForPreviewShutdown = vi.fn(async () => { });
    const buildResultPath = path.join(cwd, "build-result.json");
    const outputDir = path.join(cwd, "dist");

    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "index.html"), "<html><body>Preview</body></html>", "utf8");
    await writeFile(
      buildResultPath,
      JSON.stringify(
        createBuildResult({
          outputDir,
          logs: [
            {
              level: "info",
              message: "Generating HTML pages...",
              timestamp: "2026-03-18T11:11:13.000Z"
            }
          ]
        }),
        null,
        2
      ),
      "utf8"
    );

    const exitCode = await runCli(["preview", "--vault-root", "./vault", "--build-result", buildResultPath, "--json"], {
      cwd,
      output,
      createRuntime: () => runtime,
      waitForPreviewShutdown
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.preview).not.toHaveBeenCalled();
    expect(waitForPreviewShutdown).toHaveBeenCalledOnce();

    const payload = JSON.parse(output.logs.at(-1) ?? "{}") as { logPath?: string };
    const logContents = await readFile(payload.logPath ?? "", "utf8");

    expect(logContents).toContain("[build] Generating HTML pages...");
  });

  it("prints machine-readable JSON when --json is used", async () => {
    const output = createCapturedOutput();
    const runtime = createStubRuntime();

    const exitCode = await runCli(["build", "--vault-root", "./vault", "--json"], {
      cwd: "c:\\workspace",
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.logs.at(-1) ?? "{}")).toMatchObject({
      command: "build",
      success: true,
      result: {
        outputDir: "/workspace/dist"
      }
    });
  });

  it("writes structured build.result.logs into the CLI log file in json mode", async () => {
    const cwd = await createTempDirectory();
    const vaultRoot = path.join(cwd, "vault");
    const output = createCapturedOutput();
    const runtime = createStubRuntime({
      buildResult: {
        success: true,
        outputDir: path.join(vaultRoot, ".osp", "dist"),
        manifestPath: path.join(vaultRoot, ".osp", "manifest.json"),
        issues: [],
        logs: [
          {
            level: "info",
            message: "Quartz build finished.",
            timestamp: "2026-03-18T11:11:13.000Z"
          },
          {
            level: "warning",
            message: "Latex emitted a warning.",
            timestamp: "2026-03-18T11:11:13.100Z"
          }
        ],
        durationMs: 12
      }
    });

    const exitCode = await runCli(["build", "--vault-root", vaultRoot, "--json"], {
      cwd,
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(0);

    const payload = JSON.parse(output.logs.at(-1) ?? "{}") as { logPath?: string };
    const logContents = await readFile(payload.logPath ?? "", "utf8");

    expect(logContents).toContain("[build] Quartz build finished.");
    expect(logContents).toContain("[build] Latex emitted a warning.");
    expect(logContents).toContain("WARNING");
    expect(logContents).toContain("Issue statistics: none");
    expect(logContents).toContain("Log level totals: ERROR=0, WARNING=1, INFO=1");
    expect(logContents).toContain("===== WARNING (1) =====");
    expect(logContents).toContain("===== INFO (1) =====");
  });

  it("writes build issue details into the CLI log file in json mode when build is blocked", async () => {
    const cwd = await createTempDirectory();
    const vaultRoot = path.join(cwd, "vault");
    const output = createCapturedOutput();
    const runtime = createStubRuntime({
      buildResult: {
        success: false,
        manifestPath: path.join(vaultRoot, ".osp", "manifest.json"),
        logs: [
          {
            level: "warning",
            message: "Cannot build while 2 error issue(s) remain unresolved.",
            timestamp: "2026-03-25T07:27:27.122Z"
          }
        ],
        issues: [
          {
            code: "BROKEN_LINK",
            severity: "error",
            file: "Broken.md",
            message: "Link target does not exist.",
            location: {
              line: 3,
              column: 7
            }
          },
          {
            code: "MISSING_ASSET",
            severity: "error",
            file: "Image.md",
            message: "Referenced image is missing."
          }
        ],
        durationMs: 9
      }
    });

    const exitCode = await runCli(["build", "--vault-root", vaultRoot, "--json"], {
      cwd,
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(1);

    const payload = JSON.parse(output.logs.at(-1) ?? "{}") as { logPath?: string };
    const logContents = await readFile(payload.logPath ?? "", "utf8");

    expect(logContents).toContain("Issue statistics: BROKEN_LINK=1, MISSING_ASSET=1");
    expect(logContents).toContain("Log level totals: ERROR=2, WARNING=1, INFO=0");
    expect(logContents).toContain("===== ERROR (2) =====");
    expect(logContents).toContain("===== WARNING (1) =====");
    expect(logContents).toContain("[issue] [error] BROKEN_LINK Broken.md:3:7 Link target does not exist.");
    expect(logContents).toContain("[issue] [error] MISSING_ASSET Image.md Referenced image is missing.");
    expect(logContents).toContain("ERROR");
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

  it("deploys from an existing build when --build-result is provided", async () => {
    const cwd = await createTempDirectory();
    const output = createCapturedOutput();
    const runtime = createStubRuntime();
    const buildResultPath = path.join(cwd, "build-result.json");

    await writeFile(buildResultPath, JSON.stringify(createBuildResult({ outputDir: path.join(cwd, "dist") }), null, 2), "utf8");

    const exitCode = await runCli(["deploy", "--vault-root", "./vault", "--build-result", buildResultPath], {
      cwd,
      output,
      createRuntime: () => runtime
    });

    expect(exitCode).toBe(0);
    expect(runtime.orchestrator.build).not.toHaveBeenCalled();
    expect(runtime.orchestrator.deployFromBuild).toHaveBeenCalledOnce();
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

function createStubRuntime(options: {
  buildResult?: BuildResult;
  previewSession?: PreviewSession;
  deployResult?: DeployResult;
} = {}) {
  return {
    orchestrator: {
      scan: vi.fn(async (config: PublisherConfig) => ({
        manifest: createManifest(config.vaultRoot),
        issues: []
      })),
      build: vi.fn(async () => options.buildResult ?? createBuildResult()),
      preview: vi.fn(async () => options.previewSession ?? createPreviewSession()),
      deployFromBuild: vi.fn(async () => options.deployResult ?? createDeployResult())
    },
    stop: vi.fn(async () => { })
  };
}

function createCapturedOutput() {
  return {
    logs: [] as string[],
    errors: [] as string[],
    log(message: string) {
      this.logs.push(message);
    },
    error(message: string) {
      this.errors.push(message);
    }
  };
}

function createManifest(vaultRoot: string): VaultManifest {
  return {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    notes: [],
    assetFiles: [],
    unsupportedObjects: []
  };
}

function createBuildResult(overrides: Partial<BuildResult> = {}): BuildResult {
  return {
    success: true,
    outputDir: "/workspace/dist",
    manifestPath: "/workspace/manifest.json",
    issues: [],
    logs: [
      {
        level: "info",
        message: "Quartz build finished.",
        timestamp: "2026-03-18T11:11:13.000Z"
      }
    ],
    durationMs: 12,
    ...overrides
  };
}

function createPreviewSession(): PreviewSession {
  return {
    url: "http://localhost:8080",
    workspaceRoot: "/workspace",
    startedAt: new Date().toISOString()
  };
}

function createDeployResult(): DeployResult {
  return {
    success: true,
    target: "none",
    destination: "/workspace/dist",
    message: "Deployed."
  };
}

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "osp-cli-"));

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function readLatestCliLog(logDirectory: string): Promise<string> {
  const logFiles = (await readdir(logDirectory))
    .filter((entry) => entry.endsWith(".log"))
    .sort();
  const latestLog = logFiles.at(-1);

  if (latestLog === undefined) {
    throw new Error(`No log file found in ${logDirectory}`);
  }

  return readFile(path.join(logDirectory, latestLog), "utf8");
}
