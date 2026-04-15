/**
 * Generates the Quartz layout source file for the prepared workspace.
 * Search, graph, backlinks, and additional page components are toggled here.
 */
export function renderQuartzLayoutTemplate(input: {
  enableBacklinks: boolean;
  enableDarkmode: boolean;
  enableExplorer: boolean;
  enableGraph: boolean;
  enableReaderMode: boolean;
  enableRecentNotes: boolean;
  enableSearch: boolean;
  enableTableOfContents: boolean;
  footerLinks: Record<string, string>;
}): string {
  const searchComponent = input.enableSearch
    ? `{
          Component: Component.Search(),
          grow: true,
        },
        `
    : "";
  const listSearchComponent = input.enableSearch
    ? `{
          Component: Component.Search(),
          grow: true,
        },
        `
    : "";
  const darkmodeComponent = input.enableDarkmode
    ? `{ Component: Component.Darkmode() },`
    : "";
  const readerModeComponent = input.enableReaderMode
    ? `{ Component: Component.ReaderMode() },`
    : "";
  const graphComponent = input.enableGraph ? "    Component.Graph(),\n" : "";
  const tocComponent = input.enableTableOfContents
    ? "    Component.DesktopOnly(Component.TableOfContents()),\n"
    : "";
  const backlinksComponent = input.enableBacklinks ? "    Component.Backlinks(),\n" : "";
  const recentNotesComponent = input.enableRecentNotes
    ? "    Component.RecentNotes(),\n"
    : "";
  const explorerComponent = input.enableExplorer ? "    Component.Explorer(),\n" : "";

  return `import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: ${JSON.stringify(input.footerLinks)},
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
        ${searchComponent}${darkmodeComponent}
        ${readerModeComponent}
      ],
    }),
${explorerComponent}  ],
  right: [
${graphComponent}${tocComponent}${backlinksComponent}${recentNotesComponent}  ],
}

export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        ${listSearchComponent}${darkmodeComponent}
      ],
    }),
${explorerComponent}  ],
  right: [
${recentNotesComponent}  ],
}
`;
}
