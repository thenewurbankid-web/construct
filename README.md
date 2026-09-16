# Construct

**Opinionated architecture for AI-native Next.js applications.**

Construct makes architectural conventions executable. It ships strict defaults and lets each project modify policy through `architecture.yml`.

## Install

```bash
npm install
npm link
```

Or publish the package and install it globally/project-local with npm.

## Initialize a project

```bash
construct init my-app
cd my-app
npm install
construct sync
construct validate
```

Construct does not replace Next.js, TypeScript, ESLint, dependency-cruiser, XState, Stately, or Playwright. It orchestrates architecture policy around them.

## Default architecture

```text
Route → Controller → Workflow → Service → API
             └────→ Page → Component

Workflow → Domain
Service  → Domain
Hook     → Workflow / Service / Domain
```

## Non-negotiable defaults

- Routes are thin and delegate.
- Controllers compose; they do not become business-logic dumping grounds.
- Workflows own application state and flow.
- Hooks own React/application logic only when React context is needed.
- Domain is pure by default.
- Services own network/external effects.
- Pages are presentation-only.
- Components are presentation-only except local UI state.
- Features are isolated behind `index.ts` public APIs.
- One primary module per file.
- Every responsibility has an architectural owner.

## Modifying conventions

Change `architecture.yml`:

```yaml
rules:
  PAGE-004: warning
  PURE-001: off
```

Severity:

- `error` — validation fails
- `warning` — reported but does not fail
- `off` — disabled

Temporary exceptions may be scoped and expired:

```yaml
exceptions:
  - id: LEGACY-001
    path: features/legacy/**
    rules: [PAGE-004]
    reason: Temporary migration
    owner: platform-team
    expires: 2026-12-31
```

## Commands

Three capabilities, each with its own namespace — a friendlier grouping over the same underlying commands, not a second implementation:

```bash
# create — scaffold a feature, a layer, or a whole vertical slice
construct create feature <name> [--dir <path>]
construct create layer <name> --feature <feature> --layers <l1,l2,...> [--dir <path>]
construct create <layer> <name> --feature <feature> [--dir <path>]

# refactor — mechanical, LLM-free moves/renames within the architecture
construct refactor move <name> --feature <feature> --from <layer> --to <layer> [--dir <path>]
construct refactor rename <name> <newName> --feature <feature> --layer <layer> [--dir <path>]

# research — read-only: summarize a feature, or check environment/tooling
construct research summarize [--feature <name>] [--format json|md|compact|prose] [--since <ref>] [--dir <path>]
construct research doctor [--dir <path>]
```

`construct refactor` never rewrites a file's own logic or exported identifier — only its location/name and every other file's import of it (including the moved file's own same-layer imports, re-resolved for its new home). Whether the result is *valid* in its new layer — naming convention, purity, everything else — is `construct validate`'s job, reported immediately after the move so a mismatch shows up right away. There's no persistent activity log: each command prints one clear, scannable line for what it did (`Created ...`, `Moved ... -> ...`), and that line **is** the record — a file that changed without one wasn't done by the tool.

The flat commands below are unchanged and still work — `create`/`refactor`/`research` are just a grouping on top:

```bash
construct init [dir]
construct feature create <name> [--dir <path>]
construct generate <layer> <name> --feature <feature> [--dir <path>]
construct generate layer <name> --feature <feature> --layers <l1,l2,...> [--dir <path>]
construct sync [--dir <path>]
construct validate [--dir <path>]
construct validate --format json [--dir <path>]
construct doctor [--dir <path>]
```

## Build order is enforced, not a convention to remember

`construct generate layer` scaffolds one logical unit across several layers in a single command:

```bash
construct generate layer PriceCheck --feature pricing --layers domain,hook,controller
```

You can list `--layers` in any order — Construct always generates them in dependency order (`domain -> service -> workflow -> hook -> component -> page -> controller`) so each file's imports resolve correctly by the time it's created.

This isn't just a convenience — it's backed by a real rule, `IMPORT-001`: any relative import that doesn't resolve to a file on disk is a validation error, checked both by `construct validate` and at generation time. A controller's template already imports its same-named page, so `construct generate controller X --feature F` fails immediately, with a clear message, if `pages/XPage.tsx` doesn't exist yet — you can't generate out of order and end up with a silently broken import. This is the mechanism, not `construct generate layer`'s ordering alone: any file, generated or hand-written, with a dangling relative import fails `construct validate` the same way.

## Adopting Construct inside an existing project

Construct doesn't need to own your whole repository. `construct init` accepts a directory, so you can scope it to one subdirectory of a larger, unrelated project — no changes required anywhere else in that project:

```bash
# from the root of an existing, non-Construct app:
construct init tools/construct
cd tools/construct && npm install && construct sync
```

Every other command accepts `--dir <path>` to target that subdirectory without `cd`-ing into it first (handy for CI, scripts, or running from the parent app's root):

```bash
construct generate domain PriceCheck --feature pricing --dir tools/construct
construct validate --dir tools/construct
```

`--dir` resolves the same way `cd`-ing in would — walking upward from that path to find the nearest `architecture.yml` — and every command still only ever reads or writes inside that project; nothing outside it is touched.

## AI-agent workflow

Agents should read `architecture.yml`, make the smallest local change, and run validation. JSON diagnostics expose rule ID, severity, file, line, message, rationale, expected boundary, and suggested fix.

## Architecture source of truth

`architecture.yml` is policy. Construct's implementation provides generators, validation, CLI orchestration, diagnostics, and integration configuration. This is deliberately opinionated but modifiable.

## Tooling

`tools/github-comment-bridge/` is a standalone, separately-run poller (own `package.json`, not part of the Construct CLI) that lets a human dispatch a real `claude` CLI run by posting a `/claude <instruction>` comment on a GitHub issue. See its own README for setup and the exact trigger syntax.
