# AGENTS.md — Obsidian Site Publisher

> This file is for AI coding agents. It assumes you know nothing about the project.

---

## Project Overview

**Obsidian Site Publisher** is a toolchain for publishing selected subsets of an Obsidian vault as a static site. It is organized as a pnpm monorepo with a strict three-layer architecture:

1. **Obsidian plugin** (`apps/obsidian-plugin`) — a thin UI shell that provides settings, commands, and notices. It does NOT contain build, parse, or deploy logic.
2. **Standalone CLI** (`apps/publisher-cli`) — a thin CLI shell that exposes `scan`/`build`/`preview`/`deploy` commands and delegates to `@osp/core`.
3. **Pipeline packages** (`packages/*`) — orchestrated by `@osp/core`, these perform the actual work: parsing vaults, diagnosing issues, staging files, building with Quartz, and deploying.

The dependency flow is:

```
obsidian-plugin → @osp/shared
publisher-cli   → @osp/core + @osp/shared
@osp/core       → parser / diagnostics / staging / builder-adapter-quartz / deploy-adapters / shared
```

The Obsidian plugin must never import pipeline packages directly. This boundary is enforced by an architecture test.

---

## Technology Stack

- **Language**: TypeScript 5.8+ (strict mode, ES2022, ESNext modules, Bundler module resolution)
- **Package Manager**: pnpm 10.6.0 (via corepack)
- **Monorepo**: pnpm workspaces
- **Build**: TypeScript project references (`tsc -b`); esbuild for the Obsidian plugin bundle; Node.js SEA for the native CLI executable
- **Testing**: Vitest 3.1+ with co-located `*.test.ts` files
- **Schema Validation**: Zod
- **Static Site Generator**: Quartz v4 (via `@jackyzha0/quartz` dependency in `builder-adapter-quartz`)
- **CI/CD**: GitHub Actions (`.github/workflows/build-release.yml`) — builds release artifacts on Windows, macOS, and Linux

---

## Repository Layout

```text
apps/
  obsidian-plugin/          # Obsidian plugin UI shell
  publisher-cli/            # Standalone CLI entrypoint

packages/
  shared/                   # Types, Zod schemas, constants, contracts
  parser/                   # Vault scanning, frontmatter parsing, link/embed extraction
  diagnostics/              # Manifest analysis and structured issue reporting
  staging/                  # Prepare Quartz-compatible workspace from selected slice
  builder-adapter-quartz/   # Adapt staged workspace to Quartz; run build/preview
  deploy-adapters/          # Deployment targets (filesystem, Git branch, GitHub Pages)
  core/                     # Orchestrator; wires the full pipeline

fixtures/                   # Deterministic test vaults (12+ scenarios)
docs/
  architecture/             # System overview and module boundaries
  adr/                      # Architecture Decision Records
  prompts/                  # Engineering rules and task templates
scripts/
  build-release.mjs         # Full release build (plugin + native CLI + runtime)
  build-native-cli.mjs      # Node.js SEA executable builder
```

---

## Build and Test Commands

Install dependencies and build:

```bash
corepack pnpm install
corepack pnpm build               # tsc -b tsconfig.json
```

Test commands:

```bash
corepack pnpm test                # vitest run
corepack pnpm test:watch          # vitest watch mode
```

Lint and full check:

```bash
corepack pnpm lint                # eslint . --ext .ts --max-warnings=0
corepack pnpm check               # lint + test + build
```

Package-specific builds:

```bash
corepack pnpm build:obsidian-plugin   # esbuild bundle → .obsidian-plugin-build/
corepack pnpm build:native-cli        # Node.js SEA → .release/native-cli/
corepack pnpm build:release           # full turnkey release → .release/v<version>/artifacts/
```

Run a single test file:

```bash
corepack pnpm vitest run packages/parser/src/markdown-analysis.test.ts
corepack pnpm vitest run packages/staging/ --reporter=verbose
```

---

## Code Style Guidelines

