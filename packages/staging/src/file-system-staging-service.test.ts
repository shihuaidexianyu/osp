import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VaultManifestSchema } from "@osp/shared";
import type { PublisherConfig, VaultManifest } from "@osp/shared";
import { afterEach, describe, expect, it } from "vitest";

import { FileSystemStagingService } from "./file-system-staging-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true });
    })
  );
});

describe("FileSystemStagingService", () => {
  it("copies only published notes and their referenced assets into the staging workspace", async () => {
    const vaultRoot = await createTempDirectory("osp-staging-vault-");
    const stagingRoot = path.join(vaultRoot, ".osp", "staging");

    await writeVaultFile(vaultRoot, "Published.md", "---\npublish: true\n---\n![[assets/diagram.png]]\n");
    await writeVaultFile(vaultRoot, "Draft.md", "# Draft\n");
    await writeVaultFile(vaultRoot, "assets/diagram.png", "fake-png");
    await writeVaultFile(stagingRoot, "content/stale.md", "stale");

    const manifest = createManifest(vaultRoot, {
      notes: [
        createNote("Published.md", {
          publish: true,
          assets: [{ path: "assets/diagram.png", kind: "image" }]
        }),
        createNote("Draft.md")
      ],
      assetFiles: [{ path: "assets/diagram.png", kind: "image" }]
    });

    const workspace = await new FileSystemStagingService().prepare({
      config: createConfig(vaultRoot),
      manifest,
      mode: "build",
      stagingRoot
    });

    await expectFileToExist(path.join(workspace.contentDir, "Published.md"));
    await expectFileToExist(path.join(workspace.contentDir, "assets", "diagram.png"));
    await expectFileToBeMissing(path.join(workspace.contentDir, "Draft.md"));
    await expectFileToBeMissing(path.join(workspace.contentDir, "stale.md"));

    const stagedManifest = VaultManifestSchema.parse(
      JSON.parse(await readFile(workspace.manifestPath, "utf8")) as unknown
    );

    expect(stagedManifest.notes.map((note) => note.path)).toEqual(["Published.md", "index.md"]);
    expect(stagedManifest.assetFiles).toEqual([{ path: "assets/diagram.png", kind: "image" }]);
    expect(stagedManifest.unsupportedObjects).toEqual([]);
  });

  it("uses publishRoot when folder mode is active", async () => {
    const vaultRoot = await createTempDirectory("osp-staging-folder-vault-");
    const stagingRoot = path.join(vaultRoot, ".osp", "staging");

    await writeVaultFile(vaultRoot, "Public/Guide.md", "# Guide\n");
    await writeVaultFile(vaultRoot, "Private/Draft.md", "# Draft\n");

    const manifest = createManifest(vaultRoot, {
      notes: [createNote("Public/Guide.md"), createNote("Private/Draft.md")],
      assetFiles: []
    });

    const workspace = await new FileSystemStagingService().prepare({
      config: createConfig(vaultRoot, {
        publishMode: "folder",
        publishRoot: "Public"
      }),
      manifest,
      mode: "preview",
      stagingRoot
    });

    await expectFileToExist(path.join(workspace.contentDir, "Public", "Guide.md"));
    await expectFileToBeMissing(path.join(workspace.contentDir, "Private", "Draft.md"));
  });

  it("respects includeGlobs and excludeGlobs when selecting notes to stage", async () => {
    const vaultRoot = await createTempDirectory("osp-staging-glob-vault-");
    const stagingRoot = path.join(vaultRoot, ".osp", "staging");

    await writeVaultFile(vaultRoot, "Public/Keep.md", "# Keep\n");
    await writeVaultFile(vaultRoot, "Public/Drafts/Skip.md", "# Skip\n");
    await writeVaultFile(vaultRoot, "Private/Skip.md", "# Skip\n");

    const manifest = createManifest(vaultRoot, {
      notes: [
        createNote("Public/Keep.md"),
        createNote("Public/Drafts/Skip.md"),
        createNote("Private/Skip.md")
      ],
      assetFiles: []
    });

    const workspace = await new FileSystemStagingService().prepare({
      config: createConfig(vaultRoot, {
        publishMode: "folder",
        includeGlobs: ["Public/**/*.md"],
        excludeGlobs: ["**/Drafts/**"]
      }),
      manifest,
      mode: "build",
      stagingRoot
    });

    await expectFileToExist(path.join(workspace.contentDir, "Public", "Keep.md"));
    await expectFileToBeMissing(path.join(workspace.contentDir, "Public", "Drafts", "Skip.md"));
    await expectFileToBeMissing(path.join(workspace.contentDir, "Private", "Skip.md"));
  });

  it("copies assets resolved through attachment folders and sibling .assets directories", async () => {
    const vaultRoot = await createTempDirectory("osp-staging-assets-vault-");
    const stagingRoot = path.join(vaultRoot, ".osp", "staging");

    await writeVaultFile(vaultRoot, "Topic/Guide.md", "![[diagram.png]]\n");
    await writeVaultFile(vaultRoot, "Topic/assets/diagram.png", "fake-png");
    await writeVaultFile(vaultRoot, "Legacy/Guide.md", "![legacy](legacy.png)\n");
    await writeVaultFile(vaultRoot, "Legacy/Guide.assets/legacy.png", "legacy-png");

    const manifest = createManifest(vaultRoot, {
      vaultSettings: {
        attachmentFolderPath: "./assets"
      },
      notes: [
        createNote("Topic/Guide.md", {
          assets: [{ path: "diagram.png", kind: "image" }]
        }),
        createNote("Legacy/Guide.md", {
          assets: [{ path: "legacy.png", kind: "image" }]
        })
      ],
      assetFiles: [
        { path: "Topic/assets/diagram.png", kind: "image" },
        { path: "Legacy/Guide.assets/legacy.png", kind: "image" }
      ]
    });

    const workspace = await new FileSystemStagingService().prepare({
      config: createConfig(vaultRoot, {
        publishMode: "folder",
        includeGlobs: ["**/*.md"]
      }),
      manifest,
      mode: "build",
      stagingRoot
    });

    await expectFileToExist(path.join(workspace.contentDir, "Topic", "assets", "diagram.png"));
    await expectFileToExist(path.join(workspace.contentDir, "Legacy", "Guide.assets", "legacy.png"));
  });

  it("generates a landing page when the published slice has no root index note", async () => {
    const vaultRoot = await createTempDirectory("osp-staging-home-vault-");
    const stagingRoot = path.join(vaultRoot, ".osp", "staging");

    await writeVaultFile(vaultRoot, "Guides/Start.md", "# Start\n");
    await writeVaultFile(vaultRoot, "Guides/Deep Dive.md", "# Deep Dive\n");

    const manifest = createManifest(vaultRoot, {
      notes: [
        createNote("Guides/Start.md", {
          title: "Start Here",
          slug: "Guides/Start"
        }),
        createNote("Guides/Deep Dive.md", {
          title: "Deep Dive",
          slug: "Guides/Deep Dive"
        })
      ]
    });

    const workspace = await new FileSystemStagingService().prepare({
      config: createConfig(vaultRoot, {
        publishMode: "folder",
        includeGlobs: ["**/*.md"]
      }),
      manifest,
      mode: "build",
      stagingRoot
    });

    await expectFileToExist(path.join(workspace.contentDir, "index.md"));
    await expect(readFile(path.join(workspace.contentDir, "index.md"), "utf8")).resolves.toContain(
      "This landing page was generated automatically"
    );
    await expect(readFile(path.join(workspace.contentDir, "index.md"), "utf8")).resolves.toContain(
      "[[Guides/Start|Start Here]]"
    );

    const stagedManifest = VaultManifestSchema.parse(
      JSON.parse(await readFile(workspace.manifestPath, "utf8")) as unknown
    );

    expect(stagedManifest.notes.map((note) => note.path)).toEqual(["Guides/Start.md", "Guides/Deep Dive.md", "index.md"]);
  });

  it("normalizes Obsidian-authored math wrappers without disturbing following mermaid fences", async () => {
    const vaultRoot = await createTempDirectory("osp-staging-markdown-vault-");
    const stagingRoot = path.join(vaultRoot, ".osp", "staging");

    await writeVaultFile(
      vaultRoot,
      "Math.md",
      [
        "因为 70 落在刚才得到的 95% 置信区间 ($$",
        "69.94,78.06",
        "",
        "$$",
        ") 内，所以在 0.05 水平下不会拒绝零假设。",
        "",
        "$$",
        "",
        "d=0.33",
        "",
        "$$",
        "",
        "```mermaid",
        "flowchart TD",
        "  A --> B",
        "```",
        ""
      ].join("\n")
    );

    const manifest = createManifest(vaultRoot, {
      notes: [
        createNote("Math.md", {
          publish: true
        })
      ]
    });

    const workspace = await new FileSystemStagingService().prepare({
      config: createConfig(vaultRoot),
      manifest,
      mode: "build",
      stagingRoot
    });

    const stagedMarkdown = await readFile(path.join(workspace.contentDir, "Math.md"), "utf8");

    expect(stagedMarkdown).toContain("95% 置信区间 $69.94,78.06$ 内");
    expect(stagedMarkdown).toContain("$$\nd=0.33\n$$");
    expect(stagedMarkdown).toContain("```mermaid\nflowchart TD");
  });
});

function createConfig(
  vaultRoot: string,
  overrides: Partial<PublisherConfig> = {}
): PublisherConfig {
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

function createManifest(vaultRoot: string, overrides: Partial<VaultManifest>): VaultManifest {
  return {
    generatedAt: "2026-03-18T00:00:00.000Z",
    vaultRoot,
    notes: [],
    assetFiles: [],
    unsupportedObjects: [],
    ...overrides
  };
}

function createNote(
  notePath: string,
  overrides: Partial<VaultManifest["notes"][number]> = {}
): VaultManifest["notes"][number] {
  return {
    id: notePath,
    path: notePath,
    title: path.posix.basename(notePath, ".md"),
    slug: path.posix.basename(notePath, ".md").toLowerCase(),
    aliases: [],
    headings: [],
    blockIds: [],
    properties: {},
    links: [],
    embeds: [],
    assets: [],
    publish: false,
    ...overrides
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), prefix));

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await rm(absolutePath, { force: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function expectFileToExist(filePath: string): Promise<void> {
  await expect(access(filePath)).resolves.toBeUndefined();
}

async function expectFileToBeMissing(filePath: string): Promise<void> {
  await expect(access(filePath)).rejects.toThrow();
}
