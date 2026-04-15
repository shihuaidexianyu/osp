import { z } from "zod";

import {
  builderKinds,
  deployTargets,
  issueCodes,
  publishModes,
  severities,
  unsupportedObjectKinds
} from "./constants.js";

export const SourceLocationSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive()
});

export const HeadingRecordSchema = z.object({
  text: z.string(),
  slug: z.string(),
  depth: z.number().int().min(1).max(6)
});

export const LinkRefSchema = z.object({
  raw: z.string(),
  target: z.string(),
  kind: z.enum(["wikilink", "markdown", "heading", "block", "external"]),
  location: SourceLocationSchema.optional()
});

export const EmbedRefSchema = z.object({
  raw: z.string(),
  target: z.string(),
  kind: z.enum(["note", "asset"]),
  location: SourceLocationSchema.optional()
});

export const AssetRefSchema = z.object({
  path: z.string(),
  kind: z.enum(["image", "audio", "video", "pdf", "other"])
});

export const VaultSettingsSchema = z.object({
  attachmentFolderPath: z.string().optional()
});

export const UnsupportedObjectRecordSchema = z.object({
  kind: z.enum(unsupportedObjectKinds),
  path: z.string()
});

export const NoteRecordSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()),
  headings: z.array(HeadingRecordSchema),
  blockIds: z.array(z.string()),
  properties: z.record(z.unknown()),
  links: z.array(LinkRefSchema),
  embeds: z.array(EmbedRefSchema),
  assets: z.array(AssetRefSchema),
  publish: z.boolean(),
  frontmatterError: z.string().optional(),
  permalink: z.string().optional(),
  description: z.string().optional()
});

export const VaultManifestSchema = z.object({
  generatedAt: z.string(),
  vaultRoot: z.string(),
  vaultSettings: VaultSettingsSchema.optional(),
  notes: z.array(NoteRecordSchema),
  assetFiles: z.array(AssetRefSchema),
  unsupportedObjects: z.array(UnsupportedObjectRecordSchema)
});

export const BuildIssueSchema = z.object({
  code: z.enum(issueCodes),
  severity: z.enum(severities),
  file: z.string(),
  message: z.string(),
  location: SourceLocationSchema.optional(),
  suggestion: z.string().optional()
});

export const BuildLogEntrySchema = z.object({
  level: z.enum(["debug", "info", "warning", "error"]),
  message: z.string(),
  timestamp: z.string()
});

export const PublisherConfigSchema = z.object({
  vaultRoot: z.string(),
  publishMode: z.enum(publishModes),
  publishRoot: z.string().optional(),
  includeGlobs: z.array(z.string()),
  excludeGlobs: z.array(z.string()),
  outputDir: z.string(),
  builder: z.enum(builderKinds),
  deployTarget: z.enum(deployTargets),
  deployOutputDir: z.string().optional(),
  deployBranch: z.string().optional(),
  deployCommitMessage: z.string().optional(),
  deployRepositoryUrl: z.string().optional(),
  enableSearch: z.boolean(),
  enableBacklinks: z.boolean(),
  enableGraph: z.boolean(),
  strictMode: z.boolean(),
  siteBaseUrl: z.string().optional(),
  locale: z.string().optional(),
  ignorePatterns: z.array(z.string()).optional(),
  defaultDateType: z.enum(["created", "modified", "published"]).optional(),
  enableExplorer: z.boolean().optional(),
  enableTableOfContents: z.boolean().optional(),
  enableRecentNotes: z.boolean().optional(),
  enableDarkmode: z.boolean().optional(),
  enableReaderMode: z.boolean().optional(),
  enableOgImages: z.boolean().optional(),
  faviconPath: z.string().optional(),
  footerLinks: z.record(z.string()).optional()
});

export const PreparedWorkspaceSchema = z.object({
  mode: z.enum(["build", "preview"]),
  rootDir: z.string(),
  contentDir: z.string(),
  outputDir: z.string(),
  manifestPath: z.string()
});

export const BuildResultSchema = z.object({
  success: z.boolean(),
  outputDir: z.string().optional(),
  manifestPath: z.string(),
  issues: z.array(BuildIssueSchema),
  logs: z.array(BuildLogEntrySchema),
  durationMs: z.number().nonnegative()
});

export const PreviewSessionSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    url: z.string().url(),
    workspaceRoot: z.string(),
    startedAt: z.string()
  }),
  z.object({
    success: z.literal(false),
    issues: z.array(BuildIssueSchema),
    message: z.string()
  })
]);

export const DeployResultSchema = z.object({
  success: z.boolean(),
  target: z.enum(deployTargets),
  destination: z.string().optional(),
  message: z.string()
});
