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
| `layoutRun.mjs` | Step 5. `layoutReaders` (pure layout closures of a unit), `runLayoutCases` (the helper step 4's runner calls), `verifyLayoutPair` (the `isolated` layer result for layout) |

Tests:

- `test/line-logic-verify-contract.test.mjs` covers every validator and pure function.
- `test/line-logic-verify-planted.test.mjs` holds the planted fixtures and the acceptance tests for each step (`BUILT` lists the steps whose acceptance tests run).
- `test/line-logic-verify-canonical.test.mjs` covers the canonicaliser's edge cases, the round-trip and verifyPair's L0 walk.
- `test/line-logic-verify-pure.test.mjs` covers the Z3 translator and layer, the fast-check layer, the locator on whole units and verifyPair's pure path.
- `test/line-logic-verify-layout.test.mjs` covers `lib.dom.d.ts`, the layout fakes, DOM, clock, media queries and `verifyLayoutPair`.
- `test/line-logic-verify-purity.test.mjs` covers `classifyUnit` (pure, direct, transitive, unknown imports) and the fallback.
- The fixtures are in `test/fixtures/logic-verify/`. They are small synthetic snippets written for these tests, not
  taken from any app.

## Spec letters to files

| Letter | Topic | Where now (step 1) | Step that implements it |
| --- | --- | --- | --- |
| A | Closed transform set, Alive2-style validation, outside edits are "tested" | `contract.mjs` `TRANSFORM_IDS`, `TRANSFORM_SOURCES`, `inClosedSet`, and the proven rule in `assertUnitVerdict`; `escalation.mjs` `isDecisive` | 3 |
| B | Pure/impure split with the transitive effect chain | `contract.mjs` `Purity`, `EffectLink`, `EFFECT_NAMES`, `MORPHEUS_EFFECTS`, `LOGIC_KIND_EFFECTS` | 2 (`purity.mjs` `classifyUnit`) |
| C | Layered equivalence and its outcomes, plus the round-trip check | `contract.mjs` `VERIFY_LAYERS`, `LAYER_STRENGTH`, `LayerResult`; `escalation.mjs` `LAYER_ORDER`, `decideUnit` | 3 (C1, round-trip), 6 (C3) |
| D | Isolated execution with recording fakes and sentinels | `fakes.mjs` | 4 |
| E | Layout as input | `layoutFakes.mjs`; step 5: `libDom.mjs`, `layoutFakeGen.mjs`, `layoutDom.mjs`, `layoutClock.mjs`, `layoutMedia.mjs`, `layoutRun.mjs` | 5 (built; hook closures wait for step 4's runner) |
| F | Escalation from L0 to L3 | `escalation.mjs` `LEVELS`, `levelsFor`, `layerOrder`; `contract.mjs` `LEVEL_OF_LAYER` | 4 (L1), 8 (L2, L3) |
| G | Speed | Not in the contract yet. Each `LayerResult` has an optional `ms` field. | 7 |
| H | Atom discovery | Not in the contract yet. It reuses the C1 canonical form. | after 3 |
| I | Where results show | `verdict.mjs` `summarizeStep` (Cockpit step view), `shareOf` ("How smart is it"), `verdictSentence` (refusals) | 7 |

## Entry points the later steps provide

The acceptance tests in `test/line-logic-verify-planted.test.mjs` call these functions. They are marked `todo` until
each step lands.

- `purity.mjs`: `classifyUnit({root, file, fn})` returns `{purity, effectChain}`. This is step 2. `verifyPair.mjs`
  `classifyBefore` calls it. Built.
- `layoutRun.mjs`: `verifyLayoutPair({beforeRoot, afterRoot, unit, beforeFile?})` returns the `isolated` `LayerResult` for a
  unit's pure layout readers. This is step 5; `verifyPair`'s `isolated` runner calls it. Step 4's effect runner joins
  that runner (`RUNNERS.isolated` in `verifyPair.mjs`) and gives one `isolated` result per unit.
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
  runner), `z3` and `fast-check` (step 6, pure units), `isolated` (step 5's `verifyLayoutPair`; step 4 joins it). A
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
| `dropped-effect` | unverified (step 4 todo) | 2 ms | 160 ms |
| `layout-threshold` | changed, `isolated` | 300 ms | 750 ms |
| `out-of-set` | tested, `fast-check` | 230 ms | 500 ms |

The two slow warm cases spend almost all their time in the characterizer's `analyzeClosure` (about 80 to 110 ms per
root, once per side) for the mined literals, not in the solvers or the fakes; step 7 should cache it per file content.

## Planted fixtures

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
