import { describe, expect, it } from "vitest";

import { renderQuartzConfig, renderQuartzLayout, resolveQuartzBaseUrl } from "./quartz-config-renderer.js";

describe("quartz config renderer", () => {
  it("normalizes the configured site base url into Quartz format", () => {
    expect(resolveQuartzBaseUrl("https://example.com/docs/")).toBe("example.com/docs");
    expect(resolveQuartzBaseUrl("docs.example.com/subsite/")).toBe("docs.example.com/subsite");
    expect(resolveQuartzBaseUrl(undefined)).toBe("localhost");
  });

  it("renders Quartz config with user-provided fields", () => {
    const output = renderQuartzConfig({
      vaultRoot: "/vault",
      publishMode: "frontmatter",
      includeGlobs: [],
      excludeGlobs: [],
      outputDir: "/vault/.osp/dist",
      builder: "quartz",
      deployTarget: "none",
      enableSearch: true,
      enableBacklinks: false,
      enableGraph: false,
      strictMode: false,
      siteBaseUrl: "https://example.com/blog",
      locale: "zh-CN",
      ignorePatterns: [".obsidian", "Drafts"],
      defaultDateType: "created"
    });

    expect(output).toContain('pageTitle: "vault"');
    expect(output).toContain('baseUrl: "example.com/blog"');
    expect(output).toContain('locale: "zh-CN"');
    expect(output).toContain('ignorePatterns: [".obsidian","Drafts"]');
    expect(output).toContain('defaultDateType: "created"');
  });

  it("falls back to defaults when optional fields are omitted", () => {
    const output = renderQuartzConfig({
      vaultRoot: "/vault",
      publishMode: "frontmatter",
      includeGlobs: [],
      excludeGlobs: [],
      outputDir: "/vault/.osp/dist",
      builder: "quartz",
      deployTarget: "none",
      enableSearch: true,
      enableBacklinks: true,
      enableGraph: true,
      strictMode: false
    });

    expect(output).toContain('baseUrl: "localhost"');
    expect(output).toContain('locale: "en-US"');
    expect(output).toContain('ignorePatterns: [".obsidian"]');
    expect(output).toContain('defaultDateType: "modified"');
    expect(output).not.toContain("Plugin.OGImage()");
    expect(output).toContain('markdownLinkResolution: "shortest"');
  });

  it("includes OGImage emitter when enableOgImages is true", () => {
    const output = renderQuartzConfig({
      vaultRoot: "/vault",
      publishMode: "frontmatter",
      includeGlobs: [],
      excludeGlobs: [],
      outputDir: "/vault/.osp/dist",
      builder: "quartz",
      deployTarget: "none",
      enableSearch: true,
      enableBacklinks: true,
      enableGraph: true,
      strictMode: false,
      enableOgImages: true
    });

    expect(output).toContain("Plugin.OGImage()");
  });

  it("renders custom link resolution strategy", () => {
    const output = renderQuartzConfig({
      vaultRoot: "/vault",
      publishMode: "frontmatter",
      includeGlobs: [],
      excludeGlobs: [],
      outputDir: "/vault/.osp/dist",
      builder: "quartz",
      deployTarget: "none",
      enableSearch: true,
      enableBacklinks: true,
      enableGraph: true,
      strictMode: false,
      linkResolution: "relative"
    });

    expect(output).toContain('markdownLinkResolution: "relative"');
  });
});

describe("quartz layout renderer", () => {
  const baseConfig = {
    vaultRoot: "/vault",
    publishMode: "frontmatter" as const,
    includeGlobs: [],
    excludeGlobs: [],
    outputDir: "/vault/.osp/dist",
    builder: "quartz" as const,
    deployTarget: "none" as const,
    enableSearch: true,
    enableBacklinks: true,
    enableGraph: true,
    strictMode: false
  };

  it("renders default layout with all optional components enabled", () => {
    const output = renderQuartzLayout(baseConfig);

    expect(output).toContain("Component.Explorer()");
    expect(output).toContain("Component.DesktopOnly(Component.TableOfContents())");
    expect(output).toContain("Component.Darkmode()");
    expect(output).toContain("Component.ReaderMode()");
    expect(output).toContain("Component.Graph()");
    expect(output).toContain("Component.Backlinks()");
  });

  it("omits components when explicitly disabled", () => {
    const output = renderQuartzLayout({
      ...baseConfig,
      enableExplorer: false,
      enableTableOfContents: false,
      enableDarkmode: false,
      enableReaderMode: false,
      enableGraph: false,
      enableBacklinks: false,
      enableRecentNotes: false
    });

    expect(output).not.toContain("Component.Explorer()");
    expect(output).not.toContain("Component.TableOfContents()");
    expect(output).not.toContain("Component.Darkmode()");
    expect(output).not.toContain("Component.ReaderMode()");
    expect(output).not.toContain("Component.Graph()");
    expect(output).not.toContain("Component.Backlinks()");
    expect(output).not.toContain("Component.RecentNotes()");
  });

  it("includes RecentNotes when enabled", () => {
    const output = renderQuartzLayout({
      ...baseConfig,
      enableRecentNotes: true
    });

    expect(output).toContain("Component.RecentNotes()");
  });

  it("renders footer links in the layout", () => {
    const output = renderQuartzLayout({
      ...baseConfig,
      footerLinks: {
        GitHub: "https://github.com/shihuaidexianyu",
        Twitter: "https://twitter.com/example"
      }
    });

    expect(output).toContain('"GitHub":"https://github.com/shihuaidexianyu"');
    expect(output).toContain('"Twitter":"https://twitter.com/example"');
  });
});
