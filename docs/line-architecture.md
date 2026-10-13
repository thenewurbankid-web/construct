# Line architecture rules (the `line` profile)

Step ca1 of the Line plan. Construct enforces Line's framework architecture through a validation
profile named `line`. A project selects it with `preset: line` in `architecture.yml`, or a single
run selects it with `construct validate --profile line`. Without either, `construct validate` keeps
running the strict-nextjs enforcers exactly as before.

- Contract (layout, rule ids, sentences, config): `packages/core/profiles/line/contract.mjs`
- Static checks: `packages/core/profiles/line/checks.mjs`
- Enforcer: `packages/core/profiles/line/index.mjs` (`validateLine`, `LINE_ENFORCERS`)
- Profile registry: `packages/core/profiles/index.mjs` (`PROFILES`, `selectProfile`)
- Fixtures: `packages/core/profiles/line/fixtures/passing` (a complete mini Line project), plus one failing project
  per rule, `packages/core/profiles/line/fixtures/LINE-*`
- Tests: `test/line-profile.test.mjs`

Every check is static. It reads and parses files, never runs project code, never calls a model and
never writes.

## Project layout

```
<library>/                  complete, usable items every feature builds on
  components/  pages/  workflows/  fixtures/
<features>/<name>/          one feature: a collection of pages
  components/  pages/  workflows/  fixtures/  spec.md
line/                       Line's own state: plans, memory, session state (written only by the writer)
```

- `<library>` and `<features>` are `library` and `features` by default. When the project has neither
  folder at its root but has `src/library` or `src/features`, those are used. Both can be set
  explicitly in `architecture.yml`.
- An item is any code file (`.ts .tsx .js .jsx .mjs .cjs .mts .cts`) under a kind folder, plus `.json`
  files under `fixtures/`. Tests (`*.test.*`, `*.spec.*`), stories (`*.stories.*`) and `index.*`
  barrels are not items.
