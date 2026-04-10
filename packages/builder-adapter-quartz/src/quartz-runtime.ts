import { access, cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PreparedWorkspace, PublisherConfig } from "@osp/shared";

const runtimeFiles = ["globals.d.ts", "index.d.ts", "package.json", "tsconfig.json"] as const;

export async function ensureQuartzWorkspaceRuntime(
  workspace: PreparedWorkspace,
  config: PublisherConfig,
  quartzPackageRoot: string
): Promise<void> {
  const workspaceNodeModulesPath = await resolveWorkspaceNodeModulesPath(quartzPackageRoot);
  const quartzPackageNodeModulesPath = await resolveQuartzPackageNodeModulesPath(quartzPackageRoot);

  await mkdir(workspace.rootDir, { recursive: true });
  await ensureQuartzWorkspaceGitBoundary(workspace.rootDir);
  await cp(path.join(quartzPackageRoot, "quartz"), path.join(workspace.rootDir, "quartz"), {
    force: true,
    recursive: true
  });

  for (const runtimeFile of runtimeFiles) {
    await cp(path.join(quartzPackageRoot, runtimeFile), path.join(workspace.rootDir, runtimeFile), {
      force: true
    });
  }

  await ensureNodeModulesLink(workspace.rootDir, workspaceNodeModulesPath);
  await ensureQuartzPackageNodeModulesLink(workspace.rootDir, quartzPackageNodeModulesPath);
  await writeFile(path.join(workspace.rootDir, "quartz.config.ts"), renderQuartzConfig(config), "utf8");
  await writeFile(path.join(workspace.rootDir, "quartz.layout.ts"), renderQuartzLayout(config), "utf8");
}

async function ensureQuartzWorkspaceGitBoundary(workspaceRoot: string): Promise<void> {
  // Quartz enables globby's gitignore support by default. Our staged workspaces often
  // live under ignored paths such as `.osp/` or `.generated/`, so without a local git
  // boundary Quartz walks up to the repository root and filters out every staged note.
  await mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
}

async function ensureNodeModulesLink(workspaceRoot: string, sourceNodeModulesPath: string): Promise<void> {
  const linkPath = path.join(workspaceRoot, "node_modules");

  try {
    const stats = await lstat(linkPath);

    if (stats.isSymbolicLink()) {
      return;
    }

    await rm(linkPath, { force: true, recursive: true });
  } catch {
    // No existing node_modules entry in the staging workspace.
  }

  await symlink(sourceNodeModulesPath, linkPath, "junction");
}

async function ensureQuartzPackageNodeModulesLink(workspaceRoot: string, sourceNodeModulesPath: string): Promise<void> {
  const workspaceQuartzNodeModulesPath = path.join(workspaceRoot, "quartz", "node_modules");

  try {
    const stats = await lstat(workspaceQuartzNodeModulesPath);

    if (stats.isSymbolicLink()) {
      return;
    }

    await rm(workspaceQuartzNodeModulesPath, { force: true, recursive: true });
  } catch {
    // No existing Quartz-local node_modules entry in the staging workspace.
  }

  await symlink(sourceNodeModulesPath, workspaceQuartzNodeModulesPath, "junction");
}

export async function resolveWorkspaceNodeModulesPath(quartzPackageRoot: string): Promise<string> {
  const candidatePaths = [
    path.resolve(quartzPackageRoot, "..", "..", "..", "..", "node_modules"),
    path.resolve(quartzPackageRoot, "..", "..")
  ];

  const resolved = await resolveNodeModulesPath(candidatePaths, quartzPackageRoot);

  // In pnpm strict mode, esbuild (a Quartz devDep) may not be available in the
  // virtual store's shared node_modules. When that happens, fall back to the
  // adapter package's own node_modules where esbuild is a direct dependency.
  const hasEsbuild = await fileExists(path.join(resolved, "esbuild", "package.json"));

  if (!hasEsbuild) {
    const adapterNodeModules = path.resolve(import.meta.dirname, "..", "node_modules");
    const adapterHasEsbuild = await fileExists(path.join(adapterNodeModules, "esbuild", "package.json"));

    if (adapterHasEsbuild) {
      return adapterNodeModules;
    }
  }

  return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveQuartzPackageNodeModulesPath(quartzPackageRoot: string): Promise<string> {
  const candidatePaths = [
    path.resolve(quartzPackageRoot, "..", ".."),
    path.resolve(quartzPackageRoot, "..", "..", "..", "..", "node_modules")
  ];

  return resolveNodeModulesPath(candidatePaths, quartzPackageRoot);
}

async function resolveNodeModulesPath(candidatePaths: string[], quartzPackageRoot: string): Promise<string> {
  for (const candidatePath of candidatePaths) {
    try {
      await access(candidatePath);
      return candidatePath;
    } catch {
      // Try the next runtime layout.
    }
  }

  throw new Error(
    [
      "Quartz runtime dependencies could not be located.",
      `Quartz package root: ${quartzPackageRoot}`,
      "Expected either a pnpm virtual store node_modules path or a flat node_modules directory next to the vendored package."
    ].join(" ")
  );
}

function renderQuartzConfig(config: PublisherConfig): string {
  const pageTitle = JSON.stringify(path.basename(config.vaultRoot) || "Obsidian Site Publisher");

  return `import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

const config: QuartzConfig = {
  configuration: {
    pageTitle: ${pageTitle},
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "localhost",
    ignorePatterns: [".obsidian"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#284b63",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
`;
}

function renderQuartzLayout(config: PublisherConfig): string {
  const searchComponent = config.enableSearch
    ? `{
          Component: Component.Search(),
          grow: true,
        },
        `
    : "";
  const listSearchComponent = config.enableSearch
    ? `{
          Component: Component.Search(),
          grow: true,
        },
        `
    : "";
  const graphComponent = config.enableGraph ? "    Component.Graph(),\n" : "";
  const backlinksComponent = config.enableBacklinks ? "    Component.Backlinks(),\n" : "";

  return `import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {},
  }),
}

export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.TagList(),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        ${searchComponent}{ Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
      ],
    }),
    Component.Explorer(),
  ],
  right: [
${graphComponent}    Component.DesktopOnly(Component.TableOfContents()),
${backlinksComponent}  ],
}

export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        ${listSearchComponent}{ Component: Component.Darkmode() },
      ],
    }),
    Component.Explorer(),
  ],
  right: [],
}
`;
}

export async function readQuartzVersion(quartzPackageRoot: string): Promise<string> {
  const packageJsonPath = path.join(quartzPackageRoot, "package.json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error: unknown) {
    throw new Error(
      `Failed to read Quartz package.json at ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    return "unknown";
  }

  const version = (parsed as Record<string, unknown>).version;

  return typeof version === "string" ? version : "unknown";
}
