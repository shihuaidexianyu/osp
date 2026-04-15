import { ItemView, type WorkspaceLeaf } from "obsidian";

import type { PluginCommand, PluginExecutionState } from "./plugin-shell.js";
import type { PublisherPluginUiSettings } from "./settings.js";
import { renderBuildLogPanel, renderControlPanel, renderIssuePanel } from "./view-rendering.js";

export const CONTROL_PANEL_VIEW_TYPE = "osp-control-panel-view";
export const CONTROL_PANEL_VIEW_ICON = "globe";
export const ISSUE_LIST_VIEW_TYPE = "osp-issues-view";
export const BUILD_LOG_VIEW_TYPE = "osp-build-logs-view";

type StateReader = () => PluginExecutionState;
type UiSettingsReader = () => PublisherPluginUiSettings;
type ActiveCommandReader = () => PluginCommand | undefined;
type CommandRunner = (command: PluginCommand) => Promise<void>;
type PreviewStopper = () => Promise<void>;

export class PublisherControlView extends ItemView {
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly readState: StateReader,
    private readonly readActiveCommand: ActiveCommandReader,
    private readonly runCommand: CommandRunner,
    private readonly stopPreview: PreviewStopper
  ) {
    super(leaf);
  }

  public override getViewType(): string {
    return CONTROL_PANEL_VIEW_TYPE;
  }

  public override getDisplayText(): string {
    return "站点发布";
  }

  public override getIcon(): string {
    return CONTROL_PANEL_VIEW_ICON;
  }

  public override async onOpen(): Promise<void> {
    this.refresh();
  }

  public override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  public refresh(): void {
    renderControlPanel(this.contentEl, this.readState(), this.readActiveCommand(), this.runCommand, this.stopPreview);
  }
}

export class IssueListView extends ItemView {
  public constructor(leaf: WorkspaceLeaf, private readonly readState: StateReader, private readonly readUi: UiSettingsReader) {
    super(leaf);
  }

  public override getViewType(): string {
    return ISSUE_LIST_VIEW_TYPE;
  }

  public override getDisplayText(): string {
    return "发布问题";
  }

  public override async onOpen(): Promise<void> {
    this.refresh();
  }

  public override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  public refresh(): void {
    renderIssuePanel(this.contentEl, this.readState(), this.readUi());
  }
}

export class BuildLogView extends ItemView {
  public constructor(leaf: WorkspaceLeaf, private readonly readState: StateReader) {
    super(leaf);
  }

  public override getViewType(): string {
    return BUILD_LOG_VIEW_TYPE;
  }

  public override getDisplayText(): string {
    return "构建日志";
  }

  public override async onOpen(): Promise<void> {
    this.refresh();
  }

  public override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  public refresh(): void {
    renderBuildLogPanel(this.contentEl, this.readState());
  }
}
