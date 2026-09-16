# Construct

**Opinionated architecture for AI-native Next.js applications.**

Construct makes architectural conventions executable. It ships strict defaults and lets each project modify policy through `architecture.yml`.

## Vision

Construct is a framework of **non-LLM lego blocks** — small, deterministic,
code-driven pieces that compose together to build a web app, or refactor an
existing one, according to constraints the project defines (`architecture.yml`).
An LLM is one possible operator of these blocks, not a requirement baked into
them: every block does its job the same way whether a human clicks it, a
script calls it, or an agent invokes it.

**Think cockpit, not autopilot.** The blocks are extended by a UI (`ui/`) so
humans can observe what's happening and collaborate with whatever is doing the
building — construct, browse, and correct, rather than hand the whole thing to
a model and hope. The goal is enough blocks that you can build an app in a few
clicks, or correct an LLM-generated one in a few clicks, instead of re-prompting
and hoping the next generation is right. The same blocks are exposed to LLMs
through an MCP server with **deterministic flows**, so automated development
goes through the same repeatable machinery a human would use by hand — a team
doing the same kind of work over and over shouldn't burn time and tokens
reinventing it each time. The point of building this is to free LLM usage for
actual innovation, not repetitive plumbing.

**The mantra: an LLM understands an example better than an instruction.**
Layers are structured so that one layer's real output becomes the next layer's
concrete example, not an abstract spec to interpret from scratch. Each layer
is mostly code-driven, and calls an LLM only where a deterministic block
genuinely can't do the job (see `import --llm`, the route wizard's analysis
step — the *only* two places in this whole tool that ever call one).

**The hypothesis this project is testing**: if repetitive development work is
broken down into small enough pieces, most of it needs no LLM at all — and
wherever an LLM *is* still needed, its task is small, its guidance is a real
example rather than an instruction, and the framework's own validation
(`IMPORT-001`, the `PAGE-*`/`COMPONENT-*` rules, etc.) catches it immediately
if it goes off the rails, instead of a wrong answer silently shipping.

**Three tiers, one framework** — this is meant to be a genuinely new
development experience, not just a different chat window:
- **Beginner**: chat only (the guided import wizard, the UI's chat interface).
- **Intermediate**: a no-code UI editor — dig into forms, visual trees, drag
  interactions (the Dashboard, the pages/JSX editor, workflow visualization).
- **Expert**: full code, same architecture, same rules, no ceiling.

All three tiers operate on the same underlying blocks and produce the same
kind of output, so moving between tiers — or watching PRs, features, and
commits move through them — stays legible instead of being three unrelated
tools bolted together.

**Everything is feature-based** on purpose: business logic lives *in* the
code's own architecture (the 7-layer feature structure), not scattered across
prose instructions an LLM has to re-derive intent from every time — the
architecture itself is the spec. The runtime summarizer (`construct
summarize`) closes the loop by giving an AI (or a human) an on-the-fly,
plain-English summary of what a feature's code actually does, so exploring an
unfamiliar feature is cheap instead of a full read-through every time.

Every new capability in this repo should be judged against this: does it add
a deterministic block, make an existing one more atomic, make the *example*
a layer hands the next one better, or extend the cockpit UI — or is it quietly
routing around this and making the LLM do more work than it needs to?

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
