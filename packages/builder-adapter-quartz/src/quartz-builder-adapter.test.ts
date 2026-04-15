import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { PreparedWorkspace, PublisherConfig } from "@osp/shared";
import { afterEach, describe, expect, it } from "vitest";

import { QuartzBuilderAdapter } from "./quartz-builder-adapter";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    })
  );
});

describe("QuartzBuilderAdapter", { timeout: 30000 }, () => {
  it(
    "builds a real Quartz site from a prepared workspace",
    async () => {
      const workspace = await createPreparedWorkspace("osp-quartz-build-");
      const adapter = new QuartzBuilderAdapter();

      const result = await adapter.build(workspace, createConfig(workspace.rootDir));

      expect(result.success).toBe(true);
      expect(result.outputDir).toBe(workspace.outputDir);
      await expect(access(path.join(workspace.outputDir, "index.html"))).resolves.toBeUndefined();

      const indexHtml = await readFile(path.join(workspace.outputDir, "index.html"), "utf8");

      expect(indexHtml).toContain("Hello Quartz");
    },
    60_000
  );

  it(
    "starts a real Quartz preview server",
    async () => {
      const workspace = await createPreparedWorkspace("osp-quartz-preview-");
      const previewPort = await getAvailablePort();
      const previewWsPort = await getAvailablePort();
      const adapter = new QuartzBuilderAdapter({
        previewPort,
        previewReadinessTimeoutMs: 60_000,
        previewWsPort
      });

      try {
        const session = await adapter.preview(workspace, createConfig(workspace.rootDir));

        if (session.success) {
          expect(session.url).toBe(`http://localhost:${previewPort}`);
        }

        const response = await fetch(session.success ? session.url : "");
        const html = await response.text();

        expect(response.ok).toBe(true);
        expect(html).toContain("Hello Quartz");
      } finally {
        await adapter.stopPreview(workspace.rootDir);
      }
    },
    90_000
  );

  it(
    "starts a static preview fallback server when requested",
    async () => {
      const workspace = await createPreparedWorkspace("osp-quartz-static-preview-");
      const previewPort = await getAvailablePort();
      const adapter = new QuartzBuilderAdapter({
        preferStaticPreview: true,
        previewPort
      });

      try {
        const session = await adapter.preview(workspace, createConfig(workspace.rootDir));

        if (session.success) {
          expect(session.url).toBe(`http://localhost:${previewPort}`);
        }

        const response = await fetch(session.success ? session.url : "");
        const html = await response.text();

        expect(response.ok).toBe(true);
        expect(html).toContain("Hello Quartz");
      } finally {
        await adapter.stopPreview(workspace.rootDir);
      }
    },
    90_000
  );

  it(
    "builds content from a workspace located under an ignored repository path",
    async () => {
      const ignoredRoot = path.resolve(".generated", `osp-quartz-ignored-${Date.now()}`);

      temporaryDirectories.push(ignoredRoot);

      const workspace = await createPreparedWorkspaceAt(ignoredRoot);
      const adapter = new QuartzBuilderAdapter();

      const result = await adapter.build(workspace, createConfig(workspace.rootDir));

      expect(result.success).toBe(true);
      await expect(access(path.join(workspace.outputDir, "index.html"))).resolves.toBeUndefined();

      const indexHtml = await readFile(path.join(workspace.outputDir, "index.html"), "utf8");

      expect(indexHtml).toContain("Hello Quartz");
    },
    60_000
  );
});

function createConfig(vaultRoot: string): PublisherConfig {
  return {
    vaultRoot,
    publishMode: "frontmatter",
    includeGlobs: [],
    excludeGlobs: [],
    outputDir: path.join(vaultRoot, ".osp", "dist"),
    builder: "quartz",
    deployTarget: "none",
    enableSearch: true,
    enableBacklinks: true,
    enableGraph: true,
    strictMode: false
  };
}

async function createPreparedWorkspace(prefix: string): Promise<PreparedWorkspace> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));

  temporaryDirectories.push(rootDir);
  return createPreparedWorkspaceAt(rootDir);
}

async function createPreparedWorkspaceAt(rootDir: string): Promise<PreparedWorkspace> {
  await mkdir(rootDir, { recursive: true });

  const contentDir = path.join(rootDir, "content");
  const outputDir = path.join(rootDir, "dist");
  const manifestPath = path.join(rootDir, "manifest.json");

  await mkdir(contentDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(contentDir, "index.md"),
    "---\ntitle: Home\n---\n\n# Hello Quartz\n\nThis page was built by the adapter test.\n",
    "utf8"
  );
  await writeFile(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString() }), "utf8");

  return {
    mode: "build",
    rootDir,
    contentDir,
    outputDir,
    manifestPath
  };
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a TCP port for Quartz preview test.")));
        return;
      }

      server.close((closeError) => {
        if (closeError !== undefined) {
          reject(closeError);
          return;
        }

        resolve(address.port);
      });
    });
  });
}
