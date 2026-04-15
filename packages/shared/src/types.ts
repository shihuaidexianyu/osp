export type Severity = "info" | "warning" | "error";

export type PublishMode = "folder" | "frontmatter";

export type BuilderKind = "quartz";

export type DeployTarget = "none" | "local-export" | "git-branch" | "github-pages";

export type IssueCode =
  | "BROKEN_LINK"
  | "MISSING_ASSET"
  | "EMPTY_PUBLISH_SLICE"
  | "UNSUPPORTED_CANVAS"
  | "UNSUPPORTED_BASE"
  | "DUPLICATE_SLUG"
  | "DUPLICATE_PERMALINK"
  | "CIRCULAR_EMBED"
  | "INVALID_FRONTMATTER"
  | "UNPUBLISHED_REFERENCE";

export type UnsupportedObjectKind = "canvas" | "base";

export type SourceLocation = {
  line: number;
  column: number;
};

export type HeadingRecord = {
  text: string;
  slug: string;
  depth: number;
};

export type LinkRef = {
  raw: string;
  target: string;
  kind: "wikilink" | "markdown" | "heading" | "block" | "external";
  location?: SourceLocation;
};

export type EmbedRef = {
  raw: string;
  target: string;
  kind: "note" | "asset";
  location?: SourceLocation;
};

export type AssetRef = {
  path: string;
  kind: "image" | "audio" | "video" | "pdf" | "other";
};

export type VaultSettings = {
  attachmentFolderPath?: string;
};

export type UnsupportedObjectRecord = {
  kind: UnsupportedObjectKind;
  path: string;
};

export type NoteRecord = {
  id: string;
  path: string;
  title: string;
  slug: string;
  aliases: string[];
  headings: HeadingRecord[];
  blockIds: string[];
  properties: Record<string, unknown>;
  links: LinkRef[];
  embeds: EmbedRef[];
  assets: AssetRef[];
  publish: boolean;
  frontmatterError?: string;
  permalink?: string;
  description?: string;
};

export type VaultManifest = {
  generatedAt: string;
  vaultRoot: string;
  vaultSettings?: VaultSettings;
  notes: NoteRecord[];
  assetFiles: AssetRef[];
  unsupportedObjects: UnsupportedObjectRecord[];
};

export type BuildIssue = {
  code: IssueCode;
  severity: Severity;
  file: string;
  message: string;
  location?: SourceLocation;
  suggestion?: string;
};

export type BuildLogEntry = {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  timestamp: string;
};

export type PublisherConfig = {
  vaultRoot: string;
  publishMode: PublishMode;
  publishRoot?: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  outputDir: string;
  builder: BuilderKind;
  deployTarget: DeployTarget;
  deployOutputDir?: string;
  deployBranch?: string;
  deployCommitMessage?: string;
  deployRepositoryUrl?: string;
  enableSearch: boolean;
  enableBacklinks: boolean;
  enableGraph: boolean;
  strictMode: boolean;
  siteBaseUrl?: string;
  locale?: string;
  ignorePatterns?: string[];
  defaultDateType?: "created" | "modified" | "published";
  enableExplorer?: boolean;
  enableTableOfContents?: boolean;
  enableRecentNotes?: boolean;
  enableDarkmode?: boolean;
  enableReaderMode?: boolean;
  enableOgImages?: boolean;
  faviconPath?: string;
  footerLinks?: Record<string, string>;
};

export type PreparedWorkspace = {
  mode: "build" | "preview";
  rootDir: string;
  contentDir: string;
  outputDir: string;
  manifestPath: string;
};

export type BuildResult = {
  success: boolean;
  outputDir?: string;
  manifestPath: string;
  issues: BuildIssue[];
  logs: BuildLogEntry[];
  durationMs: number;
};

export type PreviewSession =
  | {
      success: true;
      url: string;
      workspaceRoot: string;
      startedAt: string;
    }
  | {
      success: false;
      issues: BuildIssue[];
      message: string;
    };

export type DeployResult = {
  success: boolean;
  target: DeployTarget;
  destination?: string;
  message: string;
};

export type PublisherError = Error & {
  code: string;
  message: string;
  cause?: unknown;
  hint?: string;
};
