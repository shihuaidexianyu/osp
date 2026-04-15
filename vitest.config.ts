import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@osp/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@osp/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@osp/parser": path.resolve(__dirname, "packages/parser/src/index.ts"),
      "@osp/diagnostics": path.resolve(__dirname, "packages/diagnostics/src/index.ts"),
      "@osp/staging": path.resolve(__dirname, "packages/staging/src/index.ts"),
      "@osp/builder-adapter-quartz": path.resolve(__dirname, "packages/builder-adapter-quartz/src/index.ts"),
      "@osp/deploy-adapters": path.resolve(__dirname, "packages/deploy-adapters/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules/", "dist/", "**/*.d.ts", "**/*.test.ts", "**/*.test.helpers.ts"]
    }
  }
});
