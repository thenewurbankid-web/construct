# Exploration 2026-09: OSS ecosystem, second pass (what we are about to build)

Read-only research, requested by the owner on 2026-09-21 ("we are like JHipster, we embrace OSS and don't
reinvent the wheel"). The first pass, `docs/AUDIT-2026-09-oss-and-spof.md`, audited what we already have; this
pass looks forward, at the features on the v0.9.0 to v0.11.0 roadmap, and asks which OSS tool each one should
wrap. Rules applied: `CLAUDE.md` "Core philosophy" (wrap by default, hand-build only the differentiators,
everything switchable, deterministic before AI), the open-core policy (core open and permissive-only:
MIT/BSD/ISC/Apache-2.0; Cockpit `ui/` proprietary-future; dependencies point one way, Cockpit to core), no
folder-structure changes.

## How to read the evidence labels

This session had **no web or registry access**. Nothing here was fetched. Every fact carries one of:

- **[V]** verified in this repo or in an installed `node_modules` (package.json, lockfile, source read, or a
  light `node` script run for this report; the scripts and their output are quoted where they matter).
- **[K]** from the author's knowledge, **not verified**. This covers every licence, transitive-dependency count,
  maintenance signal and API claim about a package that is *not* installed here. Treat [K] licences as
  "to be confirmed from the package's LICENSE file before the dependency is added" (each sub-issue says so).

No version number, download count or release date is given for a package that is not installed. "Maturity
signal" below is therefore a reasoned signal (who maintains it, what else uses it, whether we already run it),
never a statistic.

Baseline facts read for this report [V]: Node 22.14.0 on the box; core `package.json` depends on
`@hey-api/openapi-ts@^0.97.3`, `typescript@^5.8.3` (5.9.3 installed, Apache-2.0), `@typescript-eslint/typescript-estree`,
`js-yaml`, `diff`, `estree-walker`, `minimatch` (installed 10.2.6, **BlueOak-1.0.0**); `ui/client` has Storybook 10.6.0
(MIT) with `react-docgen@8.0.3` (MIT) and `react-docgen-typescript@2.4.0` (MIT) installed as Storybook's own
dependencies (dev-only); `ui/server` has `express`, `ws`, `cors` and `ipaddr.js@1.9.1` (MIT) only through
`proxy-addr` (transitive, an old 1.x line); `ui/e2e` has `@playwright/test@1.63.0` (Apache-2.0) and
`@axe-core/playwright@4.13.0` (**MPL-2.0**, test-only).

## Summary table

| # | Capability (serves) | Verdict | Winner and smallest first step |
| --- | --- | --- | --- |
| 1 | Component docs (#431) | **ADOPT FOR THE FEATURE** | `react-docgen` behind a `describeComponent(file)` block; first step below was run for real |
| 2 | QA click-and-record (#319) | **SPIKE FIRST** (plus **ADOPT NOW**: Playwright trace on failure) | record in our own preview bridge into our step vocabulary; codegen only as a comparison |
| 3 | Refactor / rename / move (#381) | **ADOPT FOR THE FEATURE** | TypeScript LanguageService `getEditsForFileRename` (no new dependency); ast-grep is a spike |
| 4 | File templates (generators) | **SKIP** (borrow the "blueprint" idea) | keep string-template functions; add per-project override folder later |
| 5 | OpenAPI (#400) | **ADOPT FOR THE FEATURE** (parser); mocks **SPIKE FIRST** | `@readme/openapi-parser` for validate/bundle; keep `@hey-api/openapi-ts` for types |
| 6 | Blocks catalogue, pipelines (#407, #395, #408) | **BORROW CONCEPTS**, no code | JSON Schema per block input (Nx `schema.json` / Backstage `parameters` model) |
| 7 | Story parsing (#383-#388) | **ADOPT FOR THE FEATURE** | `linkedom` (CSS selectors, no script execution); XPath opt-in later |
| 8 | Architecture-as-code interop (#395) | **ADOPT FOR THE FEATURE** | generate `.dependency-cruiser.cjs` from `architecture.yml` instead of the static 6-rule file |
| 9 | Cockpit UI kit | **ADOPT FOR THE FEATURE** (Dialog, Menu); Tree **SPIKE FIRST** | accessible primitive library behind our own `components/ui` wrappers |
| 10 | Job durability (#410) | **SKIP** libraries | no queue library fixes the actual gaps; fix semantics in `processEngine` |
| 11 | SSRF and secrets | **ADOPT FOR THE FEATURE** (safe fetch); secret scan **SPIKE FIRST** | one core `safeFetch` block: connect-time DNS check plus `ipaddr.js` as a direct dependency |
| 12 | Live preview and sandboxing | **SPIKE FIRST** | reverse proxy for hosted preview; threat-model cloned-repo dev servers first |

Ranked shortlist, do-not-adopt list, licence flags and open questions are at the end.

---

## 1. Components screen documentation (#431)

**Job to be done.** #431 says a Component opens in the stage as "simple documentation (name, feature, path,
props/usage text if cheaply available)", explicitly with **no node parsing** and reusing the existing source
editor. The components are in the *user's project*, which may have no Storybook and no docs setup at all.

**Candidates.**

| Tool | Licence | What it does | Fit |
| --- | --- | --- | --- |
| `react-docgen` | MIT [V] (8.0.3, 10 dependencies, installed in `ui/client` via `@storybook/react`) | Per-file: reads a `.js/.jsx/.ts/.tsx` source string (Babel parser) and returns `{displayName, description, props{type, required, defaultValue, description}}` | Best fit. No TS program, no config, fast per file. It is what Storybook's Docs tab uses [V, from `ui/client/package-lock.json`: `@storybook/react` depends on it] |
| `react-docgen-typescript` | MIT [V] (2.4.0, 0 dependencies, installed) | Same output shape, but through the TypeScript compiler, so it resolves imported and inferred prop types | More accurate on complex types, much heavier (builds a program); second choice or fallback |
| TypeDoc | Apache-2.0 [K] | Whole-project API documentation from TS; JSON model output | Library-doc shaped; overkill for a per-component pane |
| Storybook | MIT [V] | Component workshop; already dogfoods our own `ui/client` (stories exist for `components/ui/*` [V]) | Needs story files in the *target* project; right for documenting **Construct's own** kit, wrong for #431 |
| Ladle | MIT [K] | Vite-only stories runner | Needs stories; SKIP |
| Histoire | MIT [K] | Stories runner, Vue/Svelte first | Not a React-first fit; SKIP |

**Evidence (a light `node` script run for this report, no server).** `react-docgen` parsing three real files
from `ui/client`:

```
features/tests/components/CloneDialog.tsx  157ms  CloneDialog -> props: dialog, onName, onCreate, onCancel, onShowCode
components/ui/Button.jsx                    13ms  Button      -> props: variant, className
features/shell/components/TopBar.tsx        13ms  TopBar      -> props: projectSwitcher, userMenu, modelStatus,
                                                   runningProcesses, layout, onTogglePane, onOpenProcesses,
                                                   onOpenPalette
```

(first call includes module warm-up; the two later calls are 13 ms each). It works on both `.jsx` and `.tsx`,
with no configuration.

**How it plugs in as a wrapper.**

- Owner: core, layer "AST and parsing" (`src/ast` neighbourhood), because Cockpit and CLI (`construct
  describe component <file>`) should share it. The interface we own: `describeComponent(root, relPath) ->
  {ok:true, components:[{name, description, props:[{name, type, required, default, description}]}]} | {ok:false,
  error}`. JSON in, JSON out, never a throw (the audit's block rule).
- Switchable: `docs.propsSource: react-docgen | none` in project settings; "none" falls back to what we have
  today (name, feature, path, plus the export list from `src/ast`). A second implementation
  (`react-docgen-typescript`) can sit behind the same interface for projects whose props are inferred.
- Deterministic: same source in, same JSON out (versions pinned in the lockfile). Runs in a child process or
  worker with a timeout (the audit's #413 lesson: nothing unbounded on the Cockpit server).
- Security: it parses, never executes, project code. Input path goes through the existing workspace-containment
  check first (differentiator we keep). Output is data rendered as text, never as HTML.
- Open-core: the dependency lands in core (MIT, 10 transitive dependencies, all Babel-family [K]); the props
  panel that renders it is Cockpit.
- Ask: the audit's rule "core takes tiny packages (<= 4 transitive dependencies)" is exceeded by react-docgen
  (10). Either accept it (they are Babel parsers, widely shared with Storybook and Next) or put the block in
  `ui/server`. Owner call, listed in the open questions.

**Risks.** Size (Babel parser tree), a file with syntax the Babel parser rejects (return `{ok:false}` and show
the fallback), components defined through HOCs or forwardRef with unusual shapes (docgen returns nothing: show
the fallback, do not guess), and props documented only in a `.d.ts` beside a `.jsx` (our own kit does this [V:
`ui/client/components/ui/index.d.ts`, `AttributionBadge.d.ts`]); the react-docgen-typescript fallback covers it.

**Verdict: ADOPT FOR THE FEATURE (#431).** Smallest first step: add `react-docgen` as a direct dependency,
implement `describeComponent` with a 2 s timeout, expose `GET /api/components/describe?path=`, and render
name plus props table in the stage; golden test on three fixture components (one `.jsx`, one `.tsx`, one
unparseable).

---

## 2. QA click-and-record (#319)

**Job to be done.** A tester clicks through the app and gets **readable steps**, not brittle code, in the
step-editor format of `docs/GENERATED_TESTS.md`.

**What the step format can hold today [V, `docs/GENERATED_TESTS.md`].** GIVEN/AND/WHEN/THEN/CHECK rows; the
vocabulary that round-trips is Go to, Flow event, Flow state, Check "text is visible". Click, Type and Wait are
"not offered yet (no template can round-trip them)". Selectors are our convention: `data-testid` (kebab of the
event), `data-flow`, `data-flow-state`. A file is editable only if parse then render returns it byte for byte.
`testRunner.mjs` runs the project's own Playwright with `trace: 'off'`, `screenshot: 'off'`, `video: 'off'`,
JSON reporter [V, lines 126-127].

**Candidates.**

| Tool | Licence | What it gives | Fit |
| --- | --- | --- | --- |
| Playwright codegen (`npx playwright codegen`) | Apache-2.0 [V for the Playwright package; codegen is part of it] | Headed browser plus recorder; emits code in a language target. Prefers `getByTestId` when the test-id attribute is present [K] | Needs a display; **cannot run inside the hosted Cockpit** (server has no screen). Fine as a local developer tool |
| Playwright trace (`trace: 'on'`/`'retain-on-failure'`, `npx playwright show-trace`) | Apache-2.0 [V package] | A zip per test with every action, DOM snapshots, network, console, screenshots. The zip's internal format is not a documented public API [K] | Excellent evidence for a **failed run** on the Tests screen; poor as an authoring format |
| Playwright UI mode / HTML report | Apache-2.0 [V package] | Interactive runner and report with embedded trace viewer | Local only; heavy for the Cockpit |
| Our own recorder | ours | We already inject a click bridge into the target's dev server (`src/engine/previewBridge.mjs`, `previewVitePlugin.mjs` [V]) and annotate JSX with source locations in memory | The differentiator: the bridge knows which **component/handler/testid** was hit, which codegen cannot |

**How recorded steps map to our format.** codegen output such as `await page.getByTestId('request-refund').click()`
is a fixed set of statement shapes (`goto`, `click`, `fill`, `check`, `expect(...).toBeVisible()`); `src/ast`
already parses spec bodies into steps. Mapping is a parser extension, not a translation service:
`click getByTestId(x)` -> "Flow event x" if `x` is a machine event testid, else a new generic "Click [testid]"
row; `fill` -> "Type"; `expect(getByText).toBeVisible()` -> "Check text is visible"; anything else stays a
read-only "unrecognised statement" row with the reason (the existing round-trip gate already does exactly
this). Selectors that are not `data-testid` (role/text/CSS) are flagged "brittle: add a data-testid" rather than
accepted silently.

**Wrapper design.** Owner: core `src/engine` (`testSteps.mjs`, `testSpecRender.mjs` gain Click/Type/Wait
templates that round-trip); recorder UI in the Cockpit. Interface we own: `RecordedEvent {kind:'click'|'type'|
'navigate', testid?, text?, url?, flowState?}[]` -> steps. Any recorder (our bridge, codegen JSONL/JS output,
a future browser extension) produces that array; the renderer never depends on the recorder. Switchable:
`recorder: preview-bridge | codegen-import`. Determinism: recording is inherently human; everything after the
array is deterministic. Security: the bridge posts messages from an iframe, so events are validated against an
allowlist of kinds and escaped into literal slots (the same discipline the step editor already applies).
Open-core: core gets the templates; recorder UI is Cockpit.

**Risks.** codegen output style changes between Playwright versions [K]; trace zip format is internal; a
recorder in the iframe only sees what the page emits (no native dialogs, file pickers, cross-origin frames).

**Verdict: SPIKE FIRST for recording; ADOPT NOW for the trace.**
- ADOPT NOW (tiny, uses the dependency we already have): set `trace: 'retain-on-failure'` in `testRunner.mjs`
  and record the zip path in the run result, so a failed run has evidence. (Sub-issue below.)
- SPIKE (half a day): take three codegen outputs of a real flow against `example/`, run them through an
  extended `testSteps` parser, and measure how many statements map; in parallel prototype the bridge recorder.
  Decide between them on that number. No issue until the spike says which.

---

## 3. Refactoring and codemods next to our own parser (#381)

**Job to be done.** `refactor.move/rename` and "change from a selection" (Move, Rename, Extract, Wrap in) must be
safe: every importer rewritten, nothing else touched.

**What we have [V].** `packages/core/refactor.mjs` rewrites importers with the regex `/\bfrom\s*(['"])(.*?)\1/g`
(header says "intentionally broader than extractImports"). By reading it, this misses dynamic `import('...')`,
`require`, `import type` edge forms, and does not consult `tsconfig` `paths` aliases. `src/ast` (typescript-estree
plus `jsxEdit.mjs` range edits) handles JSX-level edits.

**Candidates.**

| Tool | Licence | What it is | Fit |
| --- | --- | --- | --- |
| TypeScript LanguageService (`ts.createLanguageService`) | Apache-2.0 [V: `typescript@5.9.3` is already a core dependency] | The engine behind editor "move file" and "rename symbol": `getEditsForFileRename`, `findRenameLocations` | **Best.** Zero new dependency, understands `paths`, barrels, `export *`, dynamic imports |
| ts-morph | MIT [K] | Ergonomic wrapper over the TS compiler API | Ships/pins its own TypeScript copy [K] -> two TS versions; nicer API than we need; SKIP |
| jscodeshift | MIT [K] | Codemod runner over recast | Test-friendly, but format-preserving printing we do not need (we edit by range); SKIP |
| recast | MIT [V] (0.23.21 installed in `ui/client`, Storybook's codemods) | Format-preserving AST printer | Same; SKIP |
| ast-grep (`@ast-grep/napi`) | MIT [K] | Tree-sitter structural search and rewrite with YAML rules; prebuilt native binaries per platform [K] | Attractive as a **user-authored rule format** ("an LLM understands an example better than an instruction": a YAML pattern is a concrete example). Native binary and grammar coverage to verify. SPIKE, not now |

**Evidence (a light `node` script run for this report).** A three-file fixture with a relative import, an
alias `export * from '@/features/a/services/aService'` and a dynamic `import('../services/aService')`. Moving
`features/a/services/aService.ts` to `features/a/services/a/aService.ts` with
`ls.getEditsForFileRename(old, new, {}, {})` returned three edits in `useA.ts` in **544 ms** (3 files, cold
program): `../services/a/aService`, `@/features/a/services/a/aService` (alias **kept as an alias**) and
`../services/a/aService` for the dynamic import. The regex in `refactor.mjs` would have found only the
`from '...'` forms and, by reading it, has no alias logic.

**Wrapper design.** Owner: core, "AST and parsing". Interface we own: `planFileMove(root, from, to) ->
{ok, edits:[{file, start, end, newText}]}`, pure (returns edits, writes nothing), which `moveLayerFile` then
applies through the existing transactional writer and approval gate. Switchable: `refactor.engine:
typescript | regex`, regex kept as the fallback for projects without a usable `tsconfig` (JS-only, broken
config). Determinism: same TS version plus same `tsconfig` gives the same edits; pin via the lockfile and record
the TS version in the plan. Security: reads only inside the workspace; the edits go through the same per-file
approval as today (gate stays the differentiator); a project `tsconfig` can name `extends` outside the
workspace, so containment must apply to `readConfigFile` targets too. Open-core: core, no new package.

**Risks.** Memory and time on very large projects (whole program in memory; on a 15 GB box with parallel
agents, run it in the child process used for other heavy blocks and cap files); a project with no `tsconfig`
(fall back); mixed JS/TS needs `allowJs`; TS major upgrades can change edit output (golden tests on fixtures
catch it).

**Verdict: ADOPT FOR THE FEATURE (#381 Move and Rename).** Extract and Wrap-in stay on `src/ast/jsxEdit.mjs`
(JSX-scope work is a Construct differentiator). Smallest first step: implement `planFileMove` with the
LanguageService, add a golden test with the alias, barrel, `export *` and dynamic-import cases above, and run it
side by side with the regex path on `ui/client` to list disagreements before switching the default.

---

## 4. File templates and generators

**Job to be done.** `construct create <layer>` writes controller/workflow/hook/domain/service/page/component
files.

**What we have [V].** `packages/core/generators.mjs`: a `templates` object of small string-template functions
(`controller`, `workflow`, `hook`, `domain`, `service`, `page`, `component`, with a per-framework controller
variant for `nextjs` and `react-spa`), pure functions of the name; `service-generator.mjs` for OpenAPI; a plan
template layer (`planTemplate.mjs`), and spec rendering (`testSpecRender.mjs`).

**Candidates.** Plop (MIT [K]), Hygen (MIT [K]), Yeoman (BSD-2-Clause [K]; JHipster's engine [K]), EJS
(Apache-2.0 [K]), Handlebars (MIT [K]), copier and Cookiecutter (Python; MIT and BSD-3 [K]).

**Assessment.** These tools solve "a directory of template files plus interactive prompts plus a CLI". We have
seven one-line pure functions, covered by tests, driven by the plan/envelope layer (not by prompts). Adopting
Plop or Yeoman would add an inquirer/prompt dependency tree and a second template dialect for no capability;
EJS/Handlebars add a template language whose escaping rules become part of our security surface (template
injection) when names come from a browser. The pure function is the most testable, most LLM-legible form: it
is itself "an example", which is our mantra.

**What to borrow (concepts, not code).**

- JHipster **blueprints**: a project (or organisation) can override or extend a generator's templates. For us:
  an optional `templates/` folder in the project or an envelope that replaces a layer's template function,
  resolved by the same `frozen`/containment rules. This is a small design item under #395 (envelopes), not a
  dependency.
- copier's **answers file** (`.copier-answers.yml`) and `copier update`: remember the inputs a file was
  generated from so it can be regenerated with a new template version and a three-way diff. We already have
  the raw material (lineage headers `machine-hash`/`scenario-hash` on generated tests [V]); the idea generalises
  to generated layer files.

**Verdict: SKIP (code); BORROW blueprints and answers-file ideas.** No first step needed beyond a design note in
the #395 thread.

---

## 5. OpenAPI (#400, v0.11.0)

**Job to be done.** Import Swagger/OpenAPI (2.0 and 3.x, JSON/YAML), validate, list endpoints, map them to
features/services, generate typed clients and DTOs and mock adapters, export a contract, and switch each service
between Mock and Real.

**What we have [V].** `@hey-api/openapi-ts@0.97.3` (MIT, 10 dependencies) already used by
`packages/core/service-generator.mjs` (`createClient`). Reading its installed `dist`: it bundles its own fork of
`json-schema-ref-parser` (`@hey-api/json-schema-ref-parser`) so it already resolves `$ref`s, and it ships plugins
for TypeScript types, `sdk`, `schemas`, `transformers`, `zod`, `valibot`, `@tanstack/*`, `swr`, `fastify` and
several HTTP clients (`client-fetch`, `client-axios`, ...). It has **no msw or mock plugin** (0 mentions of
"msw" in the bundle). It is a generator, not a spec linter.

**Candidates.**

| Job | Tool | Licence | Notes |
| --- | --- | --- | --- |
| Validate, bundle, dereference, produce a clean summary of operations | `@readme/openapi-parser` | MIT [K] | Maintained fork of swagger-parser with OpenAPI 3.1 support [K]. Gives us "is this a valid spec, list operations/tags/schemas" before we generate |
| same | `@apidevtools/swagger-parser` | MIT [K] | The original; slower-moving [K] |
| Types | `openapi-typescript` | MIT [K] | Excellent, but we already have hey-api; two type generators for one job is the trap the first audit named |
| Types plus clients plus mocks | `orval` | MIT [K] | Can emit msw handlers with faker [K]; would replace hey-api rather than complement it |
| Mock handlers in the browser/Node | `msw` | MIT [K] | Request-level interception; handlers are code; deterministic if fed static examples |
| Mock server as a process | Prism (Stoplight) | Apache-2.0 [K] | Serves examples or dynamic data from a spec; heavy dependency tree [K]; dynamic mode is random unless static examples |
| Mock server as a process | Mockoon CLI | MIT [K] | Own environment format, not OpenAPI-native [K] |
| Lint | Redocly CLI / `@redocly/openapi-core` | MIT [K] (verify: vendor also sells non-open products) | Rulesets, decent API |
| Lint | Spectral | Apache-2.0 [K] | Stoplight, rule-as-JSON/YAML |
| Property-based API testing | schemathesis | MIT [K], Python | External tool, not a Node dependency; a possible optional CI recipe, not a block |

**Mock vs Real, mapped.** The service layer is the seam (SERVICE-001, #400). A service has `mode: mock | real`
per environment. Real = base URL plus an **env-var reference** for auth (never the secret). Mock has two
implementations behind the same switch: (a) generated **in-process handlers** (msw or a plain adapter), seeded
and example-driven, for tests and the preview; (b) a **mock-server process** (Prism or Mockoon) started in the
Run panel as a Process, for anything outside the browser. The switch changes the resolved base URL or the
handler set; nothing else in the generated client changes. Real calls from the Cockpit server go through the
shared `safeFetch` block (section 11).

**Wrapper design.** Owner: core "Pipeline and Generators". Interface we own: `importContract(specText) ->
{ok, version, operations:[{id, method, path, tags, request, responses, examples}], schemas, warnings}`,
independent of the parser used; `generateMocks(contract, {seed}) -> files`. Switchable: parser and mock
implementation are config values. Determinism: mocks come only from `example`/`examples`/`enum`/`default` and a
seed, never `Math.random` or an LLM; where a schema has no example we mark the field "no example" (in line with
#400's "mark undeterminable parts explicitly rather than guessing"). Security: specs are untrusted input;
`$ref` to a remote URL must be **off by default** (external refs are an SSRF path; only allow refs inside the
document or through `safeFetch`). Open-core: parser and generators in core; the mapping screens are Cockpit.

**Risks.** Two parsers in one flow (the parser and hey-api's fork) can disagree on edge specs; pick one as
the validation gate and let hey-api consume the original text. Prism's tree and native pieces [K]; faker-based
mocks are non-deterministic unless seeded.

**Verdict: ADOPT FOR THE FEATURE (parser, #400); mocks SPIKE FIRST.** Smallest first step: add
`@readme/openapi-parser` (after confirming its LICENSE), implement `importContract` and a golden test on a
Swagger 2.0 file and a 3.1 file, with external `$ref` refused. Spike (a day, later): generate msw handlers from
examples ourselves versus Prism as a process, measured on determinism, size and how each behaves in the Run panel.

---

## 6. Blocks catalogue and pipelines (#407, #395, #408)

**Job to be done.** Show blocks, configure them, and compose rules and envelopes; keep a one-way path from
"a project's blocks" to "a Cockpit form".

**Prior art, what to borrow and what not.**

| System | Licence | The idea | Borrow (concept) | Adopt (code) |
| --- | --- | --- | --- | --- |
| JHipster | Apache-2.0 [K] | JDL: a small DSL for entities and relationships that drives generation; **blueprints** extend generators; the generator regenerates without clobbering [K] | A human-readable model file as the source of truth (ours: `architecture.yml`, plans, `story.md`); blueprints (section 4) | No: JVM/Yeoman stack |
| Nx | MIT [K] | Generators (`schema.json` describes options, so a UI can render a form), executors, **project graph**, `affected` | The `schema.json`-per-block idea; project graph and "affected" (we have `impact.mjs` [V]; #408 pilots the runner side) | Pilot only (#408); its module-boundary rule and generators are out of scope there, correctly, since Construct is the enforcer |
| Turborepo | MIT [K] | `turbo.json` pipeline: `dependsOn`, inputs and outputs hashing, remote cache | Content-hash caching per task | Pilot only (#408) |
| Backstage Software Templates | Apache-2.0 [K] | `template.yaml`: `parameters` as JSON Schema (a form), `steps` as registered **actions** with `${{ parameters.x }}`, an `output` | Closest analogue to envelopes plus the Cockpit: input schema, ordered registered actions, declared outputs | Its form renderer (rjsf, Apache-2.0 [K]) is a large React dependency; SPIKE only |
| Cookiecutter / copier | BSD-3 [K] / MIT [K] | Variables file plus templates; copier adds `update` from a template version | Answers file and update (section 4) | No: Python |

**What this means for #407.** Give every block a **JSON Schema for its input** (the shape already exists for
plans/processes/envelopes in `schemas/*.v1.json` [V]: `envelope`, `impact-report`, `plan`, `pr-health`, `process`,
`unit-summary`) plus a one-line description and an example input. The Cockpit renders the config form from the
schema, an LLM (later MCP) gets the schema and the example as its instruction, and the CLI validates with the
same document. `ajv` (MIT [V], 4 dependencies, currently a devDependency used by tests only) is the natural
validator at the Cockpit server boundary; the first audit deliberately kept hand-rolled validators in core, and
this does not change that: it adds schema validation where the input crosses from a browser into a block.

**Verdict: BORROW CONCEPTS, adopt no new code now.** Smallest first step: a design note on #407: "block manifest
= `{id, title, description, inputSchema, example, effects}`" (Nx `schema.json` plus Backstage `parameters`).
An rjsf spike only if hand-rendering forms from schemas proves costly.

---

## 7. Story and ticket parsing (#383-#388)

**Job to be done.** Fetch a public page or ticket export, let a human pick fields by selector (#386, #387), and
verify extractions per use, without hand-rolling an HTML parser and without executing anything from the page.

**Candidates** (all licences [K], none installed here).

| Tool | Licence | Notes |
| --- | --- | --- |
| `linkedom` | ISC | DOM in a few files; `querySelector` (css-select based); does not execute scripts or load subresources by default [K]; light |
| `parse5` | MIT | Spec-compliant parser only, no selectors; used under many tools; good if we only need the tree |
| `cheerio` | MIT | jQuery-style selectors on parse5/htmlparser2; the most familiar API; CSS only |
| `xpath` | MIT | XPath 1.0 over any DOM; pair with linkedom if XPath is truly needed (#387 mentions it) |
| `jsdom` / `happy-dom` | MIT / MIT | Full DOM, much heavier; not needed |
| `fast-xml-parser` | MIT | XML to JSON; only if a source is RSS/XML export; not needed for HTML |
| `@mozilla/readability` | Apache-2.0 | "Reader mode" main-content extraction; needs a DOM (linkedom works) |
| `turndown` | MIT | HTML to Markdown; **its Node build depends on a DOM implementation (`@mixmark-io/domino`) which I believe is MPL-2.0** [K, unverified]; flag for the licence rule. `node-html-markdown` (MIT [K]) is the alternative |

**Wrapper design.** Owner: core, new block `story` (#383-#384), Cockpit renders picks. Interface we own:
`extract(html, {fields:[{name, selector, kind:'css'|'xpath', attr?}]}) -> {ok, values, misses:[...]}` and
`verify(html, previousValues)`, no DOM object ever escapes the block (JSON only). Switchable: engine
(`linkedom`/`cheerio`) is an internal detail behind that JSON contract; selector kind is per field. Determinism:
selectors are stored and re-run (mechanical); an AI only *proposes* a selector once, which the block verifies
against the page before it is saved (#387's own design). Security: fetch only through `safeFetch` (section 11);
cap bytes and time before parsing; parse only, never run scripts; strip and escape everything before it reaches
the Cockpit; a hostile selector (`:has` pathologies, huge documents) gets a time and size budget. Open-core: the
extract block is core (ISC/MIT).

**Risks.** Pages that render client-side return an empty shell (no JS execution is a deliberate scope cut; the
userscript bridge #386 is the answer); parsers differ on malformed HTML; the licence of turndown's DOM.

**Verdict: ADOPT FOR THE FEATURE (#384/#387): `linkedom`.** Smallest first step: implement `extract`/`verify`
with `linkedom` on three saved HTML fixtures (static, malformed, script-heavy) with tests that assert no script
ran; decide `cheerio` versus `linkedom` on install size measured at that moment. Readability and Markdown
conversion: SPIKE later, only if a story needs "main content as text".

---

## 8. Architecture-as-code and boundary tools (#395)

**What we have [V].** A static `.dependency-cruiser.cjs` at the repo root and, from `construct init/sync`,
`packages/core/cli.mjs` line ~312 writes that file into target projects as a **fixed string of 6 forbidden rules**
(`page-to-workflow`, `page-to-service`, `page-to-domain`, `component-to-app-logic`, `workflow-to-ui`,
`service-to-ui`), not derived from the project's `architecture.yml`. `dependency-cruiser` itself is not installed
in this checkout (it runs in target projects); the package's `files` list ships the config. ESLint 10 is in use
[V]; `eslint.config.mjs` holds only a custom no-bare-tmpdir rule.

**Candidates** (licences [K]).

| Tool | Licence | Role |
| --- | --- | --- |
| dependency-cruiser | MIT | Enforces "forbidden/allowed" dependency rules by path regex, finds cycles and orphans, emits graphs (dot/mermaid/json) in CI. **Interop target already in use** |
| eslint-plugin-boundaries | MIT | Element types plus allowed-import matrix inside ESLint; feasible export target; **check ESLint 10 compatibility first** (not verified) |
| madge | MIT | Cycles and graphs; dependency-cruiser covers it; SKIP |
| Nx module boundaries (`@nx/enforce-module-boundaries`) | MIT | Tag-based; needs Nx projects; #408 correctly keeps a second enforcer out. SKIP as an enforcer |
| ArchUnitTS | licence not known to me; verify | Architecture rules as test assertions; overlaps our validator; SKIP |

**How our rules import/export.** Construct is the source of truth (`architecture.yml` layers and allowed edges,
frozen and nonLayer regions). **Export**: a deterministic `export ci --target dependency-cruiser|eslint-boundaries`
block writes an equivalent config for teams that want the check inside their existing CI; the file carries a
"generated by Construct, do not edit" header and a hash, so drift is detectable (same pattern as generated tests
[V]). It is lossy by nature (our semantic checks, such as READ-001 or DOMAIN-001, have no path-regex form), and
the export says which rules it could not express. **Import** (read an existing `.dependency-cruiser.cjs` to seed
`architecture.yml`) is feasible only for simple path rules; spike, lower value.

**Open-core.** Core: the export block (MIT tooling, only text output; dependency-cruiser stays the *target
project's* devDependency, not ours). Cockpit: the "Export for CI" button in the rules composer (#395).

**Verdict: ADOPT FOR THE FEATURE (#395): replace the static 6-rule string with a config derived from the
project's layers, add a CI recipe (`npx depcruise ...`) to the docs.** Smallest first step: generate the
dependency-cruiser file from `loadConfig()` layers and allowed edges in `sync`, with a test that the default
config reproduces today's six rules byte for byte; then the eslint-boundaries export as a second target.

---

## 9. UI kit for the Cockpit

**What we hand-built [V].** `ui/client/components/ui`: Badge, Button, Field, GlassPanel, Input, Logo, Select,
each with a story. The riskier widgets live in features: `UserMenu.tsx` (106 lines), `CloneDialog.tsx` (84
lines, own `FOCUSABLE` selector, Tab trap, Esc close and focus return), `ProjectSwitcher.tsx`, `TabHost.tsx`,
`NarrowTabBar.tsx`, `CommandPalette.tsx` (110), `FlowTree.tsx` (50), `ChangeTree.tsx` with
`useTreeNavigation.tsx` (54). The e2e suite includes axe scans (`@axe-core/playwright`), which is our safety net.

**Where hand-rolling hurts.** Modal dialogs (focus trap, `inert` background, scroll lock, portal, return focus,
nested dialogs), menus (roving tabindex, typeahead, submenus, dismissal on outside click and focus loss,
`aria-*`), and tabs are the classic places where correct-looking code breaks for screen readers and touch.
The left rail, profile menu and popovers (#429, #367, `docs/design/popovers.md`) multiply these.

**Candidates** (licences [K]).

| Library | Licence | Shape | Fit |
| --- | --- | --- | --- |
| Radix Primitives | MIT | Unstyled, per-widget packages (`dialog`, `dropdown-menu`, `tabs`, `popover`, `tooltip`...) | Best default: small pieces, styling by our tokens; **no Tree primitive** [K] |
| React Aria / React Aria Components | Apache-2.0 | Adobe; the most thorough accessibility behaviour; hooks or components; includes `Tree` and `Menu` [K: verify Tree stability] | Best a11y depth; heavier API surface and bundle |
| Headless UI | MIT | Tailwind Labs; Dialog, Menu, Tabs, Combobox | We do not use Tailwind [V: no dependency]; works without, but a smaller set; no Tree |
| Ark UI (Zag.js) | MIT | State-machine based; has a Tree View [K] | Interesting: Zag machines echo our XState philosophy; younger ecosystem [K] |
| Base UI | MIT | MUI's unstyled successor [K] | Comparable to Radix; verify maturity |
| shadcn/ui | MIT | Copy-in components on Radix; not a dependency | Copies code into `ui/`, which contradicts "wrap, do not own commodity code" |
| cmdk | MIT | Command palette | We have `CommandPalette.tsx` [V]; only if it proves fragile |

**Wrapper design.** Owner: Cockpit `components/ui` (proprietary). We own the small interface: `Dialog`,
`Menu`, `Tabs` components with **our props and our tokens**, implemented on the library; features import only our
wrappers, so the library is swappable (Radix to React Aria) in one folder. Switchable: not user-facing. Tests:
the existing e2e specs and axe scans stay the regression guard; add a per-primitive Playwright keyboard test
(rule 11, real run). Determinism/security: no impact; one benefit is fewer bespoke event handlers to audit.
Open-core: the Cockpit may take larger packages than core, but the permissive-licence rule still applies; core
must not import them.

**Risks.** Bundle size (per-widget packages keep it small); React 19 and Next 15 compatibility to verify at
install (the client is `next@15.5.25`, `react@^19.1.0` [V]); styling parity (our glass surfaces and focus rings)
takes work; migration touches shipped screens, so do it one widget at a time.

**Verdict: ADOPT FOR THE FEATURE (Dialog and Menu) in the next slice that builds a new modal or menu (#367
slices); Tree: SPIKE FIRST** (keep `useTreeNavigation` until a candidate passes our existing tree specs).
Smallest first step: rebuild `CloneDialog` on the library's Dialog behind `components/ui/Dialog`, keep its
existing Playwright spec green, compare lines and a11y-scan result.

---

## 10. Process and job durability (#410)

**What we have [V].** `src/engine/processStore.mjs`: one JSON file per process, `atomicWriteJson` writes a temp
file, **`fsyncSync`s it**, closes and renames, and removes the temp file on failure. (Correction to the first
audit: audit item B3 says "no `fsync`"; the code has one. Reading `processStore.mjs` lines 80-94 supersedes
that sentence.) `adoptInterrupted` recovers dead-owner processes on start; clone jobs and review results are
in-memory (`cloneJobs.mjs`, `reviewAnalyses`); one engine slot per project.

**Candidates.**

| Tool | Licence | Needs | Fit |
| --- | --- | --- | --- |
| `p-queue` | MIT [K] | nothing; in-memory concurrency and priority | Useful for "two lanes" (audit #7) if we need a queue at all; not durable |
| `better-queue` | MIT [K] | pluggable stores; low recent activity [K, unverified] | Weak signal; SKIP |
| `graphile-worker` | MIT [K] | **PostgreSQL** | A database dependency for a single-node tool; SKIP |
| BullMQ, bee-queue | MIT [K] | **Redis** | SKIP |
| `node:sqlite` | built in [V: Node 22.14.0 here; the first audit calls it experimental] | none | Real gain only with queries or indexes we do not have; revisit at v1.0 if needed |
| `better-sqlite3` | MIT [K] | native build | Same; native addon on a hosted box is a cost |
| `write-file-atomic` (ISC [K]) | 2 small deps [K] | Replaces 15 lines we already have correct [V] | SKIP: heavier than the code it replaces |
| Workflow engines (Temporal, Inngest, n8n) | Temporal MIT [K]; Inngest and n8n licence terms are not plain permissive as far as I know [K, verify before any interest] | a server | A different product category; SKIP |

**Assessment.** The audit's real gaps (#413 timeouts, engine-level failure must leave the record `failed`, persist
derived results, two lanes, clone as a Process) are **semantics inside our engine**, not missing infrastructure.
No queue library adds durability the file store lacks; and the store's "the directory listing is the index" design
is deliberate. What is worth borrowing are patterns: worker **leases with heartbeat** (our owner-pid liveness is
the single-node version), **idempotent steps**, and job keys for de-duplication.

**Verdict: SKIP libraries.** If lanes are needed, a 30-line semaphore per lane in `processEngine` beats `p-queue`
plus its own state; if that grows, `p-queue` (MIT, no dependencies [K]) is the one to reach for. No sub-issue.

---

## 11. Secret and token handling, SSRF (#384, #400, clone)

**What we have [V].** `ui/server/src/gitUrl.mjs` `isPublicAddress` (55 lines, hand-rolled IPv4/IPv6 reserved
ranges, exhaustively unit-tested per the first audit); clone pins DNS through `http.curloptResolve` (git-specific).
`ipaddr.js@1.9.1` is present only as `express`'s transitive dependency (0 dependencies, MIT [V]) and is
not used by our code (grep of `ui/server/src` finds no import).

**The gap that matters.** Story fetch (#384) and real API calls (#400) are HTTP, not git. The correct guard is
**check at connect time**: resolve the name, reject if any address is non-public, and connect to *the address
that was checked* (defeats DNS rebinding and TOCTOU), then re-validate on every redirect hop, cap bytes and time,
allowlist content types and schemes.

**Candidates.**

| Option | Licence | Notes |
| --- | --- | --- |
| Node built-ins: `dns.lookup` override on `http.Agent`/`net.connect({lookup})` | built in | No dependency; the hook returns the address the socket will use, which is the whole point |
| `undici` `Agent({connect:{lookup}})` | MIT [K] | Same technique for `fetch`/`undici.request`; Node's global `fetch` does not expose the dispatcher without importing undici [K] |
| `ipaddr.js` | MIT [V for 1.9.1; 2.x line from the first audit and my knowledge] | Address parsing and range names (`private`, `loopback`, `linkLocal`, `uniqueLocal`, `carrierGradeNat`...) [K]; make it a **direct** dependency, since the transitive 1.x copy is not ours to rely on |
| `ssrf-req-filter`, `request-filtering-agent` | MIT [K] | Small agents around `ipaddr.js` for `http`/`node-fetch`; low maintenance signals not verifiable here; only worth it if they cover redirects, which we would test anyway |
| Secret scanners: secretlint (MIT [K]), gitleaks (MIT [K], Go binary), detect-secrets (Apache-2.0 [K], Python) | | Find tokens in files or diffs |
| Redaction: `fast-redact` (MIT [K]), pino redact | | Mask fields in logs |

**Wrapper design.** Owner: **core**, a single `safeFetch(url, {maxBytes, timeoutMs, allowSchemes, allowContentTypes,
allowHosts?})` block returning `{ok, status, headers, body}` or `{ok:false, code}`; the clone flow, story fetch
and real-API calls all use it (the first audit's recorded "shared safe public fetch block", made concrete).
`isPublicAddress` becomes a thin call over `ipaddr.js` **only if the existing exhaustive unit tests stay green**;
otherwise it stays (the table is a security property). Switchable: per-host allow-list entries (owner approves
per host, as #386/#400 already specify); the guard itself is never switchable off (guardrails stay on regardless
of the switch). Secrets: env-var references only; the Cockpit never writes a token to disk (CLAUDE.md rule 6);
a pre-write **secret scan** on generated diffs is an on-brand deterministic check ("deterministic checks before
any AI output lands"). Open-core: `safeFetch` and the scanner are core.

**Risks.** IPv6 and mapped-address edge cases (the existing tests are the asset); redirects to private ranges;
proxies configured by environment variables bypass a connect-time check (document: no proxy for guarded fetches);
HTTP/2 or keep-alive agents reusing a socket resolved earlier (disable pooling for guarded fetches).

**Verdict: ADOPT FOR THE FEATURE (#384): `safeFetch` in core with a connect-time lookup and `ipaddr.js` as a
direct dependency. Secret scanning: SPIKE FIRST** (secretlint as a library versus a documented gitleaks CI step).
Smallest first step: implement `safeFetch` with an injectable resolver, and tests for rebinding (resolver that
answers public then private), redirect-to-private, oversize body, and non-HTTP scheme.

---

## 12. Live preview, dev-server proxying, sandboxing

**What we have [V].** The preview is the target project's **own dev server** (Vite; `previewVitePlugin.mjs`
annotates JSX in memory and injects the click bridge, opt-in, serve-only) shown in an iframe
(`LivePreviewPanel.tsx`: `<iframe ref className title src={url} />`, **no `sandbox` attribute** on the element
read; grep for `sandbox` in `ui/client/features` finds nothing). The bridge talks by `postMessage`.

**Where the real risk is (not the iframe).** Running a dev server means executing the project's code (and, if we
ever run `npm install`, its install scripts) on the host. For a project the user wrote that is normal; for a repo
cloned from GitHub (#330 shipped) it is **arbitrary code execution by design**. An `iframe sandbox` attribute
does not help against that; it only limits what the *previewed page* can do to the Cockpit page, and a dev
server on a different origin is already isolated from the Cockpit by the same-origin policy.

**Candidates.**

| Option | Licence | Notes |
| --- | --- | --- |
| iframe `sandbox="allow-scripts allow-same-origin ..."` | browser feature | Cheap hardening; note `allow-scripts` plus `allow-same-origin` on a **same-origin** page defeats the sandbox, so keep the preview on a different origin/port, never proxy it under the Cockpit origin without care |
| `npm ci --ignore-scripts` / pnpm's default of blocking scripts | built in | Removes the install-script class of attack; some packages need scripts |
| OS-level isolation: containers (Docker engine Apache-2.0 [K]), gVisor (Apache-2.0 [K]), bubblewrap/firejail (LGPL/GPL-family [K], used as external executables, not linked) | mixed | The only real containment for untrusted code; a deployment decision, not a library |
| Node `--permission` model | built in [K, Node 22 flag; verify status] | Restricts the Node process itself, not the tools it spawns |
| `http-proxy-middleware` / `http-proxy` | MIT [K] | Reverse-proxy the dev server (including the HMR websocket) through the Cockpit server so a **hosted** Cockpit can reach a preview running on the server; put the session gate in front |
| Sandpack | Apache-2.0 [K] for the client; the Node runtime part ("Nodebox") has its own terms [K, verify] | In-browser bundler; runs simple React apps without a server; not our target projects |
| StackBlitz WebContainers | **proprietary; commercial use requires a licence [K]** | Would move execution into the browser (attractive for sandboxing) but violates the permissive-only, open-core rule; **flag, do not adopt** |

**Wrapper design.** Owner: Cockpit server (`ui/server`, process runner) with a core contract for "start a
preview" (command, cwd, port, readiness probe) as a **Process** (the engine we already have) so it is durable,
cancellable and shows in the Run panel. Interface we own: `PreviewSession {id, url, state}`. Switchable:
`preview.runner: host | container` (container implementation later), `preview.proxy: on|off`. Determinism:
fixed port allocation per worktree (the CLAUDE.md rule "isolated ports per job"). Security: cloned repo means
"untrusted" flag: require explicit owner approval before the first run, `--ignore-scripts` by default,
containerised runner as the target state. Open-core: process contract in core; runner and proxy in Cockpit.

**Risks.** Everything above; plus HMR websocket proxying quirks, cookie scoping on the Cockpit origin if a
preview is proxied under it, and port collisions across agents.

**Verdict: SPIKE FIRST.** Smallest first step: write the threat model (cloned repo, install scripts, dev server
on the host) and decide the trust boundary with the owner (open question 5) before any proxy work; then a
half-day spike of `http-proxy-middleware` with the WS upgrade for hosted preview. No sub-issue until then.

---

## Ranked shortlist: top 10 adoptions by value over effort

| Rank | Adoption | Serves | Value | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | TypeScript LanguageService for file move and rename | #381 | Removes a whole class of missed importers (dynamic `import()`, aliases) with **no new dependency** | S-M | ADOPT FOR THE FEATURE |
| 2 | `react-docgen` component props | #431 | Real props table for any project's components in a day; evidence run for real | S | ADOPT FOR THE FEATURE |
| 3 | `safeFetch` core block (connect-time check, `ipaddr.js` direct) | #384, #400, clone | One SSRF guard for three features; closes the rebinding gap for HTTP | M | ADOPT FOR THE FEATURE |
| 4 | Derive `.dependency-cruiser.cjs` from `architecture.yml` (then eslint-boundaries export) | #395 | Rules composed in the Cockpit become enforceable in a team's own CI | S | ADOPT FOR THE FEATURE |
| 5 | Playwright trace on failure in `testRunner` | Tests screen, #319 | Evidence for every failed run, zero new dependency | XS | ADOPT NOW |
| 6 | `linkedom` for story extraction | #384, #387 | Do not hand-roll HTML parsing; selectors and no script execution | S | ADOPT FOR THE FEATURE |
| 7 | `@readme/openapi-parser` for import and validation | #400 | Validated, summarised contracts before any generation | S | ADOPT FOR THE FEATURE |
| 8 | Accessible Dialog and Menu primitives behind `components/ui` | #367, #429 | Removes focus-trap/menu-keyboard risk from every future modal and menu | M | ADOPT FOR THE FEATURE |
| 9 | JSON-Schema block manifest (Nx `schema.json` / Backstage `parameters` concept) with `ajv` at the server boundary | #407 | Forms, CLI validation and LLM instruction from one document | S-M | BORROW then decide |
| 10 | Recorder into our step vocabulary (own bridge versus codegen import) | #319 | Readable recorded steps in the format we already round-trip | M | SPIKE FIRST |

(Item 9 is a concept adoption and item 10 a spike; they are ranked for value, and are the only two without a
sub-issue for that reason. The seven ADOPT FOR THE FEATURE items and the one ADOPT NOW have sub-issues.)

## Do-not-adopt list

| Tool | Reason |
| --- | --- |
| Plop, Hygen, Yeoman, EJS, Handlebars | Solve prompted directory-template generation; we have seven tested pure functions; a template dialect adds an injection surface |
| ts-morph, jscodeshift, recast | Duplicate what the TS LanguageService and our range edits (`jsxEdit.mjs`) already do; ts-morph carries its own TypeScript |
| Storybook / Ladle / Histoire for the *Components screen* | Need story files in the target project; Storybook stays for Construct's own kit |
| TypeDoc | Whole-library API docs; wrong grain for a per-component pane |
| `openapi-typescript` and `orval` *alongside* hey-api | Two generators for one job; pick one (hey-api, already in) |
| Nx or Turborepo module-boundary rules and generators | A second enforcer defeats Construct (#408 already excludes it); runner pilot stays in #408 |
| `madge`, ArchUnitTS | Covered by dependency-cruiser or by our validator |
| BullMQ, bee-queue, graphile-worker, Temporal/Inngest/n8n | Require Redis, Postgres or a server, or carry non-permissive terms; do not fix the actual gaps |
| `write-file-atomic`, `lowdb` | Heavier than the correct 15 lines we have; the store design is deliberate |
| StackBlitz WebContainers | Proprietary, commercial licence; against the open-core rule |
| shadcn/ui copy-in | Copies commodity code into our tree instead of wrapping it |
| Hand-rolled cookie/session libraries (`iron-session`, `jose`) | Audit already decided: the 80 lines of `node:crypto` beat new supply-chain surface in the "anyone gets in" module |

## Licence flags against the permissive-only rule (MIT/BSD/ISC/Apache-2.0)

| Package | Licence | Where | Status |
| --- | --- | --- | --- |
| `minimatch` | **BlueOak-1.0.0** [V] | core dependency (10.2.6) | Permissive in substance, but not on the list; owner decision open since the first audit |
| `@axe-core/playwright` | **MPL-2.0** [V] (4.13.0) | `ui/e2e` devDependency | File-level copyleft, test-only, not distributed; flag; `axe-core` itself is MPL-2.0 [K] |
| `@mixmark-io/domino` (turndown's Node DOM) | **MPL-2.0** [K, unverified] | only if turndown is adopted | Avoid or use `node-html-markdown` (MIT [K]) |
| `dompurify` | MPL-2.0 OR Apache-2.0 [K] | audit #421 alternative | Choose the Apache-2.0 option or use `sanitize-html` (MIT [K]) as #421 does |
| bubblewrap / firejail / gVisor | LGPL/GPL-family / Apache-2.0 [K] | external executables in a sandbox runner | Never linked or bundled; acceptable as tools the operator installs; flag |
| Inngest server, n8n | SSPL / fair-code (Sustainable Use) style terms [K, unverified] | not adopted | Non-permissive; do not adopt |
| StackBlitz WebContainers | proprietary [K] | not adopted | Flag as "source-available/proprietary" |
| Sandpack "Nodebox" runtime | terms not confirmed [K] | not adopted | Verify before any interest |
| Redocly CLI | MIT for the CLI/core [K] | optional lint | Verify; vendor has non-open products |

Every [K] licence above must be confirmed from the package's own `LICENSE` file when its sub-issue is picked up;
that check is an acceptance criterion in each issue.

## What I could not verify

- Any registry or web fact: last-release dates, download counts, maintenance status, exact licences and
  dependency counts of every package not present in `node_modules` (`@readme/openapi-parser`, `linkedom`,
  `ast-grep`, `msw`, Prism, Mockoon, Radix, React Aria, Ark, Nx, Turbo, Plop, Hygen, dependency-cruiser,
  eslint-plugin-boundaries, undici, `ssrf-req-filter`, secretlint, `http-proxy-middleware` and the rest).
- `dependency-cruiser` and `eslint-plugin-boundaries` versions and ESLint 10 compatibility.
- React 19 / Next 15.5 compatibility of Radix or React Aria.
- Whether the `sync`-generated dependency-cruiser file is verified anywhere by a test (only the static string
  and the shipped `files` entry were read).
- The exact Node status of the `--permission` flag and `node:sqlite` at the versions we will support.
- Whether Construct ever runs `npm install` on a cloned project today (not found by a quick search; affects
  section 12's severity).
- The 544 ms and 157 ms timings are single cold runs on a busy machine; they show feasibility, not benchmarks.

## Open questions for the owner

1. **Dependency budget in core.** `react-docgen` has 10 transitive dependencies (Babel family), over the audit's
   "at most 4" rule for core. Accept it in core, or place `describeComponent` in `ui/server`?
2. **`minimatch` BlueOak-1.0.0 and `@axe-core/playwright` MPL-2.0**: accept as documented exceptions, or replace
   (`picomatch` MIT; another a11y checker)?
3. **OpenAPI mocks (v0.11.0):** in-process handlers we generate (deterministic, no server) versus a mock-server
   process (Prism/Mockoon)? My default is in-process first; a process only if non-browser consumers need it.
4. **UI primitives:** Radix (small, unstyled) or React Aria (deepest a11y, includes Tree)? Default proposed:
   Radix for Dialog/Menu, spike React Aria or Ark for the Tree.
5. **Trust boundary for cloned repos:** do we treat a cloned project's dev server and install scripts as
   trusted, or require approval plus `--ignore-scripts` plus (later) a container runner? This decides section 12.
6. **Recorder direction (#319):** own bridge in the Cockpit preview (needs the preview on the same machine), or
   Playwright codegen import for local developers, or both behind the `RecordedEvent` contract?
7. **Should `construct sync` keep writing a dependency-cruiser file at all** into target projects, or move it
   behind an explicit `export ci` command so projects that do not use it are not given the file?

## Registry check (2026-09-21, live from npm)

The exploration itself had no registry access, so every package fact above that was marked "from knowledge" was
re-checked against npm on 2026-09-21. Version, license, last publish date and weekly downloads are from
`registry.npmjs.org` and `api.npmjs.org`.

| Package | Latest | License | Published | Weekly downloads |
|---|---|---|---|---|
| react-docgen | 8.0.4 | MIT | 2026-09-20 | 14.3M |
| react-docgen-typescript | 2.4.0 | MIT | 2025-06-10 | 12.9M |
| typedoc | 0.28.20 | Apache-2.0 | 2026-07-05 | 3.9M |
| @storybook/react-vite | 10.6.0 | MIT | 2026-09-02 | 9.9M |
| ipaddr.js | 2.5.0 | MIT | 2026-08-04 | 104.0M |
| undici | 8.10.2 | MIT | 2026-09-04 | 133.2M |
| dependency-cruiser | 18.4.0 | MIT | 2026-09-20 | 2.8M |
| eslint-plugin-boundaries | 7.2.0 | MIT | 2026-08-09 | 1.1M |
| linkedom | 0.18.13 | ISC | 2026-07-07 | 3.6M |
| parse5 | 8.0.1 | MIT | 2026-04-19 | 115.6M |
| cheerio | 1.2.0 | MIT | 2026-01-23 | 20.1M |
| xpath | 0.0.34 | MIT | 2023-12-16 | 9.2M |
| @mozilla/readability | 0.6.0 | Apache-2.0 | 2025-03-03 | 2.4M |
| turndown | 7.2.4 | MIT | 2026-04-03 | 6.8M |
| @mixmark-io/domino | 2.2.0 | BSD-2-Clause | 2024-04-06 | 5.5M |
| @readme/openapi-parser | 9.0.0 | MIT | 2026-09-04 | 0.8M |
| @hey-api/openapi-ts | 0.99.0 | MIT | 2026-06-22 | 3.4M |
| orval | 8.35.0 | MIT | 2026-09-20 | 1.7M |
| msw | 2.15.0 | MIT | 2026-07-08 | 14.7M |
| @stoplight/prism-cli | 5.16.0 | Apache-2.0 | 2026-07-17 | 0.14M |
| @radix-ui/react-dialog | 1.1.23 | MIT | 2026-07-24 | 53.7M |
| react-aria-components | 1.21.1 | Apache-2.0 | 2026-09-04 | 3.1M |
| ajv | 8.20.0 | MIT | 2026-04-24 | 287.9M |
| ts-morph | 28.0.0 | MIT | 2026-04-12 | 19.1M |
| @ast-grep/napi | 0.45.3 | MIT | 2026-08-31 | 2.4M |
| sanitize-html | 2.17.7 | MIT | 2026-08-13 | 7.9M |
| picomatch | 4.0.7 | MIT | 2026-08-24 | 363.4M |
| minimatch | 10.2.6 | BlueOak-1.0.0 | 2026-07-27 | 522.7M |
| @axe-core/playwright | 4.13.0 | MPL-2.0 | 2026-08-11 | 7.2M |

### What the check changed

- **Turndown's DOM is fine.** The report suspected `@mixmark-io/domino` was MPL-2.0; npm says **BSD-2-Clause**. Permissive, so turndown is not blocked. (Domino itself has not been published since 2024-04, but it is stable and widely used.)
- **`xpath` is stale but stable** (last publish 2023-12, 9.2M weekly). Acceptable behind our own `extract` interface; keep it swappable.
- **Use `@ast-grep/napi`, not the `ast-grep` package** (the latter is a dead 2018 name).
- **Freshness looks healthy** for every recommended package: react-docgen, dependency-cruiser, orval and the OpenAPI parser all published within the last month; linkedom, ipaddr.js, msw and Radix within a quarter.
- **Two small-audience flags:** `@readme/openapi-parser` (0.8M weekly) and `@stoplight/prism-cli` (0.14M weekly) are niche. Prism stays SPIKE FIRST; the OpenAPI parser is still a reasonable wrap because it sits behind our `importContract` interface.
- **License flags confirmed:** `minimatch` is BlueOak-1.0.0 (permissive, not on the MIT/BSD/ISC/Apache list; `picomatch` MIT is the swap); `@axe-core/playwright` is MPL-2.0 but test-only.
- **Nothing recommended is GPL/LGPL/SSPL/BSL.**
