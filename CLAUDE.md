# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian Site Publisher — a toolchain for publishing selected subsets of Obsidian vaults as static sites. Three-layer architecture: an Obsidian plugin (settings UI), a standalone CLI (`scan`/`build`/`preview`/`deploy`), and a Quartz-based build pipeline orchestrated by `@osp/core`.

## Common Commands

```bash
# Build (TypeScript project references)
pnpm build

# Test
pnpm test              # run all tests once
pnpm test:watch        # watch mode

# Lint
pnpm lint              # eslint with --max-warnings=0

# Full check
pnpm check             # lint + test + build

# Run a single test file
pnpm vitest run packages/parser/src/markdown-analysis.test.ts
pnpm vitest run packages/staging/ --reporter=verbose

# Package bundles
pnpm build:obsidian-plugin   # esbuild bundle for Obsidian
pnpm build:native-cli        # Node.js SEA executable
pnpm build:release           # full release build
```

## Monorepo Structure

```
apps/
  obsidian-plugin/   # Thin UI shell — calls external CLI, imports only @osp/shared
  publisher-cli/      # Thin CLI shell — delegates to @osp/core

packages/
  shared/             # Types, schemas (Zod), contracts used by all packages
  parser/             # Vault scanning and metadata extraction
  diagnostics/        # Issue detection and reporting
  staging/            # Prepares Quartz workspace
  builder-adapter-quartz/  # Adapts staged workspace to Quartz build/preview
  deploy-adapters/    # Deployment targets (GitHub Pages, Git branch, filesystem)
  core/               # Orchestrator — wires parser → diagnostics → staging → build → deploy
```

**Dependency flow:** `apps/* → @osp/core → pipeline packages → @osp/shared`

The Obsidian plugin must NOT import any pipeline package directly — it is a thin shell around external CLI calls. This is enforced by architecture tests.

## Architecture

### Pipeline
1. **Scan** — Parser walks vault, extracts frontmatter/wiki-links, produces a manifest
2. **Diagnostics** — Analyzes manifest, reports issues (broken links, missing frontmatter, etc.)
3. **Staging** — Copies selected files into a Quartz-compatible workspace
4. **Build** — Quartz adapter runs Quartz build or preview server
5. **Deploy** — Deploy adapter publishes built output to target

### Key Patterns
- **Strict module boundaries:** No cross-package imports except through `@osp/core`. Plugin cannot touch pipeline packages.
- **Zod schemas** for all external config and persisted outputs — see `packages/shared/src/schemas.ts`
- **Pure functions** in domain packages (parser, diagnostics); adapters are boring and explicit
- **Structured error/issue codes** — no bare strings or ad-hoc errors
- **Thin shells:** Plugin and CLI are thin wrappers; all business logic lives in packages
- **TypeScript strict mode** everywhere

## Engineering Rules

These rules are enforced by test (`vibe-coding-rules.test.ts`):

- Read the package README before editing code in that package
- Keep changes inside one module or one pipeline slice whenever possible
- Every new external input must have a Zod schema
- Every new error path must use a structured error code or issue code
- No bare `any`
- Keep files under 300 logical lines
- If a real bug is found, add or update a fixture in `fixtures/`
- Unsupported features must be reported explicitly, never swallowed
- New config values need defaults and schema coverage
- Do not move business logic into UI code or the Obsidian plugin

**Disallowed:** Rewriting parser+diagnostics+UI in one task; changing public interfaces without updating dependents; mixing refactors with new features across multiple layers.

## Testing

- **Vitest** with TypeScript ES2022 modules
- Test files: `**/*.test.ts` co-located with source
- **12 fixture vaults** in `fixtures/` for deterministic test scenarios
- `test_vault/hw` serves as the real-world smoke-test vault
- Architecture enforcement tests validate module boundaries
- Plugin tests use mocked Obsidian API

## Key Config Files

- `pnpm-workspace.yaml` — workspace packages
- `tsconfig.json` — project references to all packages/apps
- `vitest.config.ts` — test configuration with aliases
- `docs/prompts/engineering-rules.md` — full engineering rules
- `docs/prompts/task-template.md` — work item template
