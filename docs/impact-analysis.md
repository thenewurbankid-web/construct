# Impact analysis: what a change actually touches

`analyzeImpact` (and `construct research impact`) answers one question deterministically: **if I change
these units, what else is affected, and why?** It returns the features touched with their layers, every
implicated file with the reason it is implicated, shared-component warnings, and what the project's own
rules already say about those files.

It is assembly, not new machinery — the layer graph classifies, `packages/engine/units/facts.mjs` parses and
resolves imports, the unit registry resolves any reference, the enforcers supply rule findings. The only
new part is a reverse import index and a bounded traversal over it. Read-only: computing an impact report
never writes anything. No LLM: the whole computation runs offline, and the same input on the same tree
gives byte-identical output.

Contract: [`schemas/impact-report.v1.json`](../schemas/impact-report.v1.json). Code: `packages/engine/impact.mjs`.
Tests: `test/impact.test.mjs` over `example/`, `fixtures/impact-shared` and `fixtures/architecture-invalid`.

## Provenance: where judgement entered

Mapping a note written in English to code is judgement. Everything downstream of "here are the candidate
units" is not. The report keeps the two apart **per row**, not per report:

| | Values | Meaning |
|---|---|---|
| a **seed** | `explicit` / `inferred` | explicit = you named the unit, or it came from a git diff; inferred = guessed from note text (`method: "text-match"`) or proposed by a model (`method: "model"`) |
| an **entry** (file, feature, warning) | `derived` / `inferred` | derived = reachable from at least one explicit seed, i.e. pure graph computation; inferred = *every* path to it starts at an inferred seed |

A file reached from both an explicit and an inferred seed is `derived` — judgement only taints what
judgement alone reached. `confidence` propagates from the strongest contributing seed, and `derivedFrom`
names the seeds an entry came from.

## Seeds

A seed is a string reference — anything `construct summarize` understands — or an object:

```json
{ "ref": "feature:login", "provenance": "inferred", "method": "model",
  "confidence": 0.8, "why": "the note says 'login form'", "evidence": "login form" }
```

| Seed kind | Files it implicates |
|---|---|
| `feature:login` | every source file in the feature |
| `features/login/domain/Login.tsx`, `useLogin`, `LoginPage` | that one file |
| `layer:login/hook`, `layer:domain` | that layer, in one feature or across the project |
| `/login` | the route's entry file |
| `packages/ast`, `features/login` | every file under that directory |
| `rule:PAGE-003` | the files **currently violating** that rule |
| `project:.` | the whole project (expect the cap to bite) |

Unresolvable seeds are reported as `{resolved: false, error}` rows rather than failing the report, so a diff
containing `README.md` still produces a valid report.

## Depth: why 2, and what happens past it

Direction matters, and the two directions are not symmetric:

- **Upstream** (files that *import* a seed) is the blast radius — changing X can break them. This is
  traversed transitively, to `depth` hops (default **2**).
- **Downstream** (files a seed *imports*) is context, not risk. Included at distance 1, marked
  `direction: "down"`, and never expanded.

Depth 2 matches the shape of the layer graph: change a `domain` type and distance 1 is the service or
workflow, distance 2 is the hook or controller — what a developer edits in the same sitting. Distance 3+ is
"and then the page renders", which is true of nearly every file, and is noise.

Nothing is silently dropped. Files one hop past the limit are counted per scope in
`stats.beyondDepth` ("and 40 more in 3 other features"), so the report never pretends the radius ended where
the traversal did. `depth: 0` = seeds only; `depth: -1` = unbounded; `limits.maxFiles` (default 200) caps the
report and raises a `TRUNCATED` warning.

Ranking, deterministic and explainable: `score = 1/(1+distance)`, × 0.6 across a scope boundary, × 0.8 for a
test file, and `files` comes back sorted by it.

## Warnings

| Code | Fires when |
|---|---|
| `SHARED-COMPONENT` | the file is consumed by 2+ other features — counted **through the feature's own barrels**, since the sanctioned cross-feature path is `features/x/index.ts`, which would otherwise hide every consumer behind one edge |
| `CROSS-FEATURE` | the radius leaves the seeded feature(s) — the "I expected 1 feature, it touches 3" indicator |
| `PUBLIC-API` | an implicated file is re-exported from its feature's `index.ts`, so everything downstream is affected |
| `FROZEN-REGION` | an implicated file is inside a configured `frozen:` region (externally authored; Construct does not own it) |
| `TRUNCATED` | the `maxFiles` cap was hit |

## Result shape

`schemaVersion, ok, root, request, summary` (one plain-English line), `seeds[]`, `features[]` (each with its
`layers[]`, each layer carrying what the graph lets it `canImport`), `files[]` (`path, layer, feature, scope,
distance, direction, score, provenance, confidence, purpose, reasons[], derivedFrom[]`), `warnings[]`,
`rules` (violations, exceptions, counts, layer constraints for every touched layer), `stats`, `next[]`.
Errors are `{ok: false, error: {code, message}}` — `INVALID_ARGUMENT`, `ROOT_NOT_FOUND`,
`NO_SEEDS_RESOLVED`, `INTERNAL_ERROR`. Nothing throws.

## API

```js
import { analyzeImpact, impactFromChangedFiles, proposeSeedsFromText, impactFromTicketText }
  from './packages/engine/impact.mjs';

analyzeImpact(root, { seeds, files, depth, limits })  // the one computation
impactFromChangedFiles(root, files, { depth, limits }) // PR health: seeds from a diff, every row derived
proposeSeedsFromText(root, ticketText, { maxSeeds })   // LLM-free note -> candidates, all inferred
impactFromTicketText(root, ticketText, opts)           // the two above, in one call
```

`impactFromChangedFiles` is a one-line delegation, not a second implementation: Research mode (#229) and the
PR-health view (#285) consume the same `analyzeImpact` and differ only in where the seeds come from.

## CLI

```
construct research impact <unit-ref>... [--files a,b] [--since <ref>] [--ticket <text>]
                                        [--ticket-file <path>] [--depth N] [--max-files N]
                                        [--max-seeds N] [--format json|markdown] [--dir <path>]
construct research impact --usage
```

```
$ construct research impact features/shared/components/CurrencyLabel.tsx \
    --dir fixtures/impact-shared --format markdown

## Warnings

- **CROSS-FEATURE** (warning, derived): The seeds live in 1 feature(s) (shared) but the impact reaches 3 more: billing, checkout, reporting.
- **PUBLIC-API** (warning, derived): 1 implicated file(s) are re-exported from features/shared/index.ts: changing them changes feature "shared"'s public API.
- **SHARED-COMPONENT** (warning, derived): features/shared/components/CurrencyLabel.tsx is used by 3 other feature(s): billing, checkout, reporting. A change here is not feature-local.
```

`--since <ref>` seeds the report from `git diff --name-only <ref>`; `--ticket`/`--ticket-file` runs the
heuristic text matcher first, so everything it reaches is marked `inferred`.

## Model-assisted seeds

The text matcher is LLM-free and deliberately modest: exact paths, unique basenames, routes, feature names,
rule ids and exported identifiers, each with the matched substring as `evidence`. A model-assisted proposer
is a drop-in replacement — emit the same seed objects with `method: "model"` and whatever confidence the
model justifies. **Core never calls an LLM**, so impact analysis works with the model offline; the model
proposes entry points, the blocks compute the blast radius.
