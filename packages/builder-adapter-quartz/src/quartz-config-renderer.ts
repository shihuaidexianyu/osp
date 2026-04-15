import path from "node:path";

import type { PublisherConfig } from "@osp/shared";
import { renderQuartzConfigTemplate } from "./quartz-config-template.js";
import { renderQuartzLayoutTemplate } from "./quartz-layout-template.js";

/**
 * Renders the Quartz-owned config files that we copy into the prepared workspace.
 * The templates stay inline here on purpose so Quartz-specific output remains easy to inspect and patch.
 */
export function renderQuartzConfig(config: PublisherConfig): string {
  const pageTitle = JSON.stringify(path.basename(config.vaultRoot) || "Obsidian Site Publisher");
  const baseUrl = JSON.stringify(resolveQuartzBaseUrl(config.siteBaseUrl));
  const locale = JSON.stringify(config.locale ?? "en-US");
  const ignorePatterns = JSON.stringify(config.ignorePatterns ?? [".obsidian"]);
  const defaultDateType = JSON.stringify(config.defaultDateType ?? "modified");

  return renderQuartzConfigTemplate({
    pageTitle,
    baseUrl,
    locale,
    ignorePatterns,
    defaultDateType
  });
}

export function renderQuartzLayout(config: PublisherConfig): string {
  return renderQuartzLayoutTemplate({
    enableBacklinks: config.enableBacklinks,
    enableDarkmode: config.enableDarkmode ?? true,
    enableExplorer: config.enableExplorer ?? true,
    enableGraph: config.enableGraph,
    enableReaderMode: config.enableReaderMode ?? true,
    enableRecentNotes: config.enableRecentNotes ?? false,
    enableSearch: config.enableSearch,
    enableTableOfContents: config.enableTableOfContents ?? true
  });
}

export function resolveQuartzBaseUrl(siteBaseUrl: string | undefined): string {
  if (siteBaseUrl === undefined || siteBaseUrl.trim() === "") {
    return "localhost";
  }

  const trimmedValue = siteBaseUrl.trim();

  try {
    // Quartz expects host + optional path, not a full URL with protocol.
    const parsedUrl = new URL(trimmedValue.includes("://") ? trimmedValue : `https://${trimmedValue}`);
    const normalizedPath = parsedUrl.pathname.replace(/\/+$/u, "");

    return `${parsedUrl.host}${normalizedPath === "" ? "" : normalizedPath}`;
  } catch {
    // Fall back to a conservative string normalization instead of rejecting user input outright.
    return trimmedValue.replace(/^https?:\/\//iu, "").replace(/\/+$/u, "");
  }
}
