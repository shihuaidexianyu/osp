/**
 * Generates the Quartz layout source file for the prepared workspace.
 * Search, graph, and backlinks are toggled here so the renderer can stay focused on input normalization.
 */
export function renderQuartzLayoutTemplate(input: {
  enableBacklinks: boolean;
  enableGraph: boolean;
  enableSearch: boolean;
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
  const graphComponent = input.enableGraph ? "    Component.Graph(),\n" : "";
  const backlinksComponent = input.enableBacklinks ? "    Component.Backlinks(),\n" : "";

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
