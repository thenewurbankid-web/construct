# Construct's execution model: code vs. LLM vs. human

This is the real, current inventory of every `construct` command/capability
and how it actually executes today: deterministic code, an LLM call (and
which one), or a human approval gate — re-derived directly from the code as
of Epic 6 (#96, the "AI Toolkit" epic) landing, not copied from that epic's
issue body verbatim. Re-verify this against `src/cli.mjs`'s command dispatch
whenever a new capability is added; a stale version of this table is worse
than none.

## The governing principle (#96)

Construct's own charter (see the README's "Vision" section and this repo's
`CLAUDE.md`) is that Construct is a library of small, deterministic,
non-LLM building blocks. The **only** place an LLM is ever involved is where
a human explicitly opts in with `--llm <provider>` (CLI) or a Settings
capability (UI) — and even then, in one of exactly two shapes:

1. **Execution-class calls** — small, scoped, mechanical: "write this one
   file's real implementation." One call per file, never one call for a
   whole batch. These may route to a local model (Ollama/Qwen Coder) as
   well as a hosted one (Claude).
2. **Plan-analysis-class calls** — whole-feature, high-context reasoning:
   "look at this entire existing feature and propose how to decompose it."
   Exactly one call, always. **Never** allowed to route to a local model —
   enforced in code (`ui/server/src/settings.mjs`'s `updateSettings`
   throws if `planAnalysis` is set to `ollama`), not just left as a UI
   convention.

Locating files, deciding which layers/files to scaffold, and deciding a
feature's shape are **never** delegated to an LLM in either case — that
stays deterministic code, or a human/Claude-in-conversation decision made
*before* any of this runs.

## Providers (`src/llm.mjs`)

| Provider | How it's called | Notes |
|---|---|---|
| `claude` | Shells out to the `claude` CLI (`spawnSync`, headless `-p --output-format text`) | Requires the CLI installed/authenticated locally. Sync under the hood, but `callLlm` always awaits it. |
| `ollama` | `POST {baseUrl}/api/generate` via `fetch`, `stream: false` | No CLI shell-out. Target model + base URL are configurable per call (`{ model, baseUrl }`, defaults `qwen2.5-coder:7b` / `http://localhost:11434`) — never hardcoded. Requires a local `ollama serve` with the model pulled. |

Both share one shape: `callLlm(provider, prompt, options?) -> Promise<string>`,
throwing a `ConstructError` on failure. Adding a new provider means adding
one entry to `PROVIDERS` in `src/llm.mjs` — nothing else in the framework
needs to change to support it.

## Per-command inventory

| Command | Execution | LLM call? | Human gate? |
|---|---|---|---|
| `construct init` | Deterministic (scaffolds `architecture.yml`, `AGENTS.md`, a starter `core` feature) | No | No |
| `construct feature create` | Deterministic | No | No |
| `construct create feature <name>` | Deterministic | No | No |
| `construct create <layer> <name> --feature f [--llm <provider>]` | Deterministic scaffold, always | **Optional, execution-class.** One call, only for that one file, only if `--llm` given | No (review the diff afterward, same as `import`) |
| `construct create layer <name> --feature f --layers ... [--llm <provider>]` | Deterministic scaffold, always | **Optional, execution-class.** One call *per generated file* (not one for the batch), only if `--llm` given | No |
| `construct generate ...` | Same as the `create` forms above — `create` just delegates to `generate` | Same as above | No |
| `construct sync` | Deterministic (regenerates `.dependency-cruiser.cjs` + each feature's `index.ts`) | No | No |
| `construct validate` | Deterministic (architecture/SoC/readability enforcers + public-API drift check) | No | No |
| `construct summarize` | Deterministic, read-only | No | No |
| `construct doctor` | Deterministic, read-only (environment check) | No | No |
| `construct refactor move / rename` | Deterministic, mechanical (relocate + rewrite every importer's path; never touches a file's own content) | No | No |
| `construct research summarize / doctor` | Deterministic, read-only | No | No |
| `construct import <name> ... --from <path> [--llm <provider>]` | Deterministic scaffold + `TODO(import)` breadcrumb, always | **Optional, execution-class.** One call *per generated file*, only if `--llm` given. Never reads the old source file at all unless `--llm` is given. | No |
| `construct import --plan <path> [--llm <provider>]` | Deterministic, batched: runs the same per-unit scaffold (+ optional fill) once per unit in the plan | Same as above, applied uniformly across every unit | No — the plan itself was already human-approved *before* being handed to this command (see `import --route` below, which is how a plan is normally produced) |
| `construct import --route <path>` (standalone wizard) | Deterministic scaffold once a plan is approved | **Always exactly one plan-analysis call** (whole-feature, hardcoded to `claude` — see "Known gap" below) up front. **Optionally** one execution-class fill call per generated file afterward, if the user opts in mid-wizard. | **Yes — hard gate.** Shows the proposed plan and explicitly asks "Approve this plan and build it now? [y/N]" before writing anything. |
| `construct repl` | Interactive shell wrapping every command above | No calls of its own — whatever the dispatched command does | Whatever the dispatched command does |

## The UI layer (`ui/`)

`ui/server`'s Dashboard/Wizard/Pages-Editor features wrap the exact same
core CLI functions in-process (`src/cli.mjs`'s `create`/`refactor`/
`research`/`importCommand`, called directly — never a shell-out to the
`construct` binary) and add **zero LLM calls of their own**: every LLM call
that happens because of a UI action is one of the calls listed in the table
above, just triggered through a form instead of a terminal.

`ui/server/src/settings.mjs` (Epic 6.4/#100) is the one place the UI adds
real logic on top of this: a per-capability provider map,
```
llmProviders: { importFill: 'claude' | 'ollama', createFill: 'claude' | 'ollama', planAnalysis: 'claude' }
```
validated against the real `PROVIDERS` map in `src/llm.mjs` (never a
UI-side copy), with `planAnalysis` hard-rejecting `ollama` in
`updateSettings` itself. Settings only *configures which provider a future
call would use* — it never makes a call by itself.

## Known gap (as of this writing)

`construct import --route`'s wizard (`src/cli.mjs`'s `importRouteWizard`,
driven from the UI via `ui/server/src/wizardSocket.mjs`) hardcodes
`llm: 'claude'` for both its plan-analysis call and its optional per-file
fill — it does **not** currently read `ui/server/src/settings.mjs`'s
`llmProviders.importFill`/`planAnalysis` capability settings at all
(`wizardSocket.mjs` only applies the settings-configured `projectDir`
before starting a session). For `planAnalysis` this happens to already
match the #96 guardrail (`claude`, never a local model) by construction,
so it's not a correctness bug — but it means changing `importFill` in
Settings has no effect on the route wizard's own fill step, only on the
non-interactive `construct import <name> ...` / `--plan` forms and (once
wired) `create`/`generate`'s fill. Worth a follow-up issue if the wizard's
fill step should also respect the configured `importFill` provider instead
of always using `claude`.

`ui/server`'s `/api/create` endpoint does not yet read `createFill` from
Settings either — `construct create`/`generate`'s `--llm` flag (#101) is
CLI-only today; wiring the Dashboard's Create form to it (reading
`llmProviders.createFill` as a default, still overridable) is unstarted.
