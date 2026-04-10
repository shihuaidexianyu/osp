import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { findMatchingAsset, normalizeVaultPath, selectPublishedNotes } from "@osp/shared";
import type { AssetRef, NoteRecord, PreparedWorkspace, VaultManifest } from "@osp/shared";

import type { PrepareStagingInput, StagingService } from "./contracts.js";
import { normalizeStagedMarkdown } from "./markdown-normalization.js";

export class FileSystemStagingService implements StagingService {
  public async prepare(input: PrepareStagingInput): Promise<PreparedWorkspace> {
    const rootDir = input.stagingRoot ?? path.join(input.config.vaultRoot, ".osp", input.mode);

    if (input.stagingRoot !== undefined && !isPathWithin(input.stagingRoot, input.config.vaultRoot)) {
      throw new Error("Staging root must be within the vault directory.");
    }

    const contentDir = path.join(rootDir, "content");
    const outputDir = path.join(rootDir, "dist");
    const manifestPath = path.join(rootDir, "manifest.json");
    const publishedNotes = selectPublishedNotes(input.manifest, input.config);
    const referencedAssets = collectReferencedAssets(input.manifest, publishedNotes, input.manifest.assetFiles);
    const generatedHomePage = createGeneratedHomePage(input.config.vaultRoot, publishedNotes);
    const stagedManifest = createStagedManifest(input.manifest, publishedNotes, referencedAssets, generatedHomePage?.note);

    await safeRemoveDirectory(rootDir);
    await mkdir(contentDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await copyVaultNotes(input.config.vaultRoot, contentDir, publishedNotes.map((note) => note.path));
    await copyVaultFiles(input.config.vaultRoot, contentDir, referencedAssets.map((asset) => asset.path));
    await writeGeneratedHomePage(contentDir, generatedHomePage);
    await writeFile(manifestPath, JSON.stringify(stagedManifest, null, 2), "utf8");

    return {
      mode: input.mode,
      rootDir,
      contentDir,
      outputDir,
      manifestPath
    };
  }
}

function collectReferencedAssets(manifest: VaultManifest, notes: NoteRecord[], availableAssets: AssetRef[]): AssetRef[] {
  const availableAssetsByPath = new Map(availableAssets.map((asset) => [normalizeVaultPath(asset.path), asset] as const));
  const selectedAssets: AssetRef[] = [];
  const seenPaths = new Set<string>();

  for (const note of notes) {
    for (const asset of note.assets) {
      const matchedAsset = findMatchingAsset(availableAssetsByPath, note.path, asset.path, manifest.vaultSettings);

      if (matchedAsset === undefined || seenPaths.has(matchedAsset.path)) {
        continue;
      }

      seenPaths.add(matchedAsset.path);
      selectedAssets.push(matchedAsset);
    }
  }

  return selectedAssets;
}

function createStagedManifest(
  manifest: VaultManifest,
  notes: NoteRecord[],
  assetFiles: AssetRef[],
  generatedHomePageNote?: NoteRecord
): VaultManifest {
  return {
    ...manifest,
    notes: generatedHomePageNote === undefined ? notes : [...notes, generatedHomePageNote],
    assetFiles,
    unsupportedObjects: []
  };
}

function createGeneratedHomePage(vaultRoot: string, notes: NoteRecord[]): { note: NoteRecord; content: string } | undefined {
  if (notes.some((note) => normalizeVaultPath(note.path) === "index.md")) {
    return undefined;
  }

  const pageTitle = path.basename(vaultRoot) || "Published Vault";
  const noteLinks = notes
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 24)
    .map((note) => `- [[${note.slug}|${note.title}]]`)
    .join("\n");
  const remainingCount = Math.max(notes.length - 24, 0);
  const sections = [
    "---",
    `title: ${pageTitle}`,
    "---",
    "",
    `# ${pageTitle}`,
    "",
    "This landing page was generated automatically because the published slice does not contain a root `index.md`.",
    ""
  ];

  if (noteLinks !== "") {
    sections.push("## Published Notes", "", noteLinks, "");
  }

  if (remainingCount > 0) {
    sections.push(`And ${remainingCount} more published notes are available through tags, search, and folder navigation.`, "");
  }

  sections.push("- [Browse tags](/tags/)");

  return {
    note: {
      id: "__generated__/index.md",
      path: "index.md",
      title: pageTitle,
      slug: "index",
      aliases: [],
      headings: [],
      blockIds: [],
      properties: {
        generated: true
      },
      links: [],
      embeds: [],
      assets: [],
      publish: true,
      description: "Generated landing page for a published slice without a root index note."
    },
    content: `${sections.join("\n")}\n`
  };
}

async function writeGeneratedHomePage(
  contentDir: string,
  generatedHomePage: { note: NoteRecord; content: string } | undefined
): Promise<void> {
  if (generatedHomePage === undefined) {
    return;
  }

  await writeFile(path.join(contentDir, generatedHomePage.note.path), generatedHomePage.content, "utf8");
}

async function copyVaultNotes(vaultRoot: string, targetRoot: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    validateRelativePath(relativePath);
    const sourcePath = path.join(vaultRoot, relativePath);
    const destinationPath = path.join(targetRoot, relativePath);
    const markdownSource = await readFile(sourcePath, "utf8");

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, normalizeStagedMarkdown(markdownSource), "utf8");
  }
}

async function copyVaultFiles(vaultRoot: string, targetRoot: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    validateRelativePath(relativePath);
    const sourcePath = path.join(vaultRoot, relativePath);
    const destinationPath = path.join(targetRoot, relativePath);

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

function validateRelativePath(relativePath: string): void {
  const normalized = path.normalize(relativePath);

  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Relative path escapes its base directory: ${relativePath}`);
  }
}

function isPathWithin(candidatePath: string, parentPath: string): boolean {
  const resolved = path.resolve(candidatePath);
  const parent = path.resolve(parentPath);

  return resolved.startsWith(parent + path.sep) || resolved === parent;
}

async function safeRemoveDirectory(dirPath: string): Promise<void> {
  const resolved = path.resolve(dirPath);

  await rm(resolved, { recursive: true, force: true });
}
