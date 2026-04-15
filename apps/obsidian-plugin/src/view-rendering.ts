import { Notice } from "obsidian";

import {
  createControlPanelActions,
  createControlPanelMeta,
  createControlPanelStatusItems,
  createIssuePanelItems,
  createIssuePanelMeta,
  createLogPanelItems,
  createLogPanelMeta,
  type ControlPanelAction,
  type IssuePanelItem,
  type LogPanelItem,
  type PanelMeta
} from "./plugin-view-model.js";
import type { PluginCommand, PluginExecutionState } from "./plugin-shell.js";
import type { PublisherPluginUiSettings } from "./settings.js";

type CommandRunner = (command: PluginCommand) => Promise<void>;
type PreviewStopper = () => Promise<void>;

export function renderControlPanel(
  containerEl: HTMLElement,
  state: PluginExecutionState,
  activeCommand: PluginCommand | undefined,
  runCommand: CommandRunner,
  stopPreview: PreviewStopper
): void {
  const meta = createControlPanelMeta(state, activeCommand);
  const actions = createControlPanelActions(activeCommand);
  const statusItems = createControlPanelStatusItems(state);

  containerEl.empty();
  containerEl.addClass("osp-panel", "osp-control-panel");

  const headerEl = containerEl.createDiv({
    cls: "osp-panel-header"
  });
  headerEl.createEl("div", {
    cls: "osp-panel-kicker",
    text: "Publisher"
  });
  headerEl.createEl("h2", {
    text: meta.title
  });
  headerEl.createEl("p", {
    cls: "osp-panel-summary",
    text: meta.summary
  });

  const statusCardEl = containerEl.createDiv({
    cls: "osp-status-card"
  });
  statusCardEl.createEl("div", {
    cls: "osp-panel-kicker",
    text: activeCommand === undefined ? "当前状态" : "任务进行中"
  });
  statusCardEl.createEl("div", {
    cls: "osp-status-card-message",
    text: meta.statusMessage
  });
  if (meta.progressMessage !== undefined) {
    statusCardEl.createDiv({
      cls: "osp-progress-bar"
    }).createDiv({
      cls: "osp-progress-bar-fill"
    });
    statusCardEl.createEl("div", {
      cls: "osp-progress-text",
      text: meta.progressMessage
    });
  }
  if (state.lastPreviewSession !== undefined && activeCommand === undefined) {
    const statusActionsEl = statusCardEl.createDiv({
      cls: "osp-status-card-actions"
    });
    const stopPreviewButtonEl = statusActionsEl.createEl("button", {
      cls: "osp-secondary-button",
      text: "停止预览"
    });
    stopPreviewButtonEl.addEventListener("click", () => {
      void stopPreview();
    });
  }

  const actionsSectionEl = containerEl.createDiv({
    cls: "osp-section"
  });
  actionsSectionEl.createEl("h3", {
    text: "快速操作"
  });
  const actionsEl = actionsSectionEl.createDiv({
    cls: "osp-action-grid"
  });

  for (const action of actions) {
    renderControlPanelAction(actionsEl, action, runCommand);
  }

  const statusSectionEl = containerEl.createDiv({
    cls: "osp-section"
  });
  statusSectionEl.createEl("h3", {
    text: "运行概览"
  });
  const statusEl = statusSectionEl.createDiv({
    cls: "osp-meta-grid"
  });

  for (const item of statusItems) {
    const itemEl = statusEl.createDiv({
      cls: "osp-meta-card"
    });
    itemEl.createEl("div", {
      cls: "osp-meta-label",
      text: item.label
    });

    if (item.copyValue === undefined) {
      itemEl.createEl("div", {
        cls: "osp-meta-value",
        text: item.value
      });
      continue;
    }

    const valueRowEl = itemEl.createDiv({
      cls: "osp-meta-value-row"
    });
    valueRowEl.createEl("div", {
      cls: "osp-meta-value osp-meta-value-code",
      text: item.value
    });
    const copyButtonEl = valueRowEl.createEl("button", {
      cls: "osp-meta-copy-button",
      text: "复制"
    });
    copyButtonEl.addEventListener("click", () => {
      void copyTextToClipboard(item.copyValue as string);
    });
  }
}

