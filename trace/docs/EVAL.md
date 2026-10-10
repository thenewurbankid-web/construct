# Measuring Trace: the eval harness

Nothing is "better" unless it is measured. `eval/` is a deterministic harness that scores Trace against ground truth, records today's algorithm as the baseline, and gates changes against it. It measures only: it changes no matching or generation behaviour.

## Read this first: what the numbers can and cannot tell you

**The gate is a REGRESSION detector, not an accuracy measurement.** Ground truth comes from three places, and every part carries its label (`truth.label`); the report prints a *label independence* line and splits the headline by it:

| label | where the truth comes from | what its numbers mean |
|---|---|---|
| `independent` | a person's judgment from the design, the contract's own docs or a story (`benchmarks/gold.json`, `story.md`, contract `docs`), or a filled labelling worksheet | the only evidence of accuracy. Small (about 90 parts, all from the 11 examples), so read its 95% interval, not its point value |
| `reference` | the 62 synthetic cases: the generator's intent, checked by `eval/reference.mjs`, which is a plain COPY of the transform library | Trace is scored against a copy of its own vocabulary. Good at catching regressions and at the adversarial categories it was built for; says nothing about real screens |
| `self` | parts of the 11 examples that Trace settled by itself and nothing else vouched for: the truth IS Trace's answer | **circular: measures regression, not accuracy.** Precision and recall here are 100% by construction; a wrong accept cannot show up |

The independent tier grows by having someone fill the blind worksheets (see *Blind labelling worksheets*); until then treat "96% precision" as "unchanged since the baseline", not "96% right".

Wrong-accept rate is reported over **both denominators** wherever the headline appears: over data parts (row columns, values, row order, endpoint; the number the gate uses) and over all scored parts (actions included). Today's baseline over everything: 15/585 data parts (2.56%), 15/872 all parts (1.72%).

**Rule: no algorithm change merges without an eval run.** Run `npm run eval:gate`; if a number moves on purpose, change `eval/config.json` tolerances and re-record `eval/baseline.json` (`npm run eval:baseline`) in the same commit, with the reason in the message.

## Commands

| command | what it does |
|---|---|
| `npm run eval` | baseline over `eval/cases`; writes `eval/out/report.json`, `report.md`, `report.html` (self-contained, inline SVG) |
| `npm run eval -- --variant <name>` | another variant, plus a paired comparison with `baseline` per category |
| `npm run eval -- --scale` | also times `eval/scale` (50, 200, 1000, 2000 parts) |
| `npm run eval -- --ai` | also asks the AI layer every question (task models from `ai.config.json`; skipped with a reason if the model is unreachable; `--ai-limit N`) |
| `npm run eval:gate` | fresh run vs `eval/baseline.json`; exit 1 on a regression |
| `npm run eval:baseline` | rewrite `eval/baseline.json`; refuses if the determinism check finds unexpected drift |
| `npm run eval:triage` | worst cases per category, why they failed, and the multiple-choice question that would have prevented each |
| `npm run eval:promote -- <caseId> --from <dir>` | turn a real run's Ledger into a committed case |
| `npm run eval:labels` | export anonymised labelled decisions to `eval/labels/*.jsonl` |

The JSON files have sorted keys at every depth and everything machine-dependent sits under `timing` or `ai`, so a dashboard can ingest them; `report_hash` is the fingerprint of the rest. Two runs are identical apart from `timing`.

## What each metric means (per tier: independent, reference, self, all)

A **part** is one dynamic thing on a screen: a row column, a page value, the row order, an action. Trace either *accepts* a wiring for it by itself (confident, no question) or *asks*. Ground truth for a part is `match` (the data settles it), `needs-answer` (a tie the data cannot settle; the recorded answer is the truth) or `gap` (nothing in the API provides it). Parts marked `uncertain` are excluded from every number and only counted.

