# Planner eval: requester, blind grader, owner (#896)

Three separate judges look at the same planner answers, so the eval can be trusted and prompt setups can be compared.

| Role | Goal (its own prompt file) | Sees | Never sees |
|---|---|---|---|
| **Opus-Requester** | act as a product owner: write a general requirement for the app; answer the planner's question as that owner would (`prompts/requester.md`) | the app (`examples/<x>`: route, about, page source, endpoints with one example, story) | the planner's internals (saved answers, decisions), the rubric, the grader |
| **Opus-Grader** | grade the planner's suggestion against the requirement with the rubric; justify in one line (`prompts/grader.md` + `prompts/rubric.md`) | the requirement, the planner's question and the owner's answer, ONE run (labels + Trace path) under a blind id (A, B, ...) | gold labels, the requester's private notes, which run is recommended, real run ids, which picker made a run |
| **Owner** | grade the same items with the same rubric in the Trace UI (`/beam`) | everything the grader saw, the grader's scores; gold labels only after grading the item | gold before grading |

The requester also records **gold labels** (`gold: { source: "requester", intent, object, target: { kind, name }, layers }`),
picked only from the drafter's closed sets (`packages/engine/line/drafter/contract.mjs`: `buildIntentCatalog` intent ids,
`OBJECTS`, slot kinds, `LAYERS`; see `gold.mjs`), plus private `notes` it uses to answer questions consistently.

## Separation guarantees (enforced in code, tested in `beam.test.mjs`)

- Every judge and the planner get their input only from `inputs.mjs`, and each builder is a whitelist that copies named
  fields (never spreads an item).
- The planner gets the requirement **string** only (`buildPlannerRequest`; both planner adapters throw on anything else).
- The requester's answer input carries its notes but **no gold** (the answer goes back to the planner).
- The grader input carries no `gold`, `notes`, `recommended`, `owner` or `grader` key anywhere, and not the notes text
  (`assertGraderInputClean`, run by `judges.mjs` before every grader call and again in the input builder).
- **Blind-ish:** runs are shown in a hash order with blind ids; every run is graded before the recommended run is looked
  up; the item's grader score is then the recommended run's (`grader.revealedAfterGrading: true`, all `runScores` kept).
- The UI's API (`store.view`) withholds `gold` and `notes` until the owner has graded the item.
- Model: every call goes through `judges.mjs` with model `"opus"`; anything else, `fable` above all, is refused.

## Files

```
prompts/requester.md  grader.md  rubric.md     current versions (front matter `version:`)
prompts/archive/<role>.<version>.md            older versions (grader.v1, grader.v2, rubric.v1)
judges.mjs      the ONE module that calls Opus (packages/core/llm.mjs callLlm, provider claude, --model opus,
                --system-prompt <the role's file>); records transcripts; live | replay | fake
inputs.mjs      what each judge may see          gold.mjs      closed sets, gold check, label match
planner.mjs     planner adapter (ask.mjs-backed + fixture)   pipeline.mjs  one run of a setup (runSetup, runAndSave)
agreement.mjs   per-line/overall agreement, summary, review order   store.mjs  results files, owner grades, the UI view
beam-tree.mjs   the beam's run tree folded from events.jsonl (trace/src/beam/contract.mjs events; bad lines -> problems)
metrics.mjs     deterministic metrics per item / layer / arm (#902): NLP recall, prune accuracy and why, runs opened /
                closed, questions, tsc / condition fails, time, arm accuracy, rescued by the beam (no judge, no model)
run.mjs report.mjs                              CLIs
fixtures/record.mjs                             re-records the committed fixtures with a scripted judge (no model)
fixtures/{planner.json,runs/,results/}          three recorded setups: r-v1.g-v1, r-v1.g-v2 (rubric v1), r-v1.g-v3 (rubric v2)
results/<setup>/{items.json,owner.json}         real or replayed runs, owner grades (gitignored)
runs/<setup>/<item>/<step>.json                 transcripts: {promptFile, promptVersion, promptSha, rubricVersion,
                                                model, temperature, input, output, at, mode} (gitignored)
```

A **setup** is `requester version × grader version`, id `r-<v>.g-<v>` (e.g. `r-v1.g-v2`). The rubric version is recorded
with every grade.

