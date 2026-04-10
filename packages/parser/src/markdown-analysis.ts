import type { AssetRef, EmbedRef, HeadingRecord, LinkRef, NoteRecord } from "@osp/shared";

import { stripLeadingFrontmatter } from "./frontmatter.js";
import { slugify } from "./slug.js";

type MarkdownAnalysis = Pick<NoteRecord, "assets" | "blockIds" | "embeds" | "headings" | "links">;

function createWikilinkPattern(): RegExp {
  return /(!)?\[\[([^[\]]+?)\]\]/g;
}

function createMarkdownLinkPattern(): RegExp {
  return /(!)?\[[^\]]*?\]\(([^)]+)\)/g;
}
const codeFencePattern = /^\s*(?:>+\s*)?(?:(?:[-+*]|\d+\.)\s+)?(`{3,}|~{3,})/;
const headingPattern = /^(#{1,6})[ \t]+(.+?)\s*$/;
const trailingHeadingMarkerPattern = /\s+#+\s*$/;
const blockIdPattern = /\^([A-Za-z0-9-]+)\s*$/;
const externalTargetPattern = /^[a-z][a-z0-9+.-]*:/i;

const knownBareAssetExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif",
  ".mp3", ".wav", ".ogg", ".m4a", ".flac",
  ".mp4", ".webm", ".mov", ".avi", ".mkv",
  ".pdf", ".csv", ".tsv", ".json", ".txt", ".zip", ".gz", ".tar",
  ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".ipynb"
]);

export function analyzeMarkdownContent(markdownSource: string): MarkdownAnalysis {
  const content = stripLeadingFrontmatter(markdownSource);
  const headings: HeadingRecord[] = [];
  const blockIds: string[] = [];
  const links: LinkRef[] = [];
  const embeds: EmbedRef[] = [];
  const assets: AssetRef[] = [];
  const seenAssetPaths = new Set<string>();
  const seenBlockIds = new Set<string>();
  let activeFenceMarker: string | undefined;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const fenceMarker = readFenceMarker(line);

    if (fenceMarker !== undefined) {
      if (activeFenceMarker === undefined) {
        activeFenceMarker = fenceMarker;
        continue;
      }

      if (isFenceClosedBy(activeFenceMarker, fenceMarker)) {
        activeFenceMarker = undefined;
        continue;
      }
    }

    if (activeFenceMarker !== undefined) {
      continue;
    }

    const heading = extractHeading(line);

    if (heading !== undefined) {
      headings.push(heading);
    }

    const blockId = extractBlockId(line);

    if (blockId !== undefined && !seenBlockIds.has(blockId)) {
      seenBlockIds.add(blockId);
      blockIds.push(blockId);
    }

    collectWikilinks(line, lineNumber, links, embeds, assets, seenAssetPaths);
    collectMarkdownLinks(line, lineNumber, links, embeds, assets, seenAssetPaths);
  }

  return {
    headings,
    blockIds,
    links,
    embeds,
    assets
  };
}

function readFenceMarker(line: string): string | undefined {
  return line.match(codeFencePattern)?.[1];
}

function isFenceClosedBy(activeFenceMarker: string, candidateFenceMarker: string): boolean {
  return candidateFenceMarker[0] === activeFenceMarker[0] && candidateFenceMarker.length >= activeFenceMarker.length;
}

function extractHeading(line: string): HeadingRecord | undefined {
  const match = line.match(headingPattern);

  if (match === null) {
    return undefined;
  }

  const depthMarker = match[1];
  const rawText = match[2];

  if (depthMarker === undefined || rawText === undefined) {
    return undefined;
  }

  const depth = depthMarker.length;
  const text = rawText.replace(trailingHeadingMarkerPattern, "").trim();

  if (text === "") {
    return undefined;
  }

  return {
    text,
    slug: slugify(text),
    depth
  };
}

function extractBlockId(line: string): string | undefined {
  const match = line.match(blockIdPattern);

  return match?.[1];
}

function collectWikilinks(
  line: string,
  lineNumber: number,
  links: LinkRef[],
  embeds: EmbedRef[],
  assets: AssetRef[],
  seenAssetPaths: Set<string>
): void {
  const wikilinkPattern = createWikilinkPattern();

  for (const match of line.matchAll(wikilinkPattern)) {
    const isEmbed = match[1] === "!";
    const matchedTarget = match[2];

    if (matchedTarget === undefined) {
      continue;
    }

    const rawTarget = matchedTarget.split("|")[0]?.trim() ?? "";

    if (rawTarget === "") {
      continue;
    }

    const normalizedTarget = normalizeInternalTarget(rawTarget);
    const location = createLocation(lineNumber, match.index ?? 0);

    if (isEmbed) {
      embeds.push({
        raw: match[0],
        target: normalizedTarget,
        kind: inferEmbedKind(normalizedTarget),
        location
      });
    } else {
      links.push({
        raw: match[0],
        target: normalizedTarget,
        kind: inferLinkKind(normalizedTarget, "wikilink"),
        location
      });
    }

    maybeCollectAsset(normalizedTarget, assets, seenAssetPaths);
  }
}

function collectMarkdownLinks(
  line: string,
  lineNumber: number,
  links: LinkRef[],
  embeds: EmbedRef[],
  assets: AssetRef[],
  seenAssetPaths: Set<string>
): void {
  const markdownLinkPattern = createMarkdownLinkPattern();

  for (const match of line.matchAll(markdownLinkPattern)) {
    const isEmbed = match[1] === "!";
    const matchedTarget = match[2];

    if (matchedTarget === undefined) {
      continue;
    }

    const extractedTarget = extractMarkdownTarget(matchedTarget);

    if (extractedTarget === undefined) {
      continue;
    }

    const normalizedTarget = normalizeMarkdownTarget(extractedTarget);
    const location = createLocation(lineNumber, match.index ?? 0);

    if (isEmbed) {
      embeds.push({
        raw: match[0],
        target: normalizedTarget,
        kind: inferEmbedKind(normalizedTarget),
        location
      });
    } else {
      links.push({
        raw: match[0],
        target: normalizedTarget,
        kind: inferLinkKind(normalizedTarget, "markdown"),
        location
      });
    }

    maybeCollectAsset(normalizedTarget, assets, seenAssetPaths);
  }
}

function createLocation(line: number, zeroBasedColumn: number): { line: number; column: number } {
  return {
    line,
    column: zeroBasedColumn + 1
  };
}

function inferLinkKind(target: string, defaultKind: "markdown" | "wikilink"): LinkRef["kind"] {
  if (externalTargetPattern.test(target)) {
    return "external";
  }

  if (target.includes("#^")) {
    return "block";
  }

  if (target.includes("#")) {
    return "heading";
  }

  return defaultKind;
}

function inferEmbedKind(target: string): EmbedRef["kind"] {
  return isAssetTarget(target) ? "asset" : "note";
}

function maybeCollectAsset(target: string, assets: AssetRef[], seenAssetPaths: Set<string>): void {
  if (!isAssetTarget(target)) {
    return;
  }

  const assetPath = stripAnchor(target);

  if (assetPath === "" || seenAssetPaths.has(assetPath)) {
    return;
  }

  seenAssetPaths.add(assetPath);
  assets.push({
    path: assetPath,
    kind: inferAssetKind(assetPath)
  });
}

function extractMarkdownTarget(rawTarget: string): string | undefined {
  const trimmedTarget = rawTarget.trim();

  if (trimmedTarget === "") {
    return undefined;
  }

  if (trimmedTarget.startsWith("<")) {
    const closingIndex = trimmedTarget.indexOf(">");

    if (closingIndex > 1) {
      return trimmedTarget.slice(1, closingIndex);
    }
  }

  const whitespaceIndex = trimmedTarget.search(/\s/);

  if (whitespaceIndex === -1) {
    return trimmedTarget;
  }

  return trimmedTarget.slice(0, whitespaceIndex);
}

function normalizeMarkdownTarget(target: string): string {
  if (externalTargetPattern.test(target)) {
    return target;
  }

  return normalizeInternalTarget(safelyDecodeTarget(target));
}

function normalizeInternalTarget(target: string): string {
  return target.replace(/\\/g, "/");
}

function safelyDecodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function isAssetTarget(target: string): boolean {
  if (externalTargetPattern.test(target)) {
    return false;
  }

  const assetPath = stripAnchor(target);
  const extension = getTargetExtension(target);

  if (extension === "" || extension === ".md") {
    return false;
  }

  return knownBareAssetExtensions.has(extension);
}

export function inferAssetKind(target: string): AssetRef["kind"] {
  const extension = getTargetExtension(target);

  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"].includes(extension)) {
    return "image";
  }

  if ([".mp3", ".wav", ".ogg", ".m4a", ".flac"].includes(extension)) {
    return "audio";
  }

  if ([".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(extension)) {
    return "video";
  }

  if (extension === ".pdf") {
    return "pdf";
  }

  return "other";
}

function getTargetExtension(target: string): string {
  const assetPath = stripAnchor(target);
  const lastDotIndex = assetPath.lastIndexOf(".");
  const lastSlashIndex = assetPath.lastIndexOf("/");

  if (lastDotIndex === -1 || lastDotIndex < lastSlashIndex) {
    return "";
  }

  return assetPath.slice(lastDotIndex).toLowerCase();
}

function stripAnchor(target: string): string {
  const anchorIndex = target.indexOf("#");

  if (anchorIndex === -1) {
    return target;
  }

  return target.slice(0, anchorIndex);
}
