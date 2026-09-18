# Reusable capabilities ("lego blocks")

A maintained inventory of the small, deterministic building blocks already in the codebase, so new work reuses
them instead of re-implementing them (or asking an LLM to). Tracked under issue #104. Update this file when
you add, move or retire a block.

Legend: **Det** = deterministic, no LLM. **Rec** = recommendation (*packaged* = already a clean, single-entry
module; *group next* = worth extracting, filed as an issue; *leave* = fine where it is).

| # | Capability | Where it lives | Consumers | Det/LLM | Rec |
|---|---|---|---|---|---|
| 1 | **AST package**: parse, walk, extract, generate | `src/ast/` (entry `src/ast/index.mjs`; README there) | `src/parser.mjs`, `architecture-enforcer`, `route-resolver`, `frozen-detector`, `prose`, `engine/{pageTransformer,controllerBinder,workflowGenerator,workflowExtractor}`, `ui/server/src/pagesEditor.mjs` | Det | **Packaged in #104** |
| 2 | **Glob matching** (`**` / `*` to RegExp) | `src/glob.mjs` (`globToRegExp`, `matchGlob`) | architecture/readability/SoC enforcers (layer patterns, exceptions), pagesEditor | Det | **Packaged in #104** (replaced 5 inline copies) |
| 3 | **Timing** (`startTimer`, `elapsedSeconds`, `formatDuration`) | `src/timing.mjs` | `cli.mjs`, `import.mjs`, `ui/server/src/commandRunner.mjs` | Det | Packaged already (3 pure functions, no deps) |
| 4 | **LLM provider registry** (`PROVIDERS`, `callLlm`, `stripCodeFence`, Ollama defaults) | `src/llm.mjs` | `import.mjs`, `generators.mjs`, `ui/server/src/{settings,ollama}.mjs` | **LLM** (the one deliberate exception; opt-in via `--llm`) | Packaged already; keep isolated so everything else stays LLM-free |
| 5 | **Transactional writer + context envelope + pipeline** (buffer writes, validate a shadow copy, commit atomically) | `src/engine/{transactionalWriter,envelope,pipeline}.mjs` | `generators.mjs`, `cli.mjs`, the generators in `src/engine/` | Det | Packaged already (`createTransaction`, `createEnvelope/validateEnvelope`, `runPipeline`) |
| 6 | **Zero-LLM generators** (workflow from a state descriptor, controller binding, page transformer) | `src/engine/{workflowGenerator,controllerBinder,pageTransformer}.mjs` | `cli.mjs`, `generators.mjs` | Det | Packaged (now sit on `src/ast`) |
| 7 | **Layer classification + layer graph** (`classifyLayer`, `classifyFile`, `loadLayerGraph`, `canImport`, `mergeLayers`, `validateGraph`) | `src/parser.mjs` (`classifyLayer`, hardcoded next/spa path shapes), `src/architecture-enforcer.mjs` (`classifyFile`), `src/architecture-graph.mjs` | enforcers, `parser.parseFile`, `pagesEditor` (graph only) | Det | **Group next**: two classifiers exist (hardcoded regex in `parser.mjs` vs graph-driven `classifyFile`); consolidate onto the graph (see follow-up issue) |
| 8 | **Exceptions (scoped, time-boxed)** | `src/architecture-enforcer.mjs` (`validateExceptions`, `isExempt`), copies in `readability-enforcer.mjs` / `soc-enforcer.mjs` | the three enforcers | Det | **Group next**: near-identical `isExempt` in 3 files; extract to one module (see follow-up issue) |
| 9 | **Config loading + rule registry** (`loadConfig`, `DEFAULT_RULES`, `normalizeRules`, `layersForFramework`, `aggregateValidation`) | `src/config.mjs`, `src/registry.mjs`, `src/engine/defaultEnforcers.mjs` | CLI, all enforcers, ui/server | Det | Packaged already |
| 10 | **Violation diagnostics** (`makeViolation`, `formatReport`, `ConstructError`, `EXIT_CODES`) | `src/diagnostics.mjs` | everything | Det | Packaged already |
| 11 | **Prose descriptions of code** (TS AST to English) | `src/prose.mjs` | `summarize` | Det | Packaged already (uses `src/ast/tsNodes`) |
| 12 | **Source edit / write-back primitives** (JSX tree, props, snippet patch, hash-guarded `patchNode`, auto-map, enforcement check) | `ui/server/src/pagesEditor.mjs` (Babel + TS compiler API) | ui/server routes, Pages Editor UI | Det | **Group next**: still on **Babel**, a third parser stack whose deps live only in `ui/server`; unify with typescript-estree behind `src/ast`, then move the edit ops into a shared package (see follow-up issue) |
| 13 | **File walk / relative path / write** | `src/fs.mjs` (`walk`, `rel`, `write`, `ensureDir`) | most modules | Det | Leave (tiny) |
| 14 | **Line source for interactive prompts** | `src/line-source.mjs` | `repl.mjs`, `cli.mjs` | Det | Leave |
| 15 | **Import planning / route resolution** | `src/import.mjs`, `src/route-resolver.mjs` | CLI `import` | Det (LLM only on opt-in fill) | Leave; `route-resolver` already uses `src/ast` |

## How to use this file

- Before writing a helper, check the table. If a block exists, import it; if it is nearly right, extend it
  rather than forking it.
- Adding a deterministic block? Give it a single entry point, JSDoc, tests, and a row here.
- Anything that calls an LLM must go through row 4 so the rest of the tool stays repeatable.

## Follow-ups

See the issues referencing #104: Babel unification for `pagesEditor`, layer-classifier consolidation, and
exception-handling consolidation.
