# Dogfooding audit — September 2026

Purpose: for each thing an agent currently does by reading files and
reasoning about this repo, check whether a Construct block already answers
it deterministically, cheaper and more reliably than an LLM re-deriving it.
Every command below was run for real against this repo (mostly
`ui/client`, the one dogfooded Construct feature tree in this codebase) on
commit `62ede45`. Output is trimmed but not edited for content.

## Table

| Work an agent does by reading files and reasoning | Block/command that already answers it | What it saves | Missing to use it today |
|---|---|---|---|
| Open several files to see what a project/feature contains before touching it | `construct summarize --list`, `construct summarize <ref>` | A full-tree read replaced by one ~500-token JSON call; `recommendedFlow` in `--usage` tells the agent the exact next call | Nothing — works today, just isn't habit yet |
| Reason about "what else does this change touch" before a refactor | `construct research impact <ref> [--files a,b]` | Deterministic blast radius (features/files/layers, scored, with reasons) instead of grepping imports by hand | Nothing — works today |
| Read a whole PR diff to judge if it's in-scope, safe, and rule-clean | `construct review <base> <head>` | Unexplained changes, rule regressions, public-surface diff, all pre-computed; an agent doesn't re-derive any of it from the raw diff | Nothing — works today |
| Eyeball a file/feature against the architecture rules | `construct validate` | Exact rule id, file:line, why, expected layer, fix — no judgment calls | Nothing — works today |
| Read a component's source to learn its props (types, required, defaults, JSDoc) | `describeComponent(root, relPath)` (`src/engine/describeComponent.mjs`, react-docgen-backed) | Full, accurate prop docs with no LLM read of the source | **Not wired to any CLI command.** `construct summarize <component>`'s own `props` section is a separate, weaker AST-only pass (member names only, no types/required/defaults) — see evidence below. Only `ui/server`'s REST API (`componentsApi.mjs`) calls the real one today |
| Copy an existing file as a "model" to scaffold a new one in the same shape | `construct template list\|show\|instantiate` | A named, parameterised, reviewable plan instead of copy-paste-and-edit | **No templates ship in this repo.** `template list --templates <dir>` returns `{templates: []}` for any directory that isn't a curated template set — none exists here yet |
| Trace who imports/depends on a file before changing its signature | `summarize <ref> --detail full` → `sections.dependencies.usedBy` | The importer list is already computed; no separate "who calls this" grep | Nothing — works today (it's a field inside summarize's full detail, not a separate `--usage` flag) |
| Hand-write a Playwright spec for a workflow's happy path and edge cases | `construct generate tests <feature>` (from XState `workflowScenarios`) | One locked spec per Given/When/Then scenario, deterministic, no LLM | **`ui/client/architecture.yml` declares no `frozen:`/`nonLayer:` test regions**, so the command refuses on every feature; also **zero features use an XState workflow machine today**, so there is nothing for the narrator/generator to read even once that's fixed |
| Read a feature's XState machine to explain it in plain English | `construct research workflow <feature> [--format scenarios\|prose]` | Given/When/Then scenarios or prose, generated, not paraphrased | Same gap as above — no XState machine exists in `ui/client` to point it at |

## Evidence

**Orient without reading files** — `construct summarize --list --dir ui/client` (trimmed):
```
"kind": "feature", "count": 24
"kind": "component", "count": 157
"kind": "hook", "count": 105
"kind": "service", "count": 65
```

**Feature health in one call** — `construct summarize project --dir ui/client --format markdown` (trimmed):
```
Project client (nextjs): 24 feature(s); 25 error(s), 13 warning(s).
- error: Feature component-docs has 4 error(s).
- error: Feature pages-editor has 5 error(s).
```

**Blast radius before touching a shared file** — `construct research impact features/auth/components/GithubMark.tsx --dir ui/client --format markdown`:
```
Impact ...: 1 feature(s) (auth), 3 file(s) across 2 layer(s), depth 2; 0 rule error(s)
| 1    | features/auth/components/GithubMark.tsx  | component | auth | 0 | derived
| 0.5  | features/auth/components/LoginScreen.tsx | component | auth | 1 | derived — Imports GithubMark.tsx
| 0.33 | features/auth/pages/AuthGatePage.tsx      | page      | auth | 2 | derived
```

**PR health instead of reading a 57-file diff** — `construct review HEAD~5 HEAD --dir ui/client --format markdown` (trimmed):
```
57 files changed across 7 features: 29 findings (2 mechanical, 27 for a conversation).
25 new rule violations on this change (13 already there, not counted).
- CONTROLLER-001 newly violated in features/component-docs/controllers/ComponentsController.tsx
- MODULE-001 newly violated in features/component-docs/domain/ComponentList.ts (4 primary exports, threshold 3)
- ROUTE-001 newly violated in app/components/page.tsx
27 public files changed; no export removed (65 added).
```
This is exactly the reasoning an agent otherwise redoes by reading the diff and the rules by eye — here it is pre-computed, cited by file:line, split mechanical vs. needs-a-human.

