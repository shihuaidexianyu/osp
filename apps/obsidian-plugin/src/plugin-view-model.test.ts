import { describe, expect, it } from "vitest";

import {
  createControlPanelActions,
  createControlPanelMeta,
  createControlPanelStatusItems,
  createIssuePanelItems,
  createIssuePanelMeta,
  createLogPanelItems,
  createLogPanelMeta
} from "./plugin-view-model.js";
import type { PluginExecutionState } from "./plugin-shell.js";

describe("plugin view model", () => {
  it("formats issues into stable panel items", () => {
    const state = createState({
      lastCommand: "issues",
      lastUpdatedAt: "2026-03-18T13:00:00.000Z",
      lastIssues: [
        {
          code: "BROKEN_LINK",
          severity: "error",
          file: "Broken.md",
          message: "Link target is missing.",
          location: {
            line: 3,
            column: 7
          },
          suggestion: "Publish the target note or fix the link."
        }
      ]
    });

    expect(createIssuePanelMeta(state, { showInformationalIssues: false })).toEqual({
      title: "发布问题",
      summary: "最近一次结果里有 1 个问题 | 最近命令：检查问题 | 更新时间：2026-03-18T13:00:00.000Z",
      emptyMessage: "运行“检查发布问题”或“构建站点”后，可在这里查看阻断项。"
    });
    expect(createIssuePanelItems(state, { showInformationalIssues: false })).toEqual([
      {
        badge: "ERROR · BROKEN_LINK",
        fileLabel: "Broken.md:3:7",
        message: "Link target is missing.",
        suggestion: "Publish the target note or fix the link."
      }
    ]);
  });

  it("hides informational issues by default while allowing them to be shown", () => {
    const state = createState({
      lastCommand: "issues",
      lastUpdatedAt: "2026-03-18T13:00:00.000Z",
      lastIssues: [
        {
          code: "UNSUPPORTED_CANVAS",
          severity: "info",
          file: "Map.canvas",
          message: "Canvas is reported only.",
          suggestion: "Ignore it."
        },
        {
          code: "BROKEN_LINK",
          severity: "error",
          file: "Broken.md",
          message: "Link target is missing."
        }
      ]
    });

    expect(createIssuePanelMeta(state, { showInformationalIssues: false }).summary).toContain("最近一次结果里有 1 个问题");
    expect(createIssuePanelItems(state, { showInformationalIssues: false })).toEqual([
      {
        badge: "ERROR · BROKEN_LINK",
        fileLabel: "Broken.md",
        message: "Link target is missing."
      }
    ]);

    expect(createIssuePanelItems(state, { showInformationalIssues: true })).toHaveLength(2);
  });

  it("formats logs into stable panel items", () => {
    const state = createState({
      lastCommand: "build",
      lastUpdatedAt: "2026-03-18T13:05:00.000Z",
      lastLogPath: "D:/vault/.osp/logs/build.log",
      lastLogs: [
        {
          level: "warning",
          message: "Quartz emitted a warning.",
          timestamp: "2026-03-18T13:04:59.000Z"
        }
      ]
    });

    expect(createLogPanelMeta(state)).toEqual({
      title: "构建日志",
      summary: "侧栏仅显示最近 1 条日志 | 完整日志：D:/vault/.osp/logs/build.log | 最近命令：构建 | 更新时间：2026-03-18T13:05:00.000Z",
      emptyMessage: "运行“构建站点”或“发布站点”后，可在这里查看日志摘要；完整内容在日志文件里。"
    });
    expect(createLogPanelItems(state)).toEqual([
      {
        badge: "WARNING",
        timestamp: "2026-03-18 13:04:59.000 UTC",
        message: "Quartz emitted a warning."
      }
    ]);
  });

  it("builds control panel metadata and action state", () => {
    const state = createState({
      lastCommand: "preview",
      lastUpdatedAt: "2026-03-18T13:05:00.000Z",
      statusMessage: "站点预览已启动：http://localhost:8080",
      lastLogPath: "D:/vault/.osp/logs/preview.log",
      lastPreviewSession: {
        success: true as const,
        url: "http://localhost:8080",
        workspaceRoot: "D:/vault/.osp/preview",
        startedAt: "2026-03-18T13:04:59.000Z"
      },
      lastIssues: [
        {
          code: "BROKEN_LINK",
          severity: "error",
          file: "Broken.md",
          message: "Link target is missing."
        }
      ]
    });

    expect(createControlPanelMeta(state, "build")).toEqual({
      title: "站点发布",
      summary: "正在执行：构建。进度会显示在这里。",
      statusMessage: "正在构建站点...",
      progressMessage: "任务进行中，请稍候..."
    });
    expect(createControlPanelActions("build")).toEqual([
      {
        command: "issues",
        label: "检查问题",
        description: "扫描当前配置下的阻断项和提示。",
        buttonLabel: "检查问题",
        isRunning: false,
        isDisabled: true
      },
      {
        command: "build",
        label: "构建站点",
        description: "生成静态站点文件，但不执行发布。",
        buttonLabel: "正在构建站点...",
        isRunning: true,
        isDisabled: true
      },
      {
        command: "preview",
        label: "启动预览",
        description: "启动本地预览服务，并自动打开浏览器。",
        buttonLabel: "启动预览",
        isRunning: false,
        isDisabled: true
      },
      {
        command: "publish",
        label: "发布站点",
        description: "按当前发布目标执行构建并发布。",
        buttonLabel: "发布站点",
        isRunning: false,
        isDisabled: true
      }
    ]);
    expect(createControlPanelStatusItems(state)).toEqual([
      {
        label: "最近命令",
        value: "预览"
      },
      {
        label: "预览地址",
        value: "http://localhost:8080"
      },
      {
        label: "日志文件",
        value: "D:/vault/.osp/logs/preview.log",
        copyValue: "D:/vault/.osp/logs/preview.log"
      },
      {
        label: "最近更新",
        value: "2026-03-18T13:05:00.000Z"
      }
    ]);
  });
});

function createState(overrides: Partial<PluginExecutionState>): PluginExecutionState {
  return {
    lastIssues: [],
    lastLogs: [],
    ...overrides
  };
}
