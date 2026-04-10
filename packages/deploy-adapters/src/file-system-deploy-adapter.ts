import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { BuildResult, DeployResult, PublisherConfig } from "@osp/shared";

import type { DeployAdapter } from "./contracts.js";

export class FileSystemDeployAdapter implements DeployAdapter {
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
        message: "Build output directory is missing, so local export cannot proceed."
      };
    }

    const destination = resolveDeployDestination(config);
    const stagingDestination = `${destination}.deploy-staging`;

    await rm(stagingDestination, { recursive: true, force: true });
    await mkdir(path.dirname(stagingDestination), { recursive: true });
    await cp(build.outputDir, stagingDestination, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(stagingDestination, destination);

    return {
      success: true,
      target: config.deployTarget,
      destination,
      message: "Local export completed successfully."
    };
  }
}

function resolveDeployDestination(config: PublisherConfig): string {
  if (config.deployOutputDir !== undefined) {
    return config.deployOutputDir;
  }

  return path.join(config.vaultRoot, ".osp", "export");
}
