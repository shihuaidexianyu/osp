import path from "node:path";

import { describe, expect, it } from "vitest";

import { createQuartzBuildCommandSpec, createQuartzPreviewCommandSpec } from "./quartz-command-spec.js";

const workspace = {
  mode: "build" as const,
  rootDir: "/workspace",
  contentDir: "/workspace/content",
  outputDir: "/workspace/dist",
  manifestPath: "/workspace/manifest.json"
};

describe("quartz command spec", () => {
  it("creates a build command spec from a prepared workspace", () => {
    const spec = createQuartzBuildCommandSpec(workspace);

    expect(spec.bootstrapCliPath).toBe(path.join("/workspace", "quartz", "bootstrap-cli.mjs"));
    expect(spec.cwd).toBe("/workspace");
    expect(spec.args).toEqual(["build", "--directory", "content", "--output", "dist"]);
    expect(spec.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("extends the build command spec for watch preview mode", () => {
    const spec = createQuartzPreviewCommandSpec(workspace, 8080, 3001);

    expect(spec.args).toEqual([
      "build",
      "--directory",
      "content",
      "--output",
      "dist",
      "--serve",
      "--watch",
      "--port",
      "8080",
      "--wsPort",
      "3001"
    ]);
  });
});
