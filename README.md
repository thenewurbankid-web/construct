# Construct

![version](https://img.shields.io/badge/version-0.8.0%20baseline-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

**AI guesses. Construct computes.**

Asking a model to build or refactor your app costs tokens every time, and a
wrong answer can slip in silently. Construct is the other half: small,
deterministic blocks that do the same job the same way, every time, under
rules you write down.

- **Blocks, not guesses.** Create, move, rename, validate, summarize and review code with commands that need no model. Same input, same result, zero tokens.
- **Your rules, enforced.** One file, `architecture.yml`, says where things live. `construct validate` tells you, with the reason and the fix, when code breaks a rule.
- **A cockpit, not an autopilot.** A web Cockpit lets you browse, preview, plan, review and correct, with a person always in the loop.

Status: version 0.8.0 is the planned baseline. How versions are numbered is in
[docs/VERSIONING.md](docs/VERSIONING.md). What changed is in [CHANGELOG.md](CHANGELOG.md).

## Quickstart (about 60 seconds)

You need Node 20 or newer.

```bash
git clone https://github.com/thenewurbankid-web/construct.git
cd construct && npm install && npm link      # puts `construct` on your PATH

construct init my-app                        # a new project with the rules already in place
cd my-app && npm install
construct validate                           # checks the code against architecture.yml
```

A fresh project passes. `construct validate` exits 0 and may print warnings,
each with a reason and a fix. Now open the Cockpit on that project (two
terminals):

```bash
cd construct/ui/server && npm install && npm start     # backend, port 4000
cd construct/ui/client && npm install && npm run dev   # frontend, port 3000
```

Open http://localhost:3000 and pick your project. On your own machine it needs
no login and listens only on localhost. For a shared server, see
[Run the Cockpit](#run-the-cockpit).

## What you can do

Three surfaces over the same blocks. Each is listed on its own.

### CLI

| Command | What it does |
|---|---|
| `construct init` | Start a project, or adopt Construct in a subfolder of an existing one |
| `construct validate` | Check code against your rules, with the reason and the fix (`--format json` for scripts) |
| `construct create ...` | Scaffold a feature, a layer, or a service from an OpenAPI spec |
| `construct refactor ...` | Move or rename a file, and update every import of it |
| `construct research ...` | Read-only: summarize, explain workflows in plain English, compute the impact of a change, run a doctor check |
| `construct summarize` | A plain summary of any feature, file, route or rule |
| `construct review <base> <head>` | Pull request health between two git refs, without a model |
| `construct import ...` | Bring an old file or a whole route into the architecture |
| `construct template ...` | Named, reusable plans |

Run `construct` with no arguments for the full list and every flag.

### Cockpit (web UI)

| Area | What it does |
|---|---|
| Browse and preview | Pages, components and features, with a live preview of your app and click to jump to the code |
| Edit | Pages editor, workflow editor (states and transitions, saved as a small source diff), Monaco source view |
| Plan and run | Turn a ticket into a checked plan, then run it as a process you can watch, pause and approve |
| Review | Pull requests grouped by feature and layer, with findings split into mechanical fixes and conversations |
| Tests | Generated Playwright tests per scenario, clone one to edit it in plain steps |
| Save | Commit from the Cockpit with a message that counts the impact |

### Core (the library)

| Block | What it does |
|---|---|
| Rule engine | Layer, boundary, purity, readability and workflow rules, all set in `architecture.yml` |
| Generators | Deterministic scaffolds for every layer, plus OpenAPI to RTK Query services |
| Impact and summaries | The blast radius of a change, with each entry marked derived or inferred |
| Plans and processes | A plan schema, a process runtime with logs and artifacts, and an approval gate |
| PR health engine | The indicators behind `construct review` |
| Frameworks | Next.js App Router and a client-routed React SPA, with the same rules on both |

A model is optional. `--llm <provider>` on `import` and `create` fills a file
using Claude or a local Ollama model, one small call per file, and only when
you ask.

## Run the Cockpit

**Locally.** Use the two commands in the Quickstart. Everything is served from
your machine and only you can reach it.

**Hosted, for a team.** Any non-local address requires GitHub login, and only
the GitHub accounts you list are let in. You need a GitHub OAuth app and
these settings, given as environment variables (never committed):

```bash
PUBLIC_HOST=<your ip or domain> \
CONSTRUCT_GITHUB_CLIENT_ID=<oauth app id> \
CONSTRUCT_GITHUB_CLIENT_SECRET=<oauth app secret> \
CONSTRUCT_ALLOWED_LOGINS=<comma-separated github logins> \
tools/dev/run-hosted.sh
```

The script prints the callback URL to register on your OAuth app. Details,
every option and the security notes are in [ui/README.md](ui/README.md). A
setting that confines the hosted Cockpit to one workspace folder is in review
and is not part of this baseline.

## Docs

- Documentation site: https://thenewurbankid-web.github.io/construct/ (the latest docs; each release will also keep its own version of the docs, see [docs/VERSIONING.md](docs/VERSIONING.md))
- [docs/](docs/): architecture, execution model, impact analysis, PR health, unit summaries, workflow narrator, design
- [ui/README.md](ui/README.md): the Cockpit, its login and its tests
- The Cockpit's Help page has short tutorials

## Contributing

Read [CLAUDE.md](CLAUDE.md) first. It sets the working rules: an issue for each
unit of work, comments before and after, a real test for every change, a
Playwright test and screenshot for every UI change, and the deterministic-first
principle from the Vision below. Run `npm test` before you open a pull request.

## Open core

The core library and CLI are open source (MIT). The Cockpit UI (it lives in
`ui/` for now), the MCP server (planned) and the curated predefined envelopes
are proprietary, not part of the open packages. The open packages never depend
on them.

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

## Default architecture

```text
Route → Controller → Workflow → Service → API
             └────→ Page → Component

Workflow → Domain
Service  → Domain
Hook     → Workflow / Service / Domain
```

This layer graph — and every rule in `rules:` — is identical regardless of `project.framework`. The one thing that differs per framework is what a **Route** physically is and how a **Controller** gets wired into it; see [Framework targets](#framework-targets).

## Framework targets

Construct's feature-internal architecture (everything from Controller down: Workflow/Service/Domain, Controller → Page → Component) never changes based on `project.framework` — only the **route layer** does, because that's the one place a real difference in how the two kinds of app actually route requests shows up.

| | `nextjs` (default) | `react-spa` |
|---|---|---|
| Route layer pattern | `app/**/page.tsx` — one file per route folder (Next.js App Router file-system routing: route groups `(name)`, dynamic segments `[name]`) | `src/App.tsx` — one centralized react-router table for the whole app |
| How a controller gets registered as a route | A physical `app/<route>/page.tsx` imports the controller and renders it as the page's default export | A `<Route path="..." element={<XController />} />` entry inside `src/App.tsx` |
| `construct init [--framework ...]` scaffold | `app/page.tsx` | `src/main.tsx` (a real bootstrap: `BrowserRouter` + `createRoot`) + `src/App.tsx`, with the `core` feature's controller already registered as a route |
| `construct import --route <url>` entry resolution | Walks `app/` for the folder owning `page.tsx`, matching route groups/dynamic segments (`src/route-resolver.mjs`) | Parses `src/App.tsx`'s `<Route>` table for the controller name registered at that URL, then locates it under `features/*/controllers/` |

Everything else — every generator, every rule, the controller's own composition (it still imports and renders a same-named `Page` from the feature's `pages/` folder either way, since that's Construct's own convention, not Next.js's) — is identical between the two targets. Set it in `architecture.yml`:

```yaml
project:
  framework: react-spa   # or nextjs (default)
  language: typescript
```

`fixtures/architecture-valid-react-spa/` is a complete, real, checked-in worked example — `construct validate` passes against it with zero errors — showing the shape end to end: `architecture.yml`, `src/main.tsx` + `src/App.tsx`, and a full `widget` feature slice.

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
construct create service <name> --feature <feature> --openapi <spec> [--dir <path>]

# refactor — mechanical, LLM-free moves/renames within the architecture
construct refactor move <name> --feature <feature> --from <layer> --to <layer> [--dir <path>]
construct refactor rename <name> <newName> --feature <feature> --layer <layer> [--dir <path>]

# research — read-only: summarize a feature, or check environment/tooling
construct research summarize [--feature <name>] [--format json|md|compact|prose] [--since <ref>] [--dir <path>]
construct research impact <unit-ref>... [--files a,b] [--since <ref>] [--ticket <text>] [--depth N] [--format json|markdown] [--dir <path>]
construct research doctor [--dir <path>]
```

`construct research workflow <feature> [<file>] [--format prose|md|json|scenarios]` explains a feature's XState workflows in plain English (each state, every start-to-end scenario, health findings), derived from the real source every time with no LLM — see `docs/workflow-narrator.md`.

`construct summarize <ref> [--detail brief|standard|full] [--format json|markdown]` (and `--list`, `--usage`) returns a deterministic, LLM-free summary of any project, feature, layer, file, hook, workflow, route, rule or package, sized for a bot or a teammate — see `docs/unit-summary.md`.

`construct research impact <ref>... [--files a,b] [--since <ref>] [--ticket <text>] [--depth N] [--format json|markdown]` computes the blast radius of a change: which features and layers it touches, why each file is implicated, what is shared across features, and what your rules already say about those files. Every entry is marked `derived` (computed from the graph) or `inferred` (reached only from a seed that was guessed from ticket text or proposed by a model), so you can see exactly where judgement entered — see `docs/impact-analysis.md`.

`construct review <base> <head> [--plan <file>] [--features a,b] [--format json|markdown]` reports pull request health between two git refs with no model: what changed by feature and layer, changes nobody explained, rule regressions, public-surface changes and the flow diff, with findings split into mechanical fixes and conversations — see `docs/pr-health.md`. `construct template list|show|instantiate` prints named, reusable plans from a folder you point at with `--templates <dir>`; none are bundled.

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

## Service generator: OpenAPI -> RTK Query

`construct create service <name> --feature <feature> --openapi <spec>` compiles a real OpenAPI 3.x spec straight into a working [Redux Toolkit Query](https://redux-toolkit.js.org/rtk-query/overview) `injectEndpoints` file — no LLM involved. [`@hey-api/openapi-ts`](https://heyapi.dev/) parses the spec (`$ref` resolution, `allOf`/`oneOf` composition, ...) into correctly-typed request/response TypeScript; Construct's own deterministic template turns that into RTKQ endpoints:

```bash
construct create service petStore --feature pet --openapi ./openapi/petstore.yaml
```

This writes:

- `features/core/services/client.ts` — the shared `api` (RTKQ `createApi`) and `baseQuery`, re-exported from `features/core/index.ts` so other features can consume it through the public API (`SLICE-002`-clean).
- `features/<feature>/services/<name>/{index.ts,types.gen.ts}` — hey-api's generated types for every operation.
- `features/<feature>/services/<name>Api.ts` — the RTKQ `injectEndpoints` file, one `query`/`mutation` per operation (GET/HEAD -> query, everything else -> mutation), plus its generated `use<Op>Query`/`use<Op>Mutation` hooks.

Which transport `client.ts` instantiates is controlled by `project.dataLayer.provider` in `architecture.yml` — `fetchBaseQuery` (the default), `axios`, or a network-free `mock` adapter for tests/demos:

```yaml
project:
  dataLayer:
    provider: axios   # or fetchBaseQuery (default), or mock
```

Switching providers only ever touches `client.ts` — every generated `services/*.ts` endpoint file calls the same provider-agnostic `buildRequest(method, urlTemplate, data)` helper regardless of which adapter is active. Every operation in the spec needs an explicit `operationId` (used to line up the RTKQ endpoint with the type hey-api generated for it) — a spec without one fails fast with a clear error rather than guessing a name that might not match.

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

## Wrapping frozen, externally-authored UI (Subframe, Figma-to-code, ...)

Some UI is not yours to edit: a design tool (Subframe, Figma-to-code, a shared design system) generates or syncs it, and the team treats it as fixed design output. Construct supports this as a first-class adoption path: **a controller wraps the frozen component** — imports it and forwards props — while all data-fetching, gating and state live in `hooks/`, `workflows/`, `services/` and `domain/`. The design output stays the single source of truth and is never forked.

Declare the externally-authored files in `architecture.yml`. Globs are resolved relative to the project root and may reach *outside* it:

```yaml
frozen:
  - ../../src/subframe-pages-v2/**
  - ../../src/ui-v2/components/**
```

```tsx
// features/cpo/controllers/CpoHomeController.tsx — the whole wrapper
import CpoHome from '../../../../../src/subframe-pages-v2/Cpo/CpoHome';
import { useCpoHome } from '../hooks/useCpoHome';

export function CpoHomeController() {
  const { title, items } = useCpoHome();
  return <CpoHome title={title} items={items} />;
}
```

What `frozen:` changes (and only when it is set — projects without it behave exactly as before):

- **Read-only to Construct.** Every write path — `create`/`generate` (feature, layer, vertical), `import`, `refactor move`/`rename` (as source, destination, or an importing file that would be rewritten), and `pipeline` — refuses to touch a path matching a frozen glob, with an error naming the glob. Frozen globs are references only; nothing Construct writes is ever derived from one.
- **Wrap, don't duplicate.** Three new rules (default `warning`; set `error` to gate CI) flag a layer file that re-authors markup already present in a frozen source: `PAGE-007` (pages), `COMPONENT-004` (components), `CONTROLLER-002` (controllers). Detection is deterministic and AST-based (no LLM), with three signals:
  1. *same name* — the file exports a component with the same name as one exported by a frozen file, without importing it;
  2. *same structure* — the file has at least `minDuplicateElements` (default 6) JSX elements and at least `similarity` (default 0.8) of its element tags are contained in one frozen file's JSX, without importing that file;
  3. *not thin* — the file imports a frozen file but declares more than `maxOwnElements` (default 5) JSX elements of its own.
  Tune per rule, e.g. `PAGE-007: { severity: error, similarity: 0.9 }`, or silence one file with a normal `exceptions:` entry.
- **Frozen files inside the project root** are treated as externally authored and skipped by Construct's layer rules.

Limits: the duplicate-markup check compares JSX element tags, not props/text/styling, and only looks at files under the frozen globs; a controller that re-authors frozen markup with different tags will not be caught. A frozen file *outside* the project root that imports a file you `refactor move` cannot be rewritten by Construct (and is never touched) — update it in its own repository. See `fixtures/frozen-presentation/` for a working example (a good wrapper project and a deliberately bad one).

## AI-agent workflow

Agents should read `architecture.yml`, make the smallest local change, and run validation. JSON diagnostics expose rule ID, severity, file, line, message, rationale, expected boundary, and suggested fix.

## Architecture source of truth

`architecture.yml` is policy. Construct's implementation provides generators, validation, CLI orchestration, diagnostics, and integration configuration. This is deliberately opinionated but modifiable.

## Tooling

`tools/github-comment-bridge/` is a standalone, separately-run poller (own `package.json`, not part of the Construct CLI) that lets a human dispatch a real `claude` CLI run by posting a `/claude <instruction>` comment on a GitHub issue. See its own README for setup and the exact trigger syntax.

## Reusable building blocks

`docs/capabilities.md` inventories the deterministic "lego blocks" already in the codebase (with where they live, who uses them, and what to group next). All AST parsing/walking/extraction/generation lives in one package, `src/ast/` (entry `src/ast/index.mjs`, see its README): `import { extractImports, collectCalls } from './src/ast/index.mjs'`.