async function copyTextToClipboard(value: string): Promise<void> {
  try {
    const clipboardApi = (globalThis.navigator as Navigator & {
      clipboard?: {
        writeText(text: string): Promise<void>;
      };
    }).clipboard;

    if (clipboardApi === undefined) {
      throw new Error("Clipboard API unavailable");
    }

    await clipboardApi.writeText(value);
    new Notice("日志文件地址已复制");
  } catch {
    new Notice("复制失败，请重试。");
  }
}

export function renderIssuePanel(containerEl: HTMLElement, state: PluginExecutionState, ui: PublisherPluginUiSettings): void {
  const meta = createIssuePanelMeta(state, ui);
  const items = createIssuePanelItems(state, ui);

  renderPanel(containerEl, meta, items, (parent, item) => {
    parent.createEl("div", {
      cls: "osp-panel-badge",
      text: item.badge
    });
    parent.createEl("div", {
      cls: "osp-panel-path",
      text: item.fileLabel
    });
    parent.createEl("div", {
      cls: "osp-panel-message",
      text: item.message
    });

    if (item.suggestion !== undefined) {
      parent.createEl("div", {
        cls: "osp-panel-hint",
        text: `建议：${item.suggestion}`
      });
    }
  });
}

export function renderBuildLogPanel(containerEl: HTMLElement, state: PluginExecutionState): void {
  const meta = createLogPanelMeta(state);
  const items = createLogPanelItems(state);

  renderPanel(containerEl, meta, items, (parent, item) => {
    parent.createEl("div", {
      cls: "osp-panel-badge",
      text: item.badge
    });
    parent.createEl("div", {
      cls: "osp-panel-path",
      text: item.timestamp
    });
    parent.createEl("div", {
      cls: "osp-panel-message",
      text: item.message
    });
  });
}

function renderControlPanelAction(parent: HTMLElement, action: ControlPanelAction, runCommand: CommandRunner): void {
  const itemEl = parent.createDiv({
    cls: "osp-action-card"
  });

  const cardHeaderEl = itemEl.createDiv({
    cls: "osp-action-card-header"
  });
  cardHeaderEl.createEl("div", {
    cls: "osp-action-card-title",
    text: action.label
  });
  cardHeaderEl.createEl("div", {
    cls: action.isRunning ? "osp-action-card-state is-running" : "osp-action-card-state",
    text: action.isRunning ? "运行中" : "待命"
  });

  itemEl.createEl("div", {
    cls: "osp-action-card-description",
    text: action.description
  });

  const buttonEl = itemEl.createEl("button", {
    cls: action.command === "publish" ? "mod-cta osp-action-button" : "osp-action-button",
    text: action.buttonLabel
  });

  buttonEl.disabled = action.isDisabled;
  buttonEl.addEventListener("click", () => {
    void runCommand(action.command);
  });
}

function renderPanel<T extends IssuePanelItem | LogPanelItem>(
  containerEl: HTMLElement,
  meta: PanelMeta,
  items: T[],
  renderItem: (parent: HTMLElement, item: T) => void
): void {
  containerEl.empty();
  containerEl.addClass("osp-panel");
  containerEl.createEl("h2", {
    text: meta.title
  });
  containerEl.createEl("p", {
    cls: "osp-panel-summary",
    text: meta.summary
  });

  if (items.length === 0) {
    containerEl.createEl("p", {
      cls: "osp-panel-empty",
      text: meta.emptyMessage
    });
    return;
  }

  const listEl = containerEl.createDiv({
    cls: "osp-panel-list"
  });

  for (const item of items) {
    const itemEl = listEl.createDiv({
      cls: "osp-panel-item"
    });

    renderItem(itemEl, item);
  }
}