**Rule compliance without eyeballing** — `construct validate --dir ui/client` (trimmed):
```
❌ ROUTE-001 app/components/page.tsx:1 — Route does not import a controller.
❌ CONTROLLER-001 features/component-docs/controllers/ComponentsController.tsx:32 — Controller contains non-trivial business logic.
❌ PAGE-006 features/dashboard/pages/DashboardPage.tsx:7 — Page imports a custom hook.
```

**Component props — the gap.** `construct summarize features/dashboard/components/LayerCheckboxes.tsx --kind component --detail full --include props` returns only:
```
"props": [{ "type": "LayerCheckboxesProps", "members": ["selected", "onToggle", "options"] }]
```
No types, no required/optional, no defaults, no descriptions — because `summarize`'s props section is its own lightweight AST pass, not `describeComponent`. `describeComponent` itself (used by `ui/server/src/componentsApi.mjs` for the Cockpit's Components screen) would return exactly that detail from react-docgen, but no CLI path reaches it.

**Templates — empty today.** `construct template list --templates docs` (any directory in this repo):
```
{ "ok": true, "templates": [] }
```
Confirmed in the CLI's own help text: "curated templates load from `--templates <dir>`... none are bundled." An agent scaffolding a new feature slice still copies an existing one as a model rather than instantiating a template.

**`generate tests` — blocked today.** `construct generate tests auth --dry-run --dir ui/client`:
```
Construct error: Refusing to generate tests: architecture.yml does not declare the test regions...
(missing: frozen, nonLayer)
```
And even with that fixed, `construct research workflow auth --format scenarios --dir ui/client` returns "No XState machines found" — no `ui/client` feature has adopted the XState workflow layer this generator depends on.

## Honest verdict

Four of the eight rows are **good enough today, unused only by habit**:
`summarize --list`/`summarize <ref>` for orientation, `research impact` for
blast radius, `construct review` for PR health, and `construct validate`
for rule compliance. These need no code — only for every agent (including
OG) to actually reach for them before reading source, per the "How agents
should orient" section below.

Three rows have a **real, code-shaped gap**: `describeComponent` exists but
isn't wired to any CLI surface a CLI-only agent can call; `template` has no
starter templates to instantiate; `generate tests`/`research workflow
--format scenarios` are blocked on `ui/client` by missing architecture.yml
config and the total absence of an XState-based workflow in this codebase.

## Ranked top 5 (most token-saving first)

1. **Adopt `construct review <base> <head>` as the default before reading
   any PR-sized diff.** Already fully working (see evidence); replaces an
   agent re-deriving scope/rule-regressions/public-surface by eye. No code
   — an orientation habit change, captured below.
2. **Adopt `construct summarize`/`research impact` as the default before
   reading source or reasoning about blast radius.** Already fully
   working; replaces exploratory file reads. No code — orientation only.
3. **Wire `describeComponent`'s full react-docgen output into `construct
   summarize <component>`'s props section** (replacing or supplementing
   the current AST-only pass). Saves a source-file read every time an
   agent needs a component's real prop contract. **Needs code — issue
   filed.**
4. **Unblock `construct generate tests`/`research workflow --format
   scenarios` for `ui/client`**: add `frozen:`/`nonLayer:` test-region
   globs to `ui/client/architecture.yml`, and get at least one real
   feature onto the XState workflow layer so the narrator/generator have
   something to read. Saves hand-writing Playwright specs and workflow
   explanations for every dogfooded feature going forward. **Needs code —
   issue filed.**
5. **Ship a small starter `templates/` set** (feature slice, CRUD layer
   set) so `construct template instantiate` is a real alternative to
   copy-an-existing-file-as-a-model. Saves re-deriving "what does a typical
   feature of this shape look like" from an example each time. **Needs
   code — issue filed.**

Issues filed (milestone `v0.10.0`):
- [#448](https://github.com/thenewurbankid-web/construct/issues/448): Wire `describeComponent` into `construct summarize`'s component props section
- [#449](https://github.com/thenewurbankid-web/construct/issues/449): Unblock `construct generate tests` for `ui/client` (architecture.yml + one dogfooded XState workflow)
- [#450](https://github.com/thenewurbankid-web/construct/issues/450): Ship a small starter `construct template` set for common feature shapes

## How agents should orient

Before reading any source file in this repo, run these three (cheap,
read-only, no LLM):

1. `construct summarize --list --dir <root>` — what exists (features,
   components, hooks, services), and their refs.
2. `construct summarize <ref> --detail brief --dir <root>` for the unit
   you're about to touch — health, layer counts, and a `next[]` list of
   what to look at next, each with the exact CLI call.
3. Before changing a shared file or judging a diff: `construct research
   impact <ref> --dir <root>` (blast radius) or `construct review <base>
   <head> --dir <root>` (PR health) — never re-derive either by reading a
   diff or the import graph by eye.

Only after that should an agent open a source file directly, and then only
the ones the above surfaced as relevant.