- **precision**: of the wirings Trace accepted by itself, the share that equal the truth.
- **recall**: of the `match` parts, the share Trace accepted correctly (parts that need a transform outside the closed library count as misses; see *library-gap misses*).
- **F1**: harmonic mean of the two.
- **wrong-accept rate**: parts wired confidently and wrongly, per data part. The most important number: these are the errors nobody is asked about.
- **coincidence catch rate**: among parts where a wrong explanation also fits the design's values, the share where Trace did not wire the wrong one (it asked, or was right).
- **questions per screen**: questions Trace would ask in `--yes`/auto mode.
- **unnecessary-question rate**: asked questions whose recorded expected answer equals the default (first) option. Questions whose gap resolution was never recorded by a person are left out of both sides.
- **oracle accuracy**: answer every question with the ground-truth answer, then check the final wiring equals the truth for every part. Below 100% means Trace cannot express the truth, or wired a part without asking.
- **coupled-tie excess**: questions asked about parts tied on the same fields, beyond one decision per group (answering one settles the rest).
- **library-gap misses**: `match` parts whose truth needs a transform Trace does not have.
- **determinism**: each case is run twice, with the `apis` list in another order, and with JSON keys reordered; hashes of every generated file, of the question list and of the per-part predictions must match. Repeat and endpoint-order drift fail the gate. Key order is reported separately, because the mock and domain-test files legitimately echo the input's key order; any other file or the question set changing with key order counts as key-order sensitivity, and the gate fails if it grows. Today's known endpoint-order dependence (`findEndpoints` takes the first list-like GET) is listed in `eval/config.json` under `knownDrift` with its reason.
- **runtime**: p50/p95 per case, and a scaling curve over the scale cases with a plain verdict on whether compute is a bottleneck.
- **AI**: accepted-and-correct accuracy, abstention rate, coverage-accuracy curve and Expected Calibration Error (only for providers that report a confidence, e.g. open-jev), tokens and latency. Model dependent, so never gated.

## How to read a diff

`npm run eval -- --variant X` prints the headline and writes `report.md` with a table per category and metric: baseline, variant, difference with a 95% bootstrap interval, and a verdict. The bootstrap is seeded and resamples cases (parts inside a screen are not independent); both variants are recomputed on the same resample. **real improvement / real regression** = the interval excludes zero; **noise** = it does not, so do not claim it. Fewer questions is only a win if wrong-accepts did not rise (see `tie-first`). The gate reads `eval/baseline.json`; a `FAIL` line names the metric, scope (headline or category) and the tolerance.

## How to add a case

- **From a real run**: `npm run eval:promote -- my-case --from path/to/feature-dir [--status status.json]`. The folder's `answers.json` is read as the human's decisions; answers that `decisions.json` attributes to the AI, parts Trace settled itself, and parts still open are marked `uncertain` until you review them in `eval/cases/my-case/case.json` (delete the flag or fix `want`). Then re-record the baseline.
- **By hand**: a folder in `eval/cases` with `case.json` (`id`, `category`, `truth`), `feature.json`, `page.jsx`, optional `story.md`. `truth` maps a part id (`list.owner`, `value.total`, `list.sort`, `action.row.delete`, `endpoint.list`) to `{ kind, want }`, where `want` is one canonical string (see `eval/truth.mjs`): `f:lead|asText`, `a:sum(budget)|moneyCompact`, `e:meta.date|dateShort`, `s:amount:desc`, `x:remove`, `gap:todo|custom|static`, or `u:<field>|<recipe>` for a truth outside the closed library. Optional: `also` (other acceptable answers), `coincidence`, `couple` (parts settled by one decision), `uncertain: "reason"`, `resolutionUnknown`.
- **Synthetic**: add a params entry in `eval/tools/build-corpus.mjs` and run it, or a new builder in `eval/generate.mjs`. Builders state what a design means; the truth *kind* is derived from the independent reference explainers in `eval/reference.mjs`, and a draw that is not what the builder promised is rejected. Only `{ name, seed, params }` is committed; `expect` pins a hash so a generator change that moves a case is caught by the tests.
- The contract format lives in one place, `readContract`/`writeContract` in `eval/adapter.mjs`, which reads OpenAPI files with Trace's own loader (`src/contract.mjs`).

## How to add a variant

Register it in `eval/variants.mjs`:

```js
registerVariant({
  name: "my-idea",
  describe: "one sentence",
  analyze(extracted, spec) { /* steps 2-3 of the pipeline */ return { matched, questions }; },
});
```

`analyze` replaces match + buildQuestions (start from `baselineAnalyze`); scoring, the oracle run, determinism and reports are shared. An optional `generate({dir,out,loaded,spec}) -> { file: hash }` replaces the default `src/pipeline.mjs` run for the generated-file hashes. Then `npm run eval -- --variant my-idea`. Included: `baseline`, `tie-first` (negative control that must fail the gate), `confirm-small-numbers` (an ablation that asks about bare numbers).

