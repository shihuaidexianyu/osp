import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BuildResult, PublisherConfig } from "@osp/shared";
import { afterEach, describe, expect, it } from "vitest";

import { GitBranchDeployAdapter } from "./git-branch-deploy-adapter.js";
import { runGit } from "./git-client.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("GitBranchDeployAdapter", { timeout: 30000 }, () => {
  it(
    "creates or updates a dedicated deploy branch with the built site",
    async () => {
      const repoRoot = await createTempDirectory();
      const buildOutputDir = path.join(repoRoot, ".osp-build-dist");

      await initializeRepository(repoRoot);
      await mkdir(buildOutputDir, { recursive: true });
      await writeFile(path.join(buildOutputDir, "index.html"), "<html>branch deploy</html>", "utf8");

      const adapter = new GitBranchDeployAdapter();
      const result = await adapter.deploy(
        createBuildResult(buildOutputDir),
        createConfig(repoRoot, {
          deployBranch: "site",
          deployCommitMessage: "Deploy test site"
        })
      );

      expect(result).toEqual({
        success: true,
        target: "git-branch",
        destination: "refs/heads/site",
        message: "Git branch deploy completed successfully to site."
      });
      await expect(readGitFile(repoRoot, "site", "index.html")).resolves.toBe("<html>branch deploy</html>");
    },
    20_000
  );

  it("returns a structured failure when targeting the currently checked out branch", async () => {
    const repoRoot = await createTempDirectory();
    const buildOutputDir = path.join(repoRoot, ".osp-build-dist");

    await initializeRepository(repoRoot);
    await mkdir(buildOutputDir, { recursive: true });
    await writeFile(path.join(buildOutputDir, "index.html"), "<html>branch deploy</html>", "utf8");

    const adapter = new GitBranchDeployAdapter();
    const result = await adapter.deploy(
      createBuildResult(buildOutputDir),
      createConfig(repoRoot, {
        deployBranch: "main"
      })
    );

    expect(result).toEqual({
      success: false,
      target: "git-branch",
      message: "Refusing to deploy to the currently checked out branch main. Choose a dedicated deploy branch."
    });
  });
});

function createBuildResult(outputDir: string): BuildResult {
  return {
    success: true,
    outputDir,
    manifestPath: path.join(outputDir, "..", "manifest.json"),
    issues: [],
    logs: [],
    durationMs: 1
  };
}

function createConfig(vaultRoot: string, overrides: Partial<PublisherConfig> = {}): PublisherConfig {
  return {
    vaultRoot,
    publishMode: "frontmatter",
    includeGlobs: [],
    excludeGlobs: [],
    outputDir: path.join(vaultRoot, ".osp", "dist"),
    builder: "quartz",
    deployTarget: "git-branch",
    enableSearch: true,
    enableBacklinks: true,
    enableGraph: true,
    strictMode: false,
    ...overrides
  };
}

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "osp-git-branch-"));

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function initializeRepository(repoRoot: string): Promise<void> {
  await runGit(["init"], repoRoot);
  await runGit(["config", "user.name", "OSP Test"], repoRoot);
  await runGit(["config", "user.email", "osp@example.com"], repoRoot);
  await writeFile(path.join(repoRoot, "README.md"), "# temp repo\n", "utf8");
  await runGit(["add", "README.md"], repoRoot);
  await runGit(["commit", "-m", "Initial commit"], repoRoot);
  await runGit(["branch", "-M", "main"], repoRoot);
}

async function readGitFile(repoRoot: string, branch: string, filePath: string): Promise<string> {
  const result = await runGit(["show", `${branch}:${filePath}`], repoRoot);

  return result.stdout;
}
