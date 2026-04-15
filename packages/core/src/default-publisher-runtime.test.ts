import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { PublisherConfig } from "@osp/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultPublisherRuntime } from "./default-publisher-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("createDefaultPublisherRuntime", { timeout: 30000 }, () => {
  it(
    "builds a minimal publishable vault through the full default pipeline",
    async () => {
      const vaultRoot = await createTempVault();

      await writeVaultFile(
        vaultRoot,
        "index.md",
        ["---", "publish: true", "---", "", "# Home", "", "Welcome to the site."].join("\n")
      );

      const runtime = createDefaultPublisherRuntime();

      try {
        const result = await runtime.orchestrator.build(createConfig(vaultRoot));

        expect(result.success).toBe(true);
        expect(result.outputDir).toBeDefined();
        await expect(access(path.join(result.outputDir ?? "", "index.html"))).resolves.toBeUndefined();
      } finally {
        await runtime.stop();
      }
    },
    60_000
  );

  it(
    "deploys a built site through the default local export adapter",
    async () => {
      const vaultRoot = await createTempVault();
      const deployOutputDir = path.join(vaultRoot, ".published-site");

      await writeVaultFile(
        vaultRoot,
        "index.md",
        ["---", "publish: true", "---", "", "# Home", "", "Welcome to the deployed site."].join("\n")
      );

      const runtime = createDefaultPublisherRuntime();

      try {
        const build = await runtime.orchestrator.build(
          createConfig(vaultRoot, {
            deployTarget: "local-export",
            deployOutputDir
          })
        );
        const deploy = await runtime.orchestrator.deployFromBuild(
          build,
          createConfig(vaultRoot, {
            deployTarget: "local-export",
            deployOutputDir
          })
        );

        expect(deploy).toEqual({
          success: true,
          target: "local-export",
          destination: deployOutputDir,
          message: "Local export completed successfully."
        });
        await expect(access(path.join(deployOutputDir, "index.html"))).resolves.toBeUndefined();
        await expect(readFile(path.join(deployOutputDir, "index.html"), "utf8")).resolves.toContain(
          "Welcome to the deployed site."
        );
      } finally {
        await runtime.stop();
      }
    },
    60_000
  );

  it(
    "builds a generated landing page when the published slice has no root index note",
    async () => {
      const vaultRoot = await createTempVault();

      await writeVaultFile(vaultRoot, "Guides/Start.md", "# Start\n");

      const runtime = createDefaultPublisherRuntime();

      try {
        const result = await runtime.orchestrator.build(
          createConfig(vaultRoot, {
            publishMode: "folder",
            includeGlobs: ["**/*.md"]
          })
        );

        expect(result.success).toBe(true);
        await expect(readFile(path.join(result.outputDir ?? "", "index.html"), "utf8")).resolves.toContain(
          "generated automatically because the published slice does not contain a root"
        );
      } finally {
        await runtime.stop();
      }
    },
    60_000
  );

  it(
    "serves the generated landing page from preview when the published slice has no root index note",
    async () => {
      const vaultRoot = await createTempVault();

      await writeVaultFile(vaultRoot, "Guides/Start.md", "# Start\n");

      const previewPort = await getAvailablePort();
      const previewWsPort = await getAvailablePort();
      const runtime = createDefaultPublisherRuntime({
        builder: {
          previewPort,
          previewReadinessTimeoutMs: 60_000,
          previewWsPort
        }
      });

      try {
        const session = await runtime.orchestrator.preview(
          createConfig(vaultRoot, {
            publishMode: "folder",
            includeGlobs: ["**/*.md"]
          })
        );
        const response = await fetch(session.url);
        const html = await response.text();

        expect(response.ok).toBe(true);
        expect(html).toContain("generated automatically because the published slice does not contain a root");
      } finally {
        await runtime.stop();
      }
    },
    90_000
  );
});

function createConfig(vaultRoot: string, overrides: Partial<PublisherConfig> = {}): PublisherConfig {
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
    strictMode: false,
    ...overrides
  };
}

async function createTempVault(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "osp-core-"));

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a TCP port for preview testing.")));
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
