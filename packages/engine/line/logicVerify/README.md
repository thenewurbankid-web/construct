# Line logic verification (`logicVerify/`)

Spec: `docs/line/HANDOVER-2026-10-12-import.md`, "Line logic verification (owner, 2026-10-12)". This folder holds
build step 1, the contract: shapes, expected outputs and tests. The later steps (2 to 8) add their modules here.

| File | What |
| --- | --- |
| `contract.mjs` | `UnitVerdict`, `UnitRef`, `EffectLink`, `VerdictLocation`, `LayerResult`, `StepSummary`; the closed id lists (statuses, layers, transform ids, effect names, outcomes, levels); `assert*` checks |
| `verdict.mjs` | `buildUnitVerdict`, `verdictSentence`, `summarizeStep`, `stepSentence`, `shareOf` |
| `escalation.mjs` | `LEVELS` (L0 to L3), `LAYER_ORDER` per purity, `levelsFor`, `layerOrder`, `isDecisive`, `nextLayer`, `decideUnit` |
| `fakes.mjs` | Interfaces for the recording fakes, `EffectRecord`, `UnitRun`, `FAKE_ENV`, the sentinel format (`sentinel`, `findSentinels`), `assertEffectRecord`, `assertUnitRun` |
| `layoutFakes.mjs` | `LAYOUT_FAKE_TYPES` and `LAYOUT_EVENTS` (names from `lib.dom.d.ts`), the `LayoutFakeGenerator` interface, `layoutValues` |
| `canonical.mjs` | Step 3, C1: `canonicalUnit` (one unit to a stable string and a logic-map fingerprint), `canonicalCompare` (the L0 layer, with the exact location on a mismatch), `unitTree`, `locateUnit`, `unitNames`, `PINNED` (esbuild 0.28.2, whitespace and comments only); the one AST-difference locator: `diffLocation`, `locateDifference`, `locateUnitDifference` |
| `roundTrip.mjs` | Step 3: `roundTripCompare` (re-inline the extracted functions, then canonical-compare with the original), `inBlocks` |
| `z3Translate.mjs` | Step 6: `translateFunction` from the TS subset to a solver-neutral IR, `findFunction`, `Unsupported` (subset in the file header) |
| `z3Prove.mjs` | Step 6: `z3Layer` and `proveEqual`; lowers the IR to Z3 (z3-solver, MIT, WASM; numbers as IEEE doubles), per-proof timeout `Z3_TIMEOUT_MS` |
| `fastCheckLayer.mjs` | Step 6: `fastCheckLayer` over `ast/pureExportEquivalence`, seeded by `minedSeeds` (the characterizer's literal pools of both sides) |
| `verifyPair.mjs` | `verifyPair` (the layer walk; one `RUNNERS` registry in `escalation.mjs` order, a layer with no runner answers "skipped" and never decides), `pairBefore`, `classifyBefore` (calls `purity.mjs` `classifyUnit`) |
| `purity.mjs` | Step 2 (B). `classifyUnit({root, file, fn})`: purity and transitive effect chain from Morpheus's import-scan facts (`@mx/morpheus-import` link: `loadProgram`, `collectItems`, `readItem`), plus logic-map effect kinds and HTTP verbs on opaque imports; `classifyLocal` (the fallback with the link down), `morpheusLinked`, `HTTP_VERBS`, `GLOBAL_EFFECTS` |
| `libDom.mjs` | Step 5. Reads TypeScript's own `lib.dom.d.ts` through the compiler API: `libDomInterface(name)` (every member, inherited ones included, with its type text), `valueKindOf` |
| `layoutFakeGen.mjs` | Step 5. `createLayoutFakeGenerator()` (the `LayoutFakeGenerator`): checks `LAYOUT_FAKE_TYPES` against `lib.dom.d.ts`, `make(type, case)` typed fakes, `values`, `cases`, `dom`, `fire`; `typedFake`; reading an unbacked member throws `NotFakedError` (`notFaked.mjs`) naming it |
| `layoutDom.mjs` | Step 5. `createLayoutDom`: window, document, elements, `matchMedia`, `IntersectionObserver`, `ResizeObserver`, window/document/element listeners, all firing under the fake clock |
| `layoutClock.mjs` | Step 5. `createFakeClock()` (a `ClockFake` at `FAKE_ENV.now`): timers, rAF and rendering frames in HTML order (resize, scroll, media change, rAF, ResizeObserver, IntersectionObserver) |
| `layoutMedia.mjs` | Step 5. `parseMediaQuery`, `matchesMedia` (min/max, range syntax, em/rem, `and`, comma lists, `not`/`only`, orientation, fixed user preferences) |
| `importUnits.mjs` | Step 7. `logicCheck` (verifyImport's `logic` check: a `UnitVerdict` per function unit of the import folder in `units`, the `StepSummary` in `summary`, fails only on `changed`), `verifyImportUnits`, `functionUnits`, `folderCodeFiles`, `readImportBaseline`, `materializeBefore`. Layers come from `verifyPair`'s `RUNNERS` by name and `classifyBefore`, so steps 2 and 4 plug in without a change here. `transformsOf` defaults to `importTransforms` (the import plan's done whole-file moves give their units `move` + `repoint-imports`, so an unchanged moved unit is proven; every other unit is null, tested at best) |
| `layoutRun.mjs` | Step 5. `layoutReaders` (pure layout closures of a unit), `runLayoutCases` (the helper step 4's runner calls), `verifyLayoutPair` (the `isolated` layer result for layout) |
| `devServerRun.mjs` | Step 8, L2. `devServerPair` (the `dev-server` LayerResult: the app's own dev server per side over HTTP), `runDevSide`, `envKeysRead`, `envLineStubs`, `formatEnvLine` (`.env.line`), `startFixtureServer`, `fixtureBody`, `routesForFile`, `serverSpawnSpec`, `unitRan` (NODE_V8_COVERAGE) |

Tests:

- `test/line-logic-verify-contract.test.mjs` covers every validator and pure function.
- `test/line-logic-verify-planted.test.mjs` holds the planted fixtures and the acceptance tests for each step (`BUILT` lists the steps whose acceptance tests run).
- `test/line-logic-verify-canonical.test.mjs` covers the canonicaliser's edge cases, the round-trip and verifyPair's L0 walk.
- `test/line-logic-verify-pure.test.mjs` covers the Z3 translator and layer, the fast-check layer, the locator on whole units and verifyPair's pure path.
- `test/line-analyze-cache.test.mjs` covers the analyzeClosure cache; `test/line-logic-verify-import.test.mjs` covers verifyImport's `logic` check.
- `test/line-logic-verify-layout.test.mjs` covers `lib.dom.d.ts`, the layout fakes, DOM, clock, media queries and `verifyLayoutPair`.
- `test/line-logic-verify-purity.test.mjs` covers `classifyUnit` (pure, direct, transitive, unknown imports) and the fallback.
- `test/line-logic-verify-devserver.test.mjs` covers the L2 level on a small node:http fixture app (a real `next dev` runs only through `packages/tools/dev/heavy.sh`).
- The fixtures are in `test/fixtures/logic-verify/`. They are small synthetic snippets written for these tests, not
  taken from any app.

## Spec letters to files

| Letter | Topic | Where now (step 1) | Step that implements it |
| --- | --- | --- | --- |
| A | Closed transform set, Alive2-style validation, outside edits are "tested" | `contract.mjs` `TRANSFORM_IDS`, `TRANSFORM_SOURCES`, `inClosedSet`, and the proven rule in `assertUnitVerdict`; `escalation.mjs` `isDecisive` | 3 |
| B | Pure/impure split with the transitive effect chain | `contract.mjs` `Purity`, `EffectLink`, `EFFECT_NAMES`, `MORPHEUS_EFFECTS`, `LOGIC_KIND_EFFECTS` | 2 (`purity.mjs` `classifyUnit`) |
| C | Layered equivalence and its outcomes, plus the round-trip check | `contract.mjs` `VERIFY_LAYERS`, `LAYER_STRENGTH`, `LayerResult`; `escalation.mjs` `LAYER_ORDER`, `decideUnit` | 3 (C1, round-trip), 6 (C3) |
| D | Isolated execution with recording fakes and sentinels | `fakes.mjs`; step 4: `isolatedRun.mjs`, `isolatedChild.cjs` | 4 (built; hooks and handlers wait for the hook runner) |
| E | Layout as input | `layoutFakes.mjs`; step 5: `libDom.mjs`, `layoutFakeGen.mjs`, `layoutDom.mjs`, `layoutClock.mjs`, `layoutMedia.mjs`, `layoutRun.mjs` | 5 (built; hook closures wait for step 4's runner) |
| F | Escalation from L0 to L3 | `escalation.mjs` `LEVELS`, `levelsFor`, `layerOrder`; `contract.mjs` `LEVEL_OF_LAYER` | 4 (L1), 8 (L2 built: `devServerRun.mjs`; L3 waits) |
| G | Speed | Not in the contract yet. Each `LayerResult` has an optional `ms` field. | 7 |
| H | Atom discovery | Not in the contract yet. It reuses the C1 canonical form. | after 3 |
| I | Where results show | `verdict.mjs` `summarizeStep` (Cockpit step view), `shareOf` ("How smart is it"), `verdictSentence` (refusals) | 7 |

## Entry points the later steps provide

The acceptance tests in `test/line-logic-verify-planted.test.mjs` call these functions. They are marked `todo` until
each step lands.

- `purity.mjs`: `classifyUnit({root, file, fn})` returns `{purity, effectChain}`. This is step 2. `verifyPair.mjs`
  `classifyBefore` calls it. Built.
- `layoutRun.mjs`: `verifyLayoutPair({beforeRoot, afterRoot, unit, beforeFile?})` returns the `isolated` `LayerResult` for a
  unit's pure layout readers. This is step 5; `verifyPair`'s `isolated` runner calls it.
- `isolatedRun.mjs`: `isolatedPair({beforeRoot, afterRoot, before, after, seeds?, timeoutMs?})` is step 4's effect
  runner: both sides run in one child process (`isolatedChild.cjs`: node permission model, no code generation from
  strings, empty env, a `construct-lv-isolated-*` temp dir removed after, SIGKILL at the time limit) under the
  recording fakes, on the same generated inputs; it returns `changed` (the input and the recorded difference),
  `same-behaviour`, or `cant-tell` (an unfaked effect, reported and not executed; the time limit; a load failure).
  `RUNNERS.isolated` gives one result per unit: a change from either runner decides, else a layout answer stands,
  else the effect runner's.
- `verifyPair.mjs`: `verifyPair({beforeRoot, afterRoot, unit, transforms, levels, blocks?})` returns
  `Promise<UnitVerdict>`. Steps 3 to 6 and step 8 build it.
- `verifyPair.mjs`: `verifyStep({step, cases})` returns `Promise<StepSummary>`. This is step 7.

## The canonical form (step 3)

The choices, and why (each is conservative: a false "changed" only falls through to the next layer on a hand edit):

- Locals are renamed by first appearance (`$$0`, `$$1`, ...) with `@typescript-eslint/scope-manager`, so the renaming
  is scope-precise; the unit's own name becomes `$$self`. Free names and property names stay. esbuild's own mangler is
  not used: it picks names by the character frequency of the input, old local names included, so it is not
  rename-stable.
- esbuild prints with whitespace and comment removal only: no syntax minification, so no inlining, folding or
  reordering. Types, comments, quotes and formatting do not count. The file path is never part of the form, so a pure
  move is equal.
- Reordered declarations are not equal, even independent ones: proving independence needs effect analysis.
- An arrow function is not equal to a function declaration (`this`, `arguments`, hoisting, `new` differ).
- The hash is `logicMap.unitFingerprint` of the canonical text plus the pinned printer version: no second scheme.
- esbuild 0.28.2 and scope-manager are resolved from the repo's installed dev dependencies; when either is missing
  the layer answers `cant-tell`.

## verifyPair (steps 3, 5 and 6 combined)

- One `RUNNERS` registry in `escalation.mjs` order: `round-trip` and `L0-canonical` (step 3), `semantic-diff` (no
  runner), `z3` and `fast-check` (step 6, pure units), `isolated` (step 5's `verifyLayoutPair`, then step 4's `isolatedPair`). A
  layer with no runner, or one that cannot take the unit, answers `skipped` and the walk goes on. Skipped layers never
  decide: an undecided unit is `unverified` and names the last layer that actually tried.
- `semantic-diff` has no runner on purpose: `ast/semanticDiff` alpha-renames free names too, so on one unit a call to
  a different function reads as a rename, an unsound "same".
- The unit before the step comes from the caller (`before`) or `pairBefore` (same file and name; else the one function
  with the same canonical form; else the one with the same name). `z3` takes the before name, so a renamed unit is
  still proved; `fast-check` pairs exports by name and skips a renamed unit.
- Purity: `classifyBefore` calls step 2's `classifyUnit`. With the Morpheus link down, `classifyLocal` reads the logic
  map's effect units inside the function plus the effectful globals the domain-purity allowlist reports, with no
  transitive chain; the proof layers stay sound because z3 and fast-check refuse calls and impure bodies themselves.
- One AST-difference locator, `canonical.mjs` `diffLocation`: the side-by-side walk under the scope-precise renaming,
  output `{astPath, file, line, column, side}`. The canonical compare, the round-trip, z3 and fast-check
  (`locateUnitDifference`) and the layout layer (reader closures, from their own path) all use it. A differing leaf is
  named by its parent's segment (`BinaryExpression.right`), as in the contract fixtures.
- The round-trip answers `cant-tell`, not `changed`, when it re-inlined nothing (an expression extracted to a local):
  it has nothing to undo, so the later layers decide.
- z3: numbers are IEEE doubles (no false proof over the reals), a per-proof timeout gives `cant-tell`, anything
  outside the subset is `skipped` with the construct named. fast-check: a "same" is a sample, so the unit is `tested`
  at best; the characterizer's mined literals of both sides seed the runs.
- Layout: only pure layout readers run under the fakes; closures over component state are counted in the reason and
  wait for step 4's hook runner. Reading an unbacked member throws `NotFakedError` naming it, so the result is
  `cant-tell`, never "same".

Speed of `verifyPair` on the seven planted fixtures (2026-10-12, Apple silicon; warm = median of 10 after a warm-up
pass, cold = first call in a fresh process, after about 0.1 to 0.2 s of module load):

| Case | Verdict | Warm | Cold |
| --- | --- | --- | --- |
| `pure-move`, `rename`, `split` | proven, `L0-canonical` | 3 to 4 ms | 165 to 400 ms (esbuild and scope-manager load) |
| `flipped-condition` | changed, `z3` | 7 ms | 290 ms (Z3 WASM load) |
| `dropped-effect` | changed, `isolated` (the expected `effectChain` waits for step 2) | about 70 ms (one sandbox child) | not measured |
| `layout-threshold` | changed, `isolated` | 300 ms | 750 ms |
| `out-of-set` | tested, `fast-check` | 230 ms | 500 ms |

The two slow warm cases spend almost all their time in the characterizer's `analyzeClosure` (about 80 to 110 ms per
root, once per side) for the mined literals, not in the solvers or the fakes. Step 7 caches it per file content:
`characterize/analyzeCache.mjs` `analyzeClosureCached` (bounded LRU, keyed by every closure file's depsHash, the routes,
`charSalt` and the files `env` reads), which `fastCheckLayer.mjs` and `layoutRun.mjs` call.

## The L2 dev-server level (step 8)

`RUNNERS['dev-server']` calls `devServerPair` only when the unit's levels include `L2` (`levelsFor` with
`serverRendered`); the default `['L0', 'L1']` never starts a server. Per side, one at a time:

1. A fixture server on 127.0.0.1 answers every request with `fixtureBody` (sentinel JSON numbered from the method and
   path, so both sides get the same answer) and records method, path and sentinels.
2. `.env.line` is generated in the run's temp dir: every key the app reads (`process.env.X`, `process.env['X']`,
   `import.meta.env.X`, and the key names of its `.env*` files) gets the fixture URL when it looks like an address
   (`URL_KEY`) and a sentinel otherwise. The stubs go into the server's environment, which Next.js and Vite rank above
   `.env` files, so the app's `.env` and code are never edited.
3. The app's `dev` (else `start`) script runs through npm in its own process group with a minimal env (PATH, HOME,
   LANG, TZ, the stubs, PORT, HOSTNAME=127.0.0.1, NODE_V8_COVERAGE). No node flags and no NODE_OPTIONS: never
   `--allow-inspector` (#877); coverage comes from V8's env switch.
4. Each route is requested once (GET, no redirects followed); then SIGTERM to the group (node writes the coverage),
   SIGKILL after the grace period, fixture closed, temp dir removed.

Compared per route: status, redirect target, the sentinels in the HTML in order; then the fixture requests (sorted).
The first difference is `changed` with `input: {route}` and the unit's location (the AST locator). A "same" where
the coverage shows the unit never ran on either side is `cant-tell`; unreadable coverage keeps the "same" and says so.
A side that does not start or a request past the time limit is `cant-tell`; no route or no script is `skipped`.

Choices where the spec is open (the simplest deterministic option each time):

- Routes: the caller passes them (`verifyPair({routes})`, from the G1 impact graph); otherwise `routesForFile` maps a
  Next.js `app/**/page|route` or `pages/**` file to its route, dynamic segments filled with sentinels. A unit in any
  other file has no route and the layer is skipped.
- `.env.line` lives in the run's temp dir, not the app root, and reaches the server as environment variables.
- The two sides run one after the other, not in parallel (one dev server at a time on a 15 GB box).
- "Ran" is a function of the unit's name with a non-zero count in any script under the app root (sources or its
  dev build), node_modules excluded.
- The dev server itself is not under node's permission model (a dev server writes its build dir); its outbound
  addresses are the fixture's, so the app's real backends are not called through the env.



| Case | Edit | Expected verdict | Step |
| --- | --- | --- | --- |
| `pure-move` | The file moves | proven, `L0-canonical` | 3 |
| `rename` | `total` is renamed to `cartTotal` | proven, `L0-canonical` | 3 |
| `split` | One file is split into two and the import is re-pointed | proven, `L0-canonical` | 3 |
| `flipped-condition` | `>=` becomes `>` (a hand edit) | changed, `z3`, input `[18]` | 6 |
| `dropped-effect` | A `toast.success` call is removed (a hand edit) | changed, `isolated`, at the old line | 4 |
| `layout-threshold` | The breakpoint `768` becomes `640` | changed, `isolated`, input `Window.innerWidth: 640` | 5 |
| `out-of-set` | A template literal is rewritten as `join` | tested, `fast-check` | 6 |

For each case:

- `cases.json` holds the case's before-side `{file, fn}`, its transforms, its levels and the answers each layer is
  expected to give.
- `<case>/expected.json` holds the expected `UnitVerdict`.
- `expected-summary.json` holds the step summary over all seven cases.
- Unit fingerprints in the fixtures are local to the fixtures, not logic-map hashes. `verifyPair` receives the unit,
  so it returns the same fingerprint.