- **TypeScript strict mode** is mandatory (`strict: true` in `tsconfig.base.json`).
- **No explicit `any`** (`@typescript-eslint/no-explicit-any: error`).
- **Prefer `type` imports** (`@typescript-eslint/consistent-type-imports: error`).
- **File size limit**: 300 logical lines max (`max-lines` ESLint rule; blank lines and comments are skipped).
- Use **pure functions** in domain packages (parser, diagnostics, staging).
- Keep **adapters boring and explicit**.
- Every new external input or persisted output must have a **Zod schema**.
- Every error path must use a **structured error code or issue code** — no bare strings.
- Do **not** move business logic into the Obsidian plugin or other UI code.
- If a real bug is found, add or update a **fixture in `fixtures/`**.

---

## Testing Instructions

- **Framework**: Vitest
- **Pattern**: `**/*.test.ts` co-located with source files
- **Aliases**: `vitest.config.ts` maps `@osp/shared`, `@osp/core`, `@osp/parser`, etc. to their `src/index.ts`
- **Fixture vaults**: `fixtures/vault-*` provide deterministic inputs for parser and diagnostics tests. There are 12+ fixture vaults covering basic notes, links, embeds, callouts, math/mermaid, canvas/base, broken links, edge cases, etc.
- **Real-world smoke test**: `test_vault/hw` (if present) should be spot-checked after parser or diagnostics changes.
- **Architecture tests**: `apps/obsidian-plugin/src/vibe-coding-rules.test.ts` enforces that the plugin does not import pipeline packages and that engineering rules are documented.
- **Plugin tests**: Use mocked Obsidian API; the `obsidian` package is a devDependency only in the plugin.

---

## Module Boundaries (Critical)

These are enforced by tests and by convention:

- `apps/obsidian-plugin` may only depend on `@osp/shared` (and `obsidian`/`zod` as dev/runtime deps).
- `apps/publisher-cli` depends on `@osp/core` and `@osp/shared`.
- `packages/core` is the only package that imports all pipeline packages.
- Pipeline packages (`parser`, `diagnostics`, `staging`, `builder-adapter-quartz`, `deploy-adapters`) depend on `@osp/shared` and each other only through `@osp/core` orchestration.

**Disallowed changes:**
- Rewriting parser + diagnostics + UI together in one changeset.
- Changing public interfaces without updating dependents and docs.
- Adding hidden side effects to shared utilities.
- Mixing refactors with new features across multiple layers.

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Root scripts and shared devDependencies |
| `pnpm-workspace.yaml` | Workspace globs (`apps/*`, `packages/*`) |
| `tsconfig.base.json` | Shared strict TS compiler options |
| `tsconfig.json` | Project references to all packages/apps |
| `tsconfig.eslint.json` | ESLint type-checking scope |
| `vitest.config.ts` | Test aliases and include patterns |
| `eslint.config.mjs` | ESLint rules and ignore patterns |

---

## Deployment and Release Process

Local release build:

```bash
corepack pnpm build:release
```

This produces:

- `.obsidian-plugin-build/obsidian-site-publisher/` — plugin bundle
- `.release/v<version>/artifacts/*.zip` — platform-specific release packages
- `.release/v<version>/artifacts/release-manifest.json` — build metadata

**GitHub Release** (CI/CD):

- Trigger via push of a `v*` tag or manual workflow dispatch with a `release_tag`.
- The workflow (`.github/workflows/build-release.yml`) builds on `windows-latest`, `macos-latest`, and `ubuntu-latest`.
- Artifacts are uploaded and attached to a GitHub Release automatically.

---

## Security Considerations

- The CLI is packaged as a **Node.js Single Executable Application (SEA)**. The build script uses `postject` to inject a SEA blob into a copy of the Node.js binary. On macOS/Windows it attempts to remove code signatures first.
- End users installing from release do **not** need Node.js installed; the bundle includes the Node.js runtime and all dependencies.
- The plugin calls the external CLI as a child process. It validates CLI JSON output with Zod schemas before use.
- All config and persisted outputs are validated with Zod. Do not bypass schema validation for new inputs.

---

## Quick Reference for Agents

Before editing a package, read its `README.md` inside that package.

Keep changes inside **one module** or **one pipeline slice** whenever possible.

When in doubt, prefer:
- A focused implementation inside one package.
- Tests + implementation for one diagnostics rule.
- Adapter wiring inside a single adapter package.
- UI wiring that keeps the Obsidian plugin as a thin shell around external CLI calls.