## Question forms (triage)

`confirm-or-pick` ("F will be used for X: confirm, or pick another"), `which-field` (ranked candidates), `plan` (plan 1 or plan 2 for parts tied on the same fields), `recipe` (pick how to turn the value into the text), `endpoint` (which endpoint feeds the list). `eval:triage` maps every failure to one of them.

## Blind labelling worksheets (growing the independent tier)

`npm run eval:worksheet` writes, for each of the 11 examples, `eval/labeling/worksheets/<case>.json` and `.md`: for every part the design's text, examples, column header and surrounding words, and the contract's endpoints, fields with sample values, docs and story. It does **not** show Trace's matches, candidates, questions, `answers.json`, `decisions.json` or the case's current truth (a test checks the generator does not import the matcher or the truth). A person, or a separate agent that has not seen Trace's output, fills `answer.want` (one canonical string; the grammar is at the top of the worksheet) and `labeller`, or fills the Markdown copy, and saves it as `eval/labeling/filled/<case>.json` or `.md`. **Do not fill a worksheet with Trace's own answers.**

`eval/labeling/fold.mjs` folds a filled worksheet into the case's truth when the case loads: each answered part becomes `label: "independent"` (kind `gap` for `gap:*`, otherwise `match`, or `needs-answer` when the reference explainers find a tie in the data), an `unsure` part becomes uncertain (excluded), and a part the labeller left empty keeps its earlier truth. An independent label that disagrees with the earlier truth replaces it and is reported in `labelConflicts`. `node eval/labeling/fold.mjs` validates every filled worksheet. The corpus hash changes when labels change, so re-record the baseline in the same commit.

## Contract formats

The contract is read in exactly one place, `readContract`/`writeContract` behind `loadCase` in `eval/adapter.mjs`, and an `openapi.json` / `.yaml` / `.yml` file in the folder is read with `readSpec` from `src/contract.mjs`: the eval uses the same loader as the pipeline, so the two can never disagree about what a contract says (there is no second OpenAPI reader). The frozen cases (`eval/cases/*/feature.json`, and the generated ones) keep the contract as `apis`, a neutral snapshot of the example bodies; when the runner writes a case's inputs for the pipeline it turns `apis` into an `openapi.json` with `src/apis-to-openapi.mjs`, so what is scored is what Trace reads. A folder without an openapi file falls back to `apis` in `feature.json`. `eval/fixtures/openapi-tiny` is the test fixture. The frozen `eval/cases/example-*` folders keep a copy of the example's contract as it was when snapshotted.

**R0 note.** Feeding the pipeline an OpenAPI file groups a shuffled `apis` list by path, so the endpoint-order check now also flags `decoy-endpoint-01` (another case of the documented `decoy-endpoint` weakness: the first list-like GET wins). `eval/baseline.json` was regenerated once for that; the headline numbers (wrong-accept 2.56%, recall 96.26%, oracle accuracy 96.56%) did not move.

## Ledger labels and privacy

`eval/export-labels.mjs` writes one JSON line per answered question: part, options offered (kind, field, formatter, aggregate, cost), the option chosen, and who decided (`human`, or `ai` with the model). By default it contains **structure only**: part and field names, no example values from the design or the API, no story text, no AI evidence sentences, and the case id is a hash of the folder name. `--hash-names` also hashes part and field names; `--include-values` adds the design's example and the AI's cited sentence, so use it only on data you may share. Note that today's recorded answers are mostly the small model's, not a person's: filter on `decided_by` before training on them.

## Limits, said plainly

- Ground truth for the eleven examples: the parts Trace did not settle by itself come from `benchmarks/gold.json`, the stories, READMEs and the contract docs (independent, one reviewer's judgment); where it depends on a design decision it is `uncertain` (counted in the report). The 106 parts Trace settled by itself are `self`-labelled and circular until worksheets are filled.
- Synthetic cases only contain what the generator can build, and their truth comes from a copy of the transform library. The baseline is near-perfect on the categories it was designed for and fails on the ones built to break it. Do not read the headline as accuracy on real screens.
- The corpus is small (about 870 scored parts): category numbers move in whole parts.
- The coupled-tie truth assumes distinct columns map to distinct fields.
