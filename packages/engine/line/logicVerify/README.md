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
| `canonical.mjs` | Step 3, C1: `canonicalUnit` (one unit to a stable string and a logic-map fingerprint), `canonicalCompare` (the L0 layer, with the exact location on a mismatch), `locateUnit`, `unitNames`, `PINNED` (esbuild 0.28.2, whitespace and comments only) |
| `roundTrip.mjs` | Step 3: `roundTripCompare` (re-inline the extracted functions, then canonical-compare with the original), `inBlocks` |
| `verifyPair.mjs` | `verifyPair` (the layer walk; `RUNNERS` holds the built layers, L0-canonical and round-trip so far), `pairBefore`, `classifyBefore` |

Tests:

- `test/line-logic-verify-contract.test.mjs` covers every validator and pure function.
- `test/line-logic-verify-planted.test.mjs` holds the planted fixtures and the acceptance tests for each step (`BUILT` lists the steps whose acceptance tests run).
- `test/line-logic-verify-canonical.test.mjs` covers the canonicaliser's edge cases, the round-trip and verifyPair's L0 walk.
- The fixtures are in `test/fixtures/logic-verify/`. They are small synthetic snippets written for these tests, not
  taken from any app.

## Spec letters to files

| Letter | Topic | Where now (step 1) | Step that implements it |
| --- | --- | --- | --- |
| A | Closed transform set, Alive2-style validation, outside edits are "tested" | `contract.mjs` `TRANSFORM_IDS`, `TRANSFORM_SOURCES`, `inClosedSet`, and the proven rule in `assertUnitVerdict`; `escalation.mjs` `isDecisive` | 3 |
| B | Pure/impure split with the transitive effect chain | `contract.mjs` `Purity`, `EffectLink`, `EFFECT_NAMES`, `MORPHEUS_EFFECTS`, `LOGIC_KIND_EFFECTS` | 2 (`purity.mjs` `classifyUnit`) |
| C | Layered equivalence and its outcomes, plus the round-trip check | `contract.mjs` `VERIFY_LAYERS`, `LAYER_STRENGTH`, `LayerResult`; `escalation.mjs` `LAYER_ORDER`, `decideUnit` | 3 (C1, round-trip), 6 (C3) |
| D | Isolated execution with recording fakes and sentinels | `fakes.mjs` | 4 |
| E | Layout as input | `layoutFakes.mjs` | 5 |
| F | Escalation from L0 to L3 | `escalation.mjs` `LEVELS`, `levelsFor`, `layerOrder`; `contract.mjs` `LEVEL_OF_LAYER` | 4 (L1), 8 (L2, L3) |
| G | Speed | Not in the contract yet. Each `LayerResult` has an optional `ms` field. | 7 |
| H | Atom discovery | Not in the contract yet. It reuses the C1 canonical form. | after 3 |
| I | Where results show | `verdict.mjs` `summarizeStep` (Cockpit step view), `shareOf` ("How smart is it"), `verdictSentence` (refusals) | 7 |

## Entry points the later steps provide

The acceptance tests in `test/line-logic-verify-planted.test.mjs` call these functions. They are marked `todo` until
each step lands.

- `purity.mjs`: `classifyUnit({root, file, fn})` returns `{purity, effectChain}`. This is step 2.
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
- Until step 2 lands, `classifyBefore` falls back to the logic map's effect units inside the function (no
  transitive chain).

Speed on the planted fixtures (warm): about 2.3 ms per unit, 2.9 ms per canonical compare, 5.5 ms per `verifyPair`.
The first unit in a process pays about 0.5 s to load esbuild and scope-manager.

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
