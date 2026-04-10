import { cp, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BuildResult, DeployResult, PublisherConfig } from "@osp/shared";

import type { DeployAdapter } from "./contracts.js";
import { runGit } from "./git-client.js";

const defaultDeployBranch = "gh-pages";
const defaultDeployCommitMessage = "Deploy static site from Obsidian Site Publisher";

export class GitBranchDeployAdapter implements DeployAdapter {
  public async deploy(build: BuildResult, config: PublisherConfig): Promise<DeployResult> {
    if (!build.success) {
      return {
        success: false,
        target: config.deployTarget,
        message: "Build must succeed before deploy can proceed."
      };
    }

    if (build.outputDir === undefined) {
      return {
        success: false,
        target: config.deployTarget,
        message: "Build output directory is missing, so git branch deploy cannot proceed."
      };
    }

    const deployBranch = config.deployBranch ?? defaultDeployBranch;

    try {
      const remoteUrl = await resolveDeployRemoteUrl(config);
      const temporaryRepository = await mkdtemp(path.join(os.tmpdir(), "osp-git-deploy-"));

      try {
        await initializeTemporaryRepository(temporaryRepository, remoteUrl);
        await configureCommitIdentity(temporaryRepository, config.vaultRoot);
        const branchExists = await doesRemoteBranchExist(temporaryRepository, deployBranch);
        await checkoutDeployBranch(temporaryRepository, deployBranch, branchExists);
        await emptyDirectoryExceptGit(temporaryRepository);
        await copyDirectoryContents(build.outputDir, temporaryRepository);
        await runGit(["add", "--all"], temporaryRepository);

        if (!(await hasGitChanges(temporaryRepository))) {
          return {
            success: true,
            target: config.deployTarget,
            destination: `refs/heads/${deployBranch}`,
            message: `Git branch ${deployBranch} already matches the current build output.`
          };
        }

        await runGit(["commit", "-m", config.deployCommitMessage ?? defaultDeployCommitMessage], temporaryRepository);
        await runGit(["push", "origin", `HEAD:refs/heads/${deployBranch}`], temporaryRepository);

        return {
          success: true,
          target: config.deployTarget,
          destination: `refs/heads/${deployBranch}`,
          message: `Git branch deploy completed successfully to ${deployBranch}.`
        };
      } finally {
        await rm(temporaryRepository, { recursive: true, force: true });
      }
    } catch (error) {
      return {
        success: false,
        target: config.deployTarget,
        message: formatGitDeployError(error)
      };
    }
  }
}

async function resolveRepositoryRoot(vaultRoot: string): Promise<string> {
  const result = await runGit(["rev-parse", "--show-toplevel"], vaultRoot);

  return result.stdout;
}

async function resolveDeployRemoteUrl(config: PublisherConfig): Promise<string> {
  if (config.deployRepositoryUrl !== undefined) {
    return config.deployRepositoryUrl;
  }

  const repoRoot = await resolveRepositoryRoot(config.vaultRoot);
  const currentBranch = await resolveCurrentBranch(repoRoot);
  const deployBranch = config.deployBranch ?? defaultDeployBranch;

  if (currentBranch === deployBranch) {
    throw new Error(`Refusing to deploy to the currently checked out branch ${deployBranch}. Choose a dedicated deploy branch.`);
  }

  return repoRoot;
}

async function resolveCurrentBranch(repoRoot: string): Promise<string | undefined> {
  const result = await runGit(["branch", "--show-current"], repoRoot);

  return result.stdout === "" ? undefined : result.stdout;
}

async function initializeTemporaryRepository(temporaryRepository: string, remoteUrl: string): Promise<void> {
  await runGit(["init"], temporaryRepository);
  await runGit(["remote", "add", "origin", remoteUrl], temporaryRepository);
}

async function configureCommitIdentity(temporaryRepository: string, vaultRoot: string): Promise<void> {
  const repositoryRoot = await resolveRepositoryRoot(vaultRoot).catch(() => undefined);
  const userName = repositoryRoot === undefined ? undefined : await readGitConfig(repositoryRoot, "user.name");
  const userEmail = repositoryRoot === undefined ? undefined : await readGitConfig(repositoryRoot, "user.email");

  if (userName !== undefined) {
    await runGit(["config", "user.name", userName], temporaryRepository);
  }

  if (userEmail !== undefined) {
    await runGit(["config", "user.email", userEmail], temporaryRepository);
  }
}

async function readGitConfig(repositoryRoot: string, key: string): Promise<string | undefined> {
  try {
    const result = await runGit(["config", "--get", key], repositoryRoot);

    return result.stdout === "" ? undefined : result.stdout;
  } catch {
    return undefined;
  }
}

async function doesRemoteBranchExist(temporaryRepository: string, deployBranch: string): Promise<boolean> {
  const result = await runGit(["ls-remote", "--heads", "origin", deployBranch], temporaryRepository);

  return result.stdout !== "";
}

async function checkoutDeployBranch(
  temporaryRepository: string,
  deployBranch: string,
  branchExists: boolean
): Promise<void> {
  if (branchExists) {
    await runGit(["fetch", "origin", deployBranch], temporaryRepository);
    await runGit(["checkout", "-B", deployBranch, `refs/remotes/origin/${deployBranch}`], temporaryRepository);
    return;
  }

  await runGit(["checkout", "--orphan", deployBranch], temporaryRepository);
}

async function emptyDirectoryExceptGit(directoryPath: string): Promise<void> {
  const entries = await readdir(directoryPath, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (entry.name !== ".git") {
      await rm(path.join(directoryPath, entry.name), { recursive: true, force: true });
    }
  }
}

async function copyDirectoryContents(sourceDir: string, destinationDir: string): Promise<void> {
  const entries = await readdir(sourceDir, {
    withFileTypes: true
  });

  await mkdir(destinationDir, { recursive: true });
  await Promise.all(
    entries.map(async (entry) => {
      await cp(path.join(sourceDir, entry.name), path.join(destinationDir, entry.name), {
        recursive: true
      });
    })
  );
}

async function hasGitChanges(temporaryRepository: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], temporaryRepository);

  return result.stdout !== "";
}

function formatGitDeployError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.startsWith("Refusing to deploy")) {
      return error.message;
    }

    return `Git branch deploy failed: ${error.message}`;
  }

  return `Git branch deploy failed: ${String(error)}`;
}
