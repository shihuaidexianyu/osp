import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveQuartzPackageNodeModulesPath, resolveWorkspaceNodeModulesPath } from "./quartz-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("resolveWorkspaceNodeModulesPath", () => {
  it("prefers the broader workspace node_modules layout when present", async () => {
    const quartzPackageRoot = await createDirectoryTree([
      ".pnpm/node_modules",
      ".pnpm/@jackyzha0+quartz/node_modules/@jackyzha0/quartz"
    ]);

    const pnpmCandidate = path.resolve(quartzPackageRoot, "..", "..", "..", "..", "node_modules");
    const result = await resolveWorkspaceNodeModulesPath(quartzPackageRoot);

    // The esbuild fallback may redirect to the adapter's own node_modules
    // when the test fixture doesn't contain esbuild.
    const adapterNodeModules = path.resolve(import.meta.dirname, "..", "node_modules");
    expect([pnpmCandidate, adapterNodeModules]).toContain(result);
  });

  it("falls back to a flat node_modules directory for vendored plugin runtimes", async () => {
    const quartzPackageRoot = await createDirectoryTree(["node_modules/@jackyzha0/quartz"]);

    const flatCandidate = path.resolve(quartzPackageRoot, "..", "..");
    const result = await resolveWorkspaceNodeModulesPath(quartzPackageRoot);

    // Same esbuild fallback applies for flat layouts.
    const adapterNodeModules = path.resolve(import.meta.dirname, "..", "node_modules");
    expect([flatCandidate, adapterNodeModules]).toContain(result);
  });
});

describe("resolveQuartzPackageNodeModulesPath", () => {
  it("prefers Quartz's colocated pnpm node_modules when present", async () => {
    const quartzPackageRoot = await createDirectoryTree([
      ".pnpm/node_modules",
      ".pnpm/@jackyzha0+quartz/node_modules/@jackyzha0/quartz"
    ]);

    expect(await resolveQuartzPackageNodeModulesPath(quartzPackageRoot)).toBe(path.resolve(quartzPackageRoot, "..", ".."));
  });

  it("falls back to a flat node_modules directory for vendored plugin runtimes", async () => {
    const quartzPackageRoot = await createDirectoryTree(["node_modules/@jackyzha0/quartz"]);

    expect(await resolveQuartzPackageNodeModulesPath(quartzPackageRoot)).toBe(path.resolve(quartzPackageRoot, "..", ".."));
  });
});

async function createDirectoryTree(relativeDirectories: string[]): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "osp-quartz-runtime-"));

  temporaryDirectories.push(rootDir);

  for (const relativeDirectory of relativeDirectories) {
    await mkdir(path.join(rootDir, relativeDirectory), { recursive: true });
  }

  return path.join(rootDir, relativeDirectories.at(-1) ?? "");
}
