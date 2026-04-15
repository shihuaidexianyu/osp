import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./main";
import { createBuildResult, createCapturedOutput, createDeployResult, createPreviewSession, createStubRuntime } from "./main.test.helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("runCli commands", () => {
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
});

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "osp-cli-"));

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}
