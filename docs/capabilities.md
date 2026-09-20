# Reusable capabilities ("lego blocks")

A maintained inventory of the small, deterministic building blocks already in the codebase, so new work reuses
them instead of re-implementing them (or asking an LLM to). Update this file when
you add, move or retire a block.

Legend: **Det** = deterministic, no LLM. **Rec** = recommendation (*packaged* = already a clean, single-entry
module; *group next* = worth extracting, filed as an issue; *leave* = fine where it is).

| # | Capability | Where it lives | Consumers | Det/LLM | Rec |
|---|---|---|---|---|---|
| 1 | **AST package**: parse, walk, extract, generate | `src/ast/` (entry `src/ast/index.mjs`; README there) | `src/parser.mjs`, `architecture-enforcer`, `route-resolver`, `frozen-detector`, `prose`, `engine/{pageTransformer,controllerBinder,workflowGenerator,workflowExtractor}`, `ui/server/src/pagesEditor.mjs` | Det | **Packaged** (JSX edit/analysis family) |
| 2 | **Glob matching** (`**` / `*` to RegExp) | `src/glob.mjs` (`globToRegExp`, `matchGlob`) | architecture/readability/SoC enforcers (layer patterns, exceptions), pagesEditor | Det | **Packaged** (replaced 5 inline copies) |
| 3 | **Timing** (`startTimer`, `elapsedSeconds`, `formatDuration`) | `src/timing.mjs` | `cli.mjs`, `import.mjs`, `ui/server/src/commandRunner.mjs` | Det | Packaged already (3 pure functions, no deps) |
| 4 | **LLM provider registry** (`PROVIDERS`, `callLlm`, `stripCodeFence`, Ollama defaults) | `src/llm.mjs` | `import.mjs`, `generators.mjs`, `ui/server/src/{settings,ollama}.mjs` | **LLM** (the one deliberate exception; opt-in via `--llm`) | Packaged already; keep isolated so everything else stays LLM-free |
| 5 | **Transactional writer + context envelope + pipeline** (buffer writes, validate a shadow copy, commit atomically) | `src/engine/{transactionalWriter,envelope,pipeline}.mjs` | `generators.mjs`, `cli.mjs`, the generators in `src/engine/` | Det | Packaged already (`createTransaction`, `createEnvelope/validateEnvelope`, `runPipeline`) |
| 6 | **Zero-LLM generators** (workflow from a state descriptor, controller binding, page transformer) | `src/engine/{workflowGenerator,controllerBinder,pageTransformer}.mjs` | `cli.mjs`, `generators.mjs` | Det | Packaged (now sit on `src/ast`) |
| 7 | **Layer classification + layer graph** (`classifyFile`, `classifyProjectFile`, `loadLayerGraph`, `canImport`, `mergeLayers`, `validateGraph`) | `src/architecture-graph.mjs` (one classifier; `architecture-enforcer.mjs` re-exports `classifyFile`; `parser.classifyLayer` is a thin default-graph shim) | enforcers, `parser.parseFile`/`summarizeFeature`, readability, `pagesEditor` (graph only) | Det | **Packaged**: single graph-driven classifier honoring custom layer patterns and `frozen:` regions |
| 8 | **Exceptions (scoped, time-boxed)** | `src/exceptions.mjs` (`validateExceptionsShape`, `exceptionApplies`, `expiredExceptionViolations`) | the three enforcers (architecture re-exports the names for back-compat) | Det | **Packaged** (replaced 3 near-identical `isExempt` copies) |
| 9 | **Config loading + rule registry** (`loadConfig`, `DEFAULT_RULES`, `normalizeRules`, `layersForFramework`, `aggregateValidation`) | `src/config.mjs`, `src/registry.mjs`, `src/engine/defaultEnforcers.mjs` | CLI, all enforcers, ui/server | Det | Packaged already |
| 10 | **Violation diagnostics** (`makeViolation`, `formatReport`, `ConstructError`, `EXIT_CODES`) | `src/diagnostics.mjs` | everything | Det | Packaged already |
| 11 | **Prose descriptions of code** (TS AST to English) | `src/prose.mjs` | `summarize` | Det | Packaged already (uses `src/ast/tsNodes`) |
| 12 | **Source edit / write-back primitives** (JSX tree, props, snippet patch, auto-map, scope/prop analysis; hash-guarded `patchNode` + enforcement check stay in ui/server) | `src/ast/jsx*.mjs` (typescript-estree; pure edits) + `ui/server/src/pagesEditor.mjs` (glue) | ui/server routes, Pages Editor UI | Det | **Packaged**: Babel removed from `ui/server`; parity proven by golden tests captured from the Babel implementation |
| 13 | **File walk / relative path / write** | `src/fs.mjs` (`walk`, `rel`, `write`, `ensureDir`) | most modules | Det | Leave (tiny) |
| 14 | **Line source for interactive prompts** | `src/line-source.mjs` | `repl.mjs`, `cli.mjs` | Det | Leave |
| 15 | **Import planning / route resolution** | `src/import.mjs`, `src/route-resolver.mjs` | CLI `import` | Det (LLM only on opt-in fill) | Leave; `route-resolver` already uses `src/ast` |
| 16 | **Workflow narrator** (state machine to plain English, Given/When/Then scenarios, health findings; feeds WORKFLOW-002/003) | `src/engine/{workflowNarrator,workflowScenarios,workflowExplain,workflowSource}.mjs`; docs in `docs/workflow-narrator.md` | CLI `research workflow`, `ui/server/src/workflowsViewer.mjs` (`GET /api/workflows/narrative`), architecture-enforcer (WORKFLOW-002/003) | Det | Packaged (built on `workflowExtractor`, no LLM, nothing stored) |
| 17 | **Unit summaries** (structured, LLM-free summary of any project/feature/layer/file/hook/route/rule/package/etc. for bots and humans; pluggable per-kind registry, JSON Schema, token budgets) | `src/engine/unitSummary.mjs` + `src/engine/units/` (facts, machines, registry, kinds); `schemas/unit-summary.v1.json`; docs in `docs/unit-summary.md` | CLI `summarize <ref>` / `--list` / `--usage`, `ui/server/src/unitsApi.mjs` (`GET /api/units`, `/api/units/summary`, `/api/features*`) | Det | Packaged (composes AST, layer graph, enforcers, workflow narrator; MCP-ready pure API, no MCP server yet) |
| 18 | **Live preview + click-to-source** (annotate JSX with `file:line:col` in memory, in-page click bridge, opt-in Vite plugin) | `src/engine/{jsxSourceAnnotator,previewBridge,previewVitePlugin}.mjs` | Cockpit Pages Editor "Live app preview" | Det | Packaged (dev-server only, never modifies source or production builds) |
| 19 | **Scope/binding links** (which page values flow into which props of one element; unbound, undeclared and unused flags) | `src/engine/scopeLinks.mjs` | `ui/server/src/pagesEditor.mjs` (Scope tab) | Det | Packaged (pure; cross-file resolution stays with the caller) |
| 20 | **Workflow editing** (state/transition/context/action/guard edits as exact source-range replacements; context reader) | `src/engine/{workflowEditor,workflowContext}.mjs` | `ui/server/src/workflowsViewer.mjs` (Edit and Context & actions tabs) | Det | Packaged (formatting and comments outside the edit stay byte-identical) |
| 21 | **External-change tracking + text diff** (per-file "changed outside the editor" records; before/after rows with collapsed context) | `src/file-change-tracker.mjs`, `src/text-diff.mjs` (uses `diff`) | `ui/server/src/pageChanges.mjs` (Diff tab) | Det | Packaged (I/O-free; renderer-agnostic view model) |
| 22 | **Allowlisted directory browser** (directories only, realpath-checked against allowed roots) | `src/dir-browser.mjs` | `ui/server/src/dirBrowse.mjs` (folder picker in Settings and the project switcher) | Det | Packaged (security-sensitive: keep it the only path a UI server uses to list folders) |
| 23 | **Project validation as data** and **bounded output buffer** (same enforcers as `construct validate`, returned as rows; last ~500 log lines) | `ui/server/src/validateApi.mjs` (`GET /api/validate`), `ui/server/src/logBuffer.mjs` | Cockpit drawer (Diagnostics, Logs) | Det | Leave in `ui/server` (thin glue over `src/registry.mjs`) |
| 24 | **Execution plan contract** (ordered steps, each a reference to a real flow, with executor tag, expected touches and dependencies; flow registry covering the whole CLI surface; `validatePlan`, `planToCommand`, `planTouches`) | `src/plan.mjs`; `schemas/plan.v1.json` | Research mode (plan pane), the process runtime | Det | Packaged (pure JSON-in/JSON-out; contains, rather than replaces, `src/import.mjs`'s narrower import plan) |

| 25 | **Impact analysis** (blast radius of a change: features/layers/files touched, why each is implicated, shared-component warnings, per-entry `derived`/`inferred` provenance) | `src/engine/impact.mjs`; `schemas/impact-report.v1.json`; docs in `docs/impact-analysis.md` | CLI `research impact`, Research mode (#229), PR health (#285, via `impactFromChangedFiles`) | Det | **Packaged** (assembles the layer graph, `units/facts.mjs`, the unit registry and the enforcers over a reverse import index; read-only, MCP-ready pure API) |

| 26 | **Process runtime** (a running plan: the lifecycle as a real XState machine that narrates itself, per-step status keyed to plan step ids, an `ok`/`llm`/`warn` log where every step records whether a model was involved, artifacts collected for approval, pause/resume/cancel/retry, and persistence outside the project so a run survives a restart) | `src/engine/{processMachine,processModel,processStore,processEngine}.mjs`; `schemas/process.v1.json` | The Cockpit's Processes section (#292), the bot runner (#291) | Det | **Packaged** (pure JSON-in/JSON-out, no UI imports; one transaction per step via `transactionalWriter`, so a cancelled or failed step writes nothing; `executeStep` is the seam a runner fills) |

## How to use this file

- Before writing a helper, check the table. If a block exists, import it; if it is nearly right, extend it
  rather than forking it.
- Adding a deterministic block? Give it a single entry point, JSDoc, tests, and a row here.
- Anything that calls an LLM must go through row 4 so the rest of the tool stays repeatable.

## Follow-ups

Babel unification for `pagesEditor`, layer-classifier and exception-handling
consolidation are done.