**Rubric v2 (owner, #902):** four lines, max 10: `fits` the request (0–3), right `layer` / stub-first (0–3), `asked`
only when needed (0–2), question `clarity` (0–2). Grader v3 is the first grader on it; grader v1/v2 stay on rubric v1, so
old setups keep re-running and comparing.

## Commands

```bash
node trace/eval/beam/run.mjs --apps contacts,orders --items 6 --requester v1 --grader v2 --dry-run   # replay, no model
node trace/eval/beam/run.mjs --apps contacts,orders --items 10 --requester v1 --grader v2            # LIVE: calls Opus
node trace/eval/beam/report.mjs [--setup r-v1.g-v2]                                                 # markdown summary
node trace/eval/beam/fixtures/record.mjs                                                            # re-record fixtures
node --test trace/eval/beam/beam.test.mjs
```

`--planner ask|fixture|recorded` picks the planner (default: `ask` live, `recorded` with `--dry-run`). `ask` runs
`node trace/tools/jev/ask.mjs "<request>" --json` (#904): it fits the request into the Trace example it names with the
beam planner and prints every run (`state` open/closed + `reason`), `recommended`, the plan `steps` or the one closed
`question`, the arms' readings and the events (also streamed to `BEAM_EVENTS_FILE`, which the pipeline points at
`runs/<setup>/<item>/events.jsonl`). Only the open runs are graded; a beam that closed every run has nothing to grade.

The pipeline passes the item's app as `--example trace/examples/<app>` (the request text is unchanged; without it
ask.mjs guesses the example from the request, `exampleFor`). The arms read the request against that example's own facts
(`trace/src/beam/exampleFacts.mjs`: its feature, its one page, the page/list/form fields, the endpoints' fields and the
actions as handler props), not the Line project, so a run's `labels` carry a real intent and the page as target
(`{kind: "page", name: "<app>"}`). Arm names in `arms` are the eval's: static, `sklearn` (the lr and nb arms, merged),
spacy, jev and `zero-shot` (the nli arm).

UI: start Trace (`npm start` in `trace/`) and open `/beam`. The page replays by default; to let its "Re-run with this
setup" button call Opus, start the server with `TRACE_BEAM_LIVE=1` and tick "Live". `TRACE_BEAM_RESULTS` and
`TRACE_BEAM_RUNS` move the data folders (the Playwright spec uses them).

## Editing prompts and the rubric

1. Copy the current file to `prompts/archive/<role>.<old version>.md` (keep its front matter).
2. Edit `prompts/<role>.md` and bump `version:` (v2 → v3).
3. Run a setup with the new version; compare it with the old one in `/beam` ("Compare with") or `report.mjs`.

The rubric's scored lines are its `## <id> — <title> (0–<max>)` headings: the grader's parser and the UI's buttons are
built from them, so keep that format. The grader prompt embeds the rubric (`{{RUBRIC}}`), so a rubric change also bumps
the grader version, and the grader file pins its rubric in front matter (`rubric: v2`). An edit without a version bump still shows up as a different `promptSha` in the transcripts.

## Running for real: calls and cost

Opus calls per item: 1 (requester writes) + 1 if the planner asks a question (requester answers) + 1 per open run (grader;
1 when the beam ends on a plan, up to 4 when it asks). So 2-6 calls per item.

Rough tokens per item (one run, a question on about a third of items): requester write ~5k in (the system prompt lists
the 187 intent ids; the app view is page source + endpoints) / ~0.3k out; answer ~5k in / ~0.1k out; grade ~3k in
(rubric + one run) / ~0.2k out. About 9.5k input and 0.5k visible output, plus Opus 5.5's thinking (always on, default
effort medium; budget ~1-2k more output). At Opus 5.5 API prices ($4 in / $20 out per MTok): about $0.05-0.10 per item,
so `--items 10` is roughly $0.50-1.00 per setup and comparing two setups about double. Calls go through the `claude`
CLI, so with a subscription login they count against that plan instead of API billing.

Temperature: Opus 5.5 accepts no sampling parameters and the CLI has no flag, so every call runs at the model default;
transcripts record `temperature: null, temperatureEnforced: false`. Replay (`--dry-run`) is what makes a run repeatable.