- `spec.md` is the user's spec for the feature. It is not an item and needs no base.
- A feature is a module (#935): it owns its items, and `<features>/<name>/index.ts` is its public
  index. What the index exports is all another feature may import from it, and only through the
  index (`import { CartLink } from '../../cart'`), never from a file inside it. Its fixtures are
  scoped to it: a page sees its own feature's fixtures, the fixtures exported by the features it
  imports, and the library's. `moduleScope(root, feature)` (packages/engine/line/moduleScope.mjs)
  reads one feature as a module: what it declares, exports and imports, and the fixtures it sees.

### Base links and routes

A feature item names its library base with one pragma:

```ts
// @line-base components/Button
```

```json
{ "$lineBase": "fixtures/user", "id": "u1" }
```

An array fixture carries its base by wrapping its rows (the form `line.baseOn` and `line.setBase`
write, and the form Line's fixture readers unwrap):

```json
{ "$lineBase": "fixtures/products", "value": [{ "id": "p1", "name": "Shirt" }] }
```

The value is `<kind>/<path>` relative to the library (a leading `library/` is accepted). It resolves
to the file itself, the file with a code or JSON extension, or a folder's `index` file.

A feature page may declare the route it serves with `// @line-route /orders`; LINE-OWNER uses it to
catch two features claiming the same page.

### Configuration

```yaml
version: 1
preset: line
line:
  library: src/library          # optional, see above
  features: src/features        # optional
  state: line                   # Line's own state folder (default line)
  writers:                      # files allowed to call fs write functions: Construct's writer
    - packages/writer/**
  writerExempt:                 # default: tests (**/*.test.*, **/*.spec.*, **/test/**, **/tests/**, **/__tests__/**, **/e2e/**)
    - "**/*.test.*"
  rules:                        # per-rule severity: error | warning | info | off
    LINE-WRITER: warning
exceptions:                     # the usual Construct exceptions also apply to LINE-* rules
  - rule: LINE-DIR
    path: library/components/Legacy.tsx
    reason: being promoted
```

The ordinary `rules:` section still sets the severities of the existing layer rules listed below.

## Rules

Each violation carries the rule's one-sentence "why" plus a full-sentence message that names the
file and says what to do.

### LINE-BASE

- **Message (why):** Every feature item is based on exactly one library item of the same kind, so
  the library stays the single source every feature builds on.
- **Check:** every component, page, workflow and fixture file under `<features>/<name>/` carries
  exactly one base link (`@line-base` in a code comment, `"$lineBase"` in JSON). The link must
  resolve to an existing file in `<library>/<same kind>/`. Missing link, more than one link, a link
  to another kind, a link to a missing library item, and a fixture that is not valid JSON are each
  reported; a bare array fixture is told to wrap its rows as `{ "$lineBase": ..., "value": [...] }`.
  `spec.md` is exempt.

### LINE-OWNER

- **Message (why):** Every page that is not a full library page belongs to exactly one feature, so
  each screen has one owner.
- **Check:** a page-shaped file (inside a `pages/` folder, an app-router `page.tsx`, or a
  `Name.page.tsx`) must sit in `<library>/pages/` or `<features>/<name>/pages/`. A page anywhere else
  is an orphan; a page inside a feature but outside its `pages/` folder is reported with the folder
  it should move to. Pages under test or example folders (`test`, `tests`, `__tests__`, `e2e`,
  `fixtures`, `mocks`, `examples`) are skipped. When pages in two different features declare the
  same `@line-route`, every claimant is reported.

### LINE-DIR

- **Message (why):** A feature uses the library, and uses another feature only through what that
  feature exports from its public index, and the library never depends on a feature, so features stay
  independent modules and items can be promoted.
- **Check:** every import, type-only import, re-export, dynamic `import()`, `require()` and
  `import("x")` type in a library or feature code file is resolved. Relative specifiers resolve
  against the file; `@/`, `~/` and `#/` aliases and `src/`-less forms resolve against the library
  and features folders. A feature may import another feature only through that feature's folder or
  its index file (`<features>/<other>/index.ts`), and every name it imports must be exported there.
  A deep import into another feature's files, a feature with no index, a name the index does not
  export, a stale export line (a module that no longer exists) in an index another feature imports,
  and a library file reaching into any feature are reported. Allowed:
  `import { CartLink } from '../../cart';`; reported: `import { CartLink } from '../../cart/components/CartLink';`.

### LINE-WRITER

- **Message (why):** Every file write goes through Construct's writer, so project files are checked
  and approved and Line's own state is written atomically and logged.
- **Check:** in every code file of the project (except `writerExempt` and `writers`), the bindings
  through which `fs`, `node:fs`, `fs/promises`, `node:fs/promises`, `fs-extra` and `graceful-fs` are
  reached are tracked: default, namespace and named imports, `promises`, `require()`, dynamic
  `import()` and destructuring. Every use of a function that writes, creates, moves or removes files
  is reported: `writeFile`, `appendFile`, `mkdir`, `mkdtemp`, `rm`, `rmdir`, `unlink`, `rename`,
  `copyFile`, `cp`, `symlink`, `link`, `truncate`, `chmod`, `chown`, `utimes`, `write`,
  `createWriteStream` (and the `Sync` forms), plus fs-extra's `outputFile`, `writeJson`, `ensureDir`,
  `copy`, `move`, `remove`, `emptyDir` and friends. A named binding passed on as a value is reported
  too. A method of the same name on any other object (`writer.write(...)`, `process.stdout.write`)
  is not.
- Construct's own writer is `packages/engine/transactionalWriter.mjs` over `packages/core/fs.mjs`
  (`write`). A Line project lists its adapter to that writer under `line.writers`; nothing else may
  touch the disk.

### LINE-SHARED

- **Message (why):** Every app and package uses the one shared module for each concern instead of
  keeping its own copy, so a fix or an improvement lands everywhere at once.
- **Check:** for each concern in the Shared modules table below, a code file outside the owner
  packages (found by the nearest `package.json` name) is a copy when it imports a library only the
  owner may use, contains a string only the owner may use (a model endpoint such as `:11434` or
  `api.anthropic.com`), or exports a function with one of the owner's signature names. Tests are
  exempt (`line.writerExempt`). `line.sharedOwners: { <concern>: [package names] }` adds owners. The
  message names the shared module to use.
- The signals are deliberately narrow: they catch provider calls, SDK imports and same-named
  re-implementations, not an algorithm rewritten under other names. A copy found by review is added
  to the concern's `declares` or `strings` in `contract.mjs` (`SHARED_CONCERNS`).

### LINE-MODULE

- **Message (why):** Every module has a typed contract, a mock and its own tests, and other modules
  use it only through its name, so any module can be swapped for its mock, tested alone and fall back
  when it is down.
- **Check:** a package is a folder with a `package.json` directly under a `line.packageRoots` folder
  (default `packages`; `@scope/name` too). Each package needs (a) a typed contract: `contract.*`,
  `types.*` or a `.d.ts` at its root or in `src/` (a `.js`/`.mjs` contract must hold a JSDoc
  `@typedef` or `@callback`), or a `types`/`typings` entry in its package.json naming a real file;
  (b) a mock: `mock.*`, `mocks.*`, `*.mock.*` or a `__mocks__/` folder; (c) its own tests:
  `*.test.*`, `*.spec.*`, or a `test/`, `tests/` or `__tests__/` folder inside it. Each missing piece
  is one finding on `<package>/package.json` line 1. (d) A file in a package that imports another
  package by a relative path, or by a subpath that package's `exports` does not list, is reported at
  the import; tests (`line.writerExempt`) may reach into what they test.

## Shared modules

The owner's rule: the best module from each app becomes the shared one, and every other app and
package switches to it. File writes are checked by LINE-WRITER; the rest by LINE-SHARED.

| Concern | Module that wins (path) | Must switch to it | Static signals of a copy |
|---|---|---|---|
| AI decisions (model calls) | `@mx/reason` (vision-architect-pipeline `runs/core-ship/packages/reason`) | Cockpit (`packages/core/llm.mjs`, `machine.mjs`, `repl.mjs`, `decision-provider.mjs`, `ui/server/src/ollama.mjs`), Studio export, Trace (`src/ai/provider.mjs`), GateLM, Morpheus CLI and benches | SDK imports (ollama, @anthropic-ai/sdk, openai, @google/genai, ...), endpoint strings (`:11434`, `api.anthropic.com`, `api.openai.com`, ...) |
| Plans and tool calls | `@mx/plan` (`runs/core-plan-api/packages/plan`) | Construct's `packages/core/plan.mjs` (createPlan), Cockpit, Studio, Oracle | exports named createPlan, addStep, updateStep, approveStep, runNext, planStatus |
| Tool registry | `@mx/plan` `registry.ts` (`defineTool`, `createRegistry`, `toolCatalog`); owner to confirm it is "the one registry" | Construct `command-registry.mjs` and any app registry | exports named defineTool, createRegistry, createToolRegistry, registerTool, toolCatalog |
| File writes | Construct's writer (`packages/engine/transactionalWriter.mjs` over `packages/core/fs.mjs`) | every package (see LINE-WRITER violations) | fs write calls (LINE-WRITER) |
| User-facing English | Construct's summarize block (`packages/core/summarize.mjs`, `prose.mjs`), to be built on Smith (`~/Desktop/smith`, `atomic-codemod` to-english.js) in cu2/cs1 | Construct engine narrators, Trace `summary-blocks.mjs`, Oracle replies | imports of smith or atomic-codemod outside it; exports named toEnglish, toPlainEnglish, plainEnglish, narrate* |
| Page matching | Trace's matcher (`construct/trace/src`: `extract.mjs`, `match.mjs`, `transforms.mjs`, `pagemap/classify.mjs`, `pagemap/collapse.mjs`, `structural-gate.mjs`) | Morpheus (`src/match/matcher.ts`), GateLM, Import | exports named structuralGate, applyStructural, structuralRows, collapsePageMap, classifyPage, matchPage(s), pageMap |
| Architecture check | `construct validate` (`packages/core`: `validate.mjs`, `rules/`, `profiles/`) | every app's own lint-style architecture checks | imports of dependency-cruiser or eslint-plugin-boundaries outside Construct |

### LINE-LAYOUT (added with the layout)

- **Message (why):** A Line project keeps its items in the library and in feature folders with a
  fixed set of kinds, so every item can be found, linked and checked.
- **Check:** entries directly under `<library>` must be kind folders (or `README.md`); entries
  directly under `<features>` must be feature folders; entries directly under a feature must be kind
  folders, `spec.md` or `README.md`. A project with neither folder gets one finding saying it is not
  laid out as a Line project yet. This rule was not in the ca1 brief; it is the static form of the
  layout above, and LINE-BASE depends on it.
- **Stray source files (experiment fix, 11 Oct):** once the project has a library or a features
  folder, a source file anywhere else is an error ("The source file "components/OrderButton.tsx" is
  outside library/ and features/, so Line cannot check or reuse it; move it into the library or into
  the feature that uses it."). Allowed: files directly at the root or in `src/` (config and entry
  files), `line.appFolders` (default `app`, `config`, `scripts`, `public`, `types`, `test`, `tests`,
  `__tests__`, `e2e`; also under `src/`; a project adds its own, e.g. `appFolders: [server]`), Line's
  state folder, the package roots, test and example folders, pages (LINE-OWNER reports those), tests,
  stories and `.d.ts` files. Typed fix: move it into the feature that alone imports it (with a base),
  else into the library's kind folder. When the stray file only exists in a refused change (a move to
  `components/`), the fix is one `line.amend` step that carries the change and the fix together.

### Existing layer rules that still apply

Line items are checked with Construct's existing per-layer rules, as the matching layer, through
the same `detectLayerViolations` that `construct validate` uses (same wording, same `rules:`
severities, same exceptions):

| Line kind   | Layer       | Rules                                                                                     |
|-------------|-------------|-------------------------------------------------------------------------------------------|
| components  | component   | COMPONENT-001, -002, -003, -005, -006                                                     |
| pages       | page        | PAGE-001 to PAGE-006; PAGE-008, PAGE-009 when opted in                                    |
| workflows   | workflow    | WORKFLOW-001 (no React/UI); WORKFLOW-002 to -004 and STATE-001 when opted in              |
| all three   |             | TYPE-002 when opted in                                                                    |
| fixtures    | none        | LINE-BASE only                                                                            |

The strict-nextjs folder rules do not apply to a Line project: ROUTE-*, CONTROLLER-*, SERVICE-*,
DOMAIN-*, HOOK-*, EXPR-*, the SOC-001 feature-skeleton and unclassified-folder checks, SLICE-*,
MODULE-001, READ-* and DRY-001 assume the `features/<name>/<layer>/` Next.js layout. LINE-LAYOUT,
LINE-DIR and LINE-OWNER take their place. Files that do not parse are reported once as a
PARSE-ERROR warning, because the Line rules could not check them.

## Current violations

Run read-only on 2026-10-11 with `validateLine(<root>)`, default config (no `architecture.yml` in
any target, so tests are exempt from LINE-WRITER and no writer is allowlisted). None of these repos
is laid out as a Line project yet, so each also gets the one LINE-LAYOUT "no library/ or features/
folder" finding; LINE-BASE and LINE-DIR have nothing to check there. Nothing was changed in them.
The per-package totals below count LINE-WRITER, LINE-OWNER and LINE-LAYOUT; LINE-SHARED (added
later in ca1) is listed across all apps in its own section at the end.

### runs/core-ship/packages/reason (4 findings)

- LINE-WRITER, 3 in 1 file: `node.ts:27` mkdirSync, `:28` writeFileSync, `:29` renameSync (the
  ledger store's tmp + rename write).
- LINE-LAYOUT, 1.

### runs/core-ship/packages/gatelm (125 findings)

- LINE-WRITER, 124 in 33 files. Most are data, training and eval scripts writing their outputs:
  - `crawl/projectCrawl.ts` 16 (mkdir, write, rename, append, rm)
  - `loop/loop.ts` 14 (write, symlink, rename, append)
  - `rag/holdout.ts` 14 (write, rename, rm)
  - `netlist/verify.ts` 10 (mkdtemp, cp, symlink, copy, rm)
  - `netlist/encode.ts` 5, `name/nameLines.ts` 5, `loop/rewardData.ts` 5
  - `dev/import.ts` 4, `dev/service.ts` 4, `recognize/dataset.ts` 4, `registry/build.ts` 4,
    `data/mixHoldout.ts` 4
  - `data/generate.ts` 3, `decompose/measure.ts` 3, `netlist/smoke.ts` 3, `netlist/tokenize.ts` 3
  - `api/real.ts` 2, `data/mix.ts` 2, `decompose/census.ts` 2, `netlist/emitMeasure.ts` 2,
    `recognize/staticEval.ts` 2, `tokenizer/tokenize.ts` 2
  - 1 each: `contract/build.ts`, `contract/summarizeMissing.ts`, `data/scanLibrary.ts`,
    `demo/build.ts`, `demo/page.ts`, `loop/blocklist.ts`, `loop/jevLine.ts`, `loop/jevValidate.ts`,
    `loop/rag.ts`, `netlist/evalSamples.ts`, `tokenizer/bpe.ts`
- LINE-LAYOUT, 1.

### runs/core-plan-api/packages/plan (5 findings)

- LINE-WRITER, 4 in 1 file: `writer.ts:56` mkdir, `:59` writeFile, `:60` rename, `:62` appendFile.
  This is the plan package's own file writer, which its header says Construct's transactional
  writer replaces at integration (cu1/cu3). Until then it is the one file a Line project would list
  under `line.writers`.
- LINE-LAYOUT, 1.

### construct/trace (489 findings)

- LINE-WRITER, 470 in 145 files:
  - `src/` 62 in 21 files: `pagemap/` 10 (service 7, store 3), `import-wizard-routes.mjs` 7,
    `inspector/` 7 (preview 5, history 1, state 1), `deploy/` 6 (contracts-lock 4, prod-modules 2),
    `reset.mjs` 5, `build-info.mjs` 4, `pipeline.mjs` 4, `contract.mjs` 3, `demo-check.mjs` 3,
    `drift-notify.mjs` 3, `drift-policy.mjs` 3, `ai/` 3 (bench, context, index),
    `write-transaction.mjs` 2 (Trace's own writer, the candidate for `line.writers`),
    `adapter-store.mjs` 1, `viewmodel.mjs` 1
  - `scripts/` 65 in 7 files (deploy-local 27, pagemap-shots 16, stage 14, apis-to-openapi 5,
    mark-real-page 1, mark-real-page-2 1, pagemap-review 1)
  - `eval/` 32 in 11 files; `tools/feature-grouper/subframe.mjs` 1
  - `deploy/` 186 in 63 files and `deploy-stage/` 124 in 42 files: these are copied release
    snapshots of `src/` and `scripts/`, not separate code
- LINE-OWNER, 18: `subframe-app/src/pages/` has 3 pages with no feature
  (PortfolioHealthFigmaRebuild, PortfolioHealthFigmaRebuild2, RedesignedPortfolioHealth); the other
  15 are the same three pages inside the `deploy/` and `deploy-stage/` snapshots.
- LINE-LAYOUT, 1.

Excluding the release snapshots, Trace's live code has 160 LINE-WRITER findings in 40 files and 3
orphan pages.

### LINE-SHARED: copies of a shared module

Run read-only with `validateLine(<root>, { rules: ['LINE-SHARED'] })` over every app: Construct and
Cockpit (a clean checkout of construct `84295c94`: packages, ui, studio-export), Trace (release
snapshots `deploy/` and `deploy-stage/` left out), vision-architect-pipeline `runs/core-ship`
(Morpheus CLI, Studio, GateLM, Oracle and the other packages; nested `runs/` left out) and
`runs/core-plan-api/packages/plan`. 41 copies:

- **AI decisions, should use `@mx/reason` (37):**
  - Construct and Cockpit (8): `packages/core/llm.mjs:19`, `packages/core/machine.mjs:19` and `:214`,
    `packages/core/repl.mjs:127`, `packages/studio/bin/doctor.mjs:8`, `studio-export/bin/doctor.mjs:8`,
    `studio-export/src/models.mjs:39`, `ui/server/src/ollama.mjs:11` (each talks to `:11434` itself).
    `packages/core/decision-provider.mjs` has no endpoint of its own (it goes through `llm.mjs`), so
    it is not flagged, but it is the same concern and moves with `llm.mjs`.
  - Trace (9): `src/ai/provider.mjs:25, 77, 105, 172, 196` (Ollama and Anthropic),
    `src/demo-server.mjs:36`, `eval/ai-eval.mjs:22`, `tools/feature-grouper/embed.mjs:134, 172`.
  - Morpheus CLI and Studio (`runs/core-ship/src`, 8): `src/llm/anthropic.ts:1-2` (imports
    `@anthropic-ai/sdk`), `src/llm/providers.ts:13`, `src/cli/lazyBench.ts:104`,
    `src/cli/morpheusBench.ts:62`, `src/cli/slotsTrial.ts:54`, `src/lazyBench/fullLog.ts:93`,
    `src/lazyBench/mcp.ts:44`.
  - GateLM (7): `crawl/summarize.ts:59`, `loop/jevValidate.ts:20`, `loop/loop.ts:42`, `loop/rag.ts:14`,
    `name/nameLines.ts:21`, `netlist/smoke.ts:10`, `rag/holdout.ts:24`.
  - Zion (1): `packages/zion/modelConfig.ts:33`.
  - Spikes (4): `docs/spikes/spike.mjs`, `spike2.mjs`, `spike3.mjs`, `spike4.mjs` (throwaway; delete or
    exempt).
- **Plans, should use `@mx/plan` (1):** Construct `packages/core/plan.mjs:625` exports its own
  `createPlan()`.
- **User-facing English, should use the summarize block (2):** Construct
  `packages/engine/processMachine.mjs:321` `narrateProcessLifecycle()` and
  `packages/engine/workflowNarrator.mjs:152` `narrateMachine()`.
- **Page matching, should use Trace's matcher (1):** Morpheus `runs/core-ship/src/match/matcher.ts:113`
  exports its own `matchPage()`.
- Tool registry and architecture check: no copy found by the static signals. Oracle and
  `@mx/plan` had no findings.
