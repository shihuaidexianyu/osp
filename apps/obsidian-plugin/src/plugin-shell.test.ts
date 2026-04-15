import { describe, expect, it, vi } from "vitest";

import { PluginExecutionError } from "./plugin-backend.js";
import { PublisherPluginShell } from "./plugin-shell.js";
import { createBackend, createConfig } from "./plugin-shell.test.helpers.js";

describe("PublisherPluginShell", () => {
  it("exposes the four plugin commands with stable ids", () => {
    const plugin = new PublisherPluginShell(() => createBackend());

    expect(plugin.getCommandDefinitions()).toEqual([
      { id: "osp:preview", name: "启动站点预览", command: "preview" },
      { id: "osp:build", name: "构建站点", command: "build" },
      { id: "osp:publish", name: "发布站点", command: "publish" },
      { id: "osp:issues", name: "检查发布问题", command: "issues" }
    ]);
  });

  it("creates a safe default config for Obsidian vaults", () => {
    const plugin = new PublisherPluginShell(() => createBackend());

    expect(plugin.createInitialConfig("/vault")).toMatchObject({
      vaultRoot: "/vault",
      outputDir: "/vault/.osp/dist",
      excludeGlobs: ["**/.git/**", "**/.obsidian/**", "**/.osp/**", "**/.trash/**", "**/node_modules/**"]
    });
  });

  it("runs the issues command through core scan and stores the latest issues", async () => {
    const backend = createBackend({
      scanResult: {
        manifest: {
          generatedAt: new Date().toISOString(),
          vaultRoot: "/vault",
          notes: [],
          assetFiles: [],
          unsupportedObjects: []
        },
        logPath: "/vault/.osp/logs/scan.log",
        issues: [
          {
            code: "BROKEN_LINK",
            severity: "error",
            file: "Broken.md",
            message: "Broken"
          }
        ]
      }
    });
    const plugin = new PublisherPluginShell(() => backend);

    const result = await plugin.runCommand("issues", createConfig("/vault"));

    expect(result.command).toBe("issues");
    expect(backend.scan).toHaveBeenCalledOnce();
    expect(plugin.getState()).toMatchObject({
      lastCommand: "issues",
      lastLogPath: "/vault/.osp/logs/scan.log",
      lastIssues: [
        {
          code: "BROKEN_LINK"
        }
      ],
      statusMessage: "发现 1 个发布问题。"
    });
  });

  it("runs build through core and stores logs for later UI rendering", async () => {
    const backend = createBackend({
      buildResult: {
        logPath: "/vault/.osp/logs/build.log",
        result: {
          success: true,
          outputDir: "/vault/.osp/dist",
          manifestPath: "/vault/.osp/build/manifest.json",
          issues: [],
          logs: [
            {
              level: "info",
              message: "Quartz build finished.",
              timestamp: new Date().toISOString()
            }
          ],
          durationMs: 1
        }
      }
    });
    const plugin = new PublisherPluginShell(() => backend);

    const result = await plugin.runCommand("build", createConfig("/vault"));

    expect(result.command).toBe("build");
    expect(backend.build).toHaveBeenCalledOnce();
    expect(plugin.getState()).toMatchObject({
      lastCommand: "build",
      lastLogPath: "/vault/.osp/logs/build.log",
      lastLogs: [
        {
          message: "Quartz build finished."
        }
      ],
      statusMessage: "站点构建完成。"
    });
  });

  it("runs preview through core and stores the last preview session", async () => {
    const backend = createBackend({
      previewResult: {
        logPath: "/vault/.osp/logs/preview.log",
        session: {
          success: true as const,
          url: "http://localhost:8080",
          workspaceRoot: "/vault/.osp/preview",
          startedAt: new Date().toISOString()
        }
      }
    });
    const plugin = new PublisherPluginShell(() => backend);

    const result = await plugin.runCommand("preview", createConfig("/vault"));

    expect(result.command).toBe("preview");
    expect(backend.preview).toHaveBeenCalledOnce();
    expect(plugin.getState()).toMatchObject({
      lastCommand: "preview",
      lastLogPath: "/vault/.osp/logs/preview.log",
      lastPreviewSession: {
        url: "http://localhost:8080"
      }
    });
    expect(backend.dispose).not.toHaveBeenCalled();
  });

  it("reuses the last successful build for preview", async () => {
    const buildBackend = createBackend({
      buildResult: {
        logPath: "/vault/.osp/logs/build.log",
        result: {
          success: true,
          outputDir: "/vault/.osp/dist",
          manifestPath: "/vault/.osp/build/manifest.json",
          issues: [],
          logs: [],
          durationMs: 1
        }
      }
    });
    const previewBackend = createBackend({
      previewResult: {
        logPath: "/vault/.osp/logs/preview.log",
        session: {
          success: true as const,
          url: "http://localhost:8080",
          workspaceRoot: "/vault/.osp/preview",
          startedAt: new Date().toISOString()
        }
      }
    });
    const plugin = new PublisherPluginShell(vi.fn().mockReturnValueOnce(buildBackend).mockReturnValueOnce(previewBackend));

    await plugin.runCommand("build", createConfig("/vault"));
    await plugin.runCommand("preview", createConfig("/vault"));

    expect(previewBackend.previewBuilt).toHaveBeenCalledOnce();
    expect(previewBackend.preview).not.toHaveBeenCalled();
  });

  it("stops the previous preview before starting a new one", async () => {
    const firstBackend = createBackend({
      previewResult: {
        session: {
          success: true as const,
          url: "http://localhost:8080",
          workspaceRoot: "/vault/.osp/preview-a",
          startedAt: new Date().toISOString()
        }
      }
    });
    const secondBackend = createBackend({
      previewResult: {
        session: {
          success: true as const,
          url: "http://localhost:8081",
          workspaceRoot: "/vault/.osp/preview-b",
          startedAt: new Date().toISOString()
        }
      }
    });
    const plugin = new PublisherPluginShell(vi.fn().mockReturnValueOnce(firstBackend).mockReturnValueOnce(secondBackend));

    await plugin.runCommand("preview", createConfig("/vault"));
    await plugin.runCommand("preview", createConfig("/vault"));

    expect(firstBackend.dispose).toHaveBeenCalledOnce();
    expect(secondBackend.dispose).not.toHaveBeenCalled();
  });

  it("disposes the active preview runtime when the shell is disposed", async () => {
    const backend = createBackend();
    const plugin = new PublisherPluginShell(() => backend);

    await plugin.runCommand("preview", createConfig("/vault"));
    await plugin.dispose();

    expect(backend.dispose).toHaveBeenCalledOnce();
  });

  it("can stop an active preview and clear the session state", async () => {
    const backend = createBackend();
    const plugin = new PublisherPluginShell(() => backend);

    await plugin.runCommand("preview", createConfig("/vault"));

    await expect(plugin.stopPreview()).resolves.toBe(true);
    expect(backend.dispose).toHaveBeenCalledOnce();
    expect(plugin.getState()).toMatchObject({
      lastCommand: "preview",
      lastPreviewSession: undefined,
      statusMessage: "预览已停止。"
    });
  });

  it("runs publish as build plus deploy and stores the deploy result", async () => {
    const backend = createBackend({
      publishResult: {
        logPath: "/vault/.osp/logs/deploy.log",
        build: {
          success: true,
          outputDir: "/vault/.osp/dist",
          manifestPath: "/vault/.osp/build/manifest.json",
          issues: [],
          logs: [],
          durationMs: 1
        },
        deploy: {
          success: true,
          target: "none",
          destination: "/vault/.osp/dist",
          message: "Published."
        }
      }
    });
    const plugin = new PublisherPluginShell(() => backend);

    const result = await plugin.runCommand("publish", createConfig("/vault"));

    expect(result.command).toBe("publish");
    expect(backend.publish).toHaveBeenCalledOnce();
    expect(plugin.getState()).toMatchObject({
      lastCommand: "publish",
      lastLogPath: "/vault/.osp/logs/deploy.log",
      lastDeployResult: {
        success: true
      },
      statusMessage: "站点发布成功。"
    });
  });

  it("reuses the last successful build for publish deployment", async () => {
    const buildBackend = createBackend({
      buildResult: {
        logPath: "/vault/.osp/logs/build.log",
        result: {
          success: true,
          outputDir: "/vault/.osp/dist",
          manifestPath: "/vault/.osp/build/manifest.json",
          issues: [],
          logs: [],
          durationMs: 1
        }
      }
    });
    const deployBackend = createBackend();
    const plugin = new PublisherPluginShell(vi.fn().mockReturnValueOnce(buildBackend).mockReturnValueOnce(deployBackend));

    await plugin.runCommand("build", createConfig("/vault"));
    const result = await plugin.runCommand("publish", createConfig("/vault"));

    expect(result.command).toBe("publish");
    expect(deployBackend.deployBuilt).toHaveBeenCalledOnce();
    expect(deployBackend.publish).not.toHaveBeenCalled();
  });

  it("does not deploy when publish build fails", async () => {
    const backend = createBackend({
      publishResult: {
        logPath: "/vault/.osp/logs/deploy.log",
        build: {
          success: false,
          outputDir: "/vault/.osp/dist",
          manifestPath: "/vault/.osp/build/manifest.json",
          issues: [],
          logs: [],
          durationMs: 1
        }
      }
    });
    const plugin = new PublisherPluginShell(() => backend);

    const result = await plugin.runCommand("publish", createConfig("/vault"));

    expect(result.command).toBe("publish");
    expect(backend.publish).toHaveBeenCalledOnce();
    expect(plugin.getState().statusMessage).toBe("发布已停止，因为构建没有成功。");
  });

  it("stores fallback log metadata when a command fails", async () => {
    const backend = createBackend();
    backend.build = vi.fn(async () => {
      throw new PluginExecutionError("启动外部 publisher-cli 失败。", {
        logPath: "/vault/.osp/logs/build-fallback.log"
      });
    });
    const plugin = new PublisherPluginShell(() => backend);

    await expect(plugin.runCommand("build", createConfig("/vault"))).rejects.toThrow("启动外部 publisher-cli 失败。");
    expect(plugin.getState()).toMatchObject({
      lastCommand: "build",
      lastLogPath: "/vault/.osp/logs/build-fallback.log",
      statusMessage: "构建失败，请检查日志。"
    });
  });
});
