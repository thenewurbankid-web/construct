# Mission Control

A local, read-only live dashboard of the Construct repo: bench telemetry (the primary panel), agents and worktrees,
commits, the machine, and one event log. Deterministic dev tooling: Node core only, no dependencies, no LLM.

```
npm run mc                                         # or: node packages/tools/dev/mission-control/server.mjs
open http://127.0.0.1:4777                         # ?run=<run dir> pins a bench run
```

| Env | Default | |
|---|---|---|
| `MC_PORT` | `4777` | Port (always bound to 127.0.0.1). |
| `MC_REPO` | the main checkout | Found from the common git dir, so starting it from a worktree still sees everything. |
| `MC_BRANCH` | `work/2026-09-23` | Branch for the commits feed (plus every `og/*`). |
| `MC_RUNS` | | Extra run roots, `:`-separated (for fixtures: `MC_RUNS=packages/tools/dev/mission-control/fixtures/runs`). |
| `CONSTRUCT_HEAVY_LOCK` | `heavy.sh --lock-path` | The heavy-job lock to watch. |

Stop it with Ctrl-C (SIGINT/SIGTERM close every stream and exit).

## Panels

**Bench telemetry.** Watches the newest *real* run: a dir directly under `bench/ecommerce/runs/` (main checkout or any
`.claude/worktrees/*`), newest by its calls/turns log growth. Fixtures (anything under `mission-control/` or a
`fixtures/` folder) and `MC_RUNS` extras are listed in the RUN picker as `FIXTURE · …` but are never auto-picked
(`runs.mjs`). The RUN picker or `?run=` pins any listed run. A banner above the counters says what you are looking at:

- `LIVE — logs growing`: calls.jsonl/turns.jsonl grew in the last 2 minutes and there is no end record.
- `REPLAY — finished run (ended <time>[: stop reason])`: an end record, or no growth for 2 minutes.
- `FIXTURE — not real data`: the run is a fixture or an `MC_RUNS` extra, whatever its age.

Replays step through turn by turn: prev/next buttons, a turn slider, the Left/Right arrow keys, or a click on a
timeline cell highlight that turn's rows and scroll to them ("follow tail" returns to the live end).

Tails, by byte offset with `fs.watch` plus a 1 s poll (partial lines wait for their newline; truncation or replacement
resets):

- `calls.jsonl` (plan-cli.mjs / plain-cli.mjs): `{at, builder, kind: 'call', cmd, args, ms, bytes?, result: {ok, code,
  sentence, stepId, state, landed, tool, rules}}` and `{kind: 'approval', stepId, tool, approvedBy, mechanism}`.
- `turns.jsonl` (qwen-agent.mjs): `start {builder, model, arm, maxTurns, maxMinutes, numCtx}`, `turn {turn, in, out,
  ms, evalMs, promptMs, textCalls, calls: [{name, args, ok, code, sentence}], said}`, `error`, `end {turns, wallMs, stop}`.
- every other text file in `logs/` (`console.log`, builder stdout) as the raw console pane.

The two are joined in order (each turn's tool calls consume the next call records; finish and unknown tools never reach
the CLI), so each row has its turn, tokens (on the turn's first row), call latency and model latency. Calls past the
last turn record are the turn in progress (italic). Claude-builder runs have no `turns.jsonl`: rows are calls numbered
in sequence.

- Row status: `landed` (run-next landed), `not landed [rules]`, `refused CODE`, `error` (CRASH, model error), `ok`,
  `no call` (a turn without a tool call), `finish`. A flag marks typed fixes (`fixOf` in the args, or `line.leaveAsIs`).
- Click a row: the full call args, tool result, approval, turn record and model output (`said`, clipped at 600
  characters by qwen-agent), pretty JSON with a find box; "show prompt" loads `logs/prompt.md` (Claude builders) or
  the arm's `BUILDER-PROMPT*.md` (qwen: static per arm, SPEC.md in place of `{{SPEC}}`).
- Filters: tool, status, refusal code (or click a code chip), text search, follow tail (scrolling up turns it off).
- Counters: turn x/maxTurns, elapsed x/maxMinutes (stops at the last activity when a run went quiet without an end
  record), status, steps added/landed, refusals by code (UNKNOWN_ITEM and any code at 20+ highlighted), typed fixes,
  last validate (or `run tsc`) error count, tokens in/out.
- Loop detector: the same tool and the same refusal code 5 or more times in a row puts up a red STUCK banner with the
  repeating call (click jumps to it). Over `pilot-qwen-7b` it reports the 189x `add line.addRoute -> UNKNOWN_ITEM` loop.
- Timeline: one cell per turn, coloured by outcome (a landed step wins the turn); click a cell to jump.

**Agents & worktrees.** `git worktree list --porcelain` every 5 s. Activity is the newest mtime of each worktree's
git index/HEAD/reflog and its dirty files; green = active in the last 10 minutes. Last commit age and dirty count come
from `git log -1` / `git status --porcelain`, refreshed 12 worktrees per 5 s (changed ones first), because there can be
hundreds.

**Commits.** `git log` of `MC_BRANCH` and `og/*` every 5 s; new commits are highlighted and go to the event log.

**Machine.** Memory (`vm_stat` on macOS, `/proc/meminfo` on Linux), load, the heavy.sh lock (held, pid, `<lock>.holder`),
heavy jobs from `ps` (test runners, Playwright, qwen-agent, npm ci/test, next dev, heavy.sh; child workers fold into
their job as `+N`), and `ollama ps`.

**Event log.** Newest first: new commit, worktree added/moved/removed, process started/ended, model loaded/unloaded,
bench run switched, step landed / not landed, refusals (first 20, then every 10th), STUCK and loop broken, run ended.
History already in a run's logs is shown in the table, not replayed into the log.

**Plan / jev (#892).** The latest `node trace/tools/jev/ask.mjs` request: its labels static vs jev with FORK marks,
the recommended route and the Trace path (collapsible, each node's static pick, jev's pick + confidence, FORK), plus
the latest `eval-intent` table (static vs jev per label, fork rate). Reads `trace/tools/jev/data/ask-log.jsonl`,
`trace/tools/jev/reports/intent-eval.json` and `<MC_JEV_PROJECT>/line/drafter/jev-shadow.jsonl` (default
`examples/line-sample`) in the checkout Mission Control runs from (`plan-jev.mjs`); polled every 3 s.

Every source degrades on its own: a missing git, `ollama` or lock shows as unavailable in its panel and the rest keep
streaming.

## Endpoints

`/` the page, `/events` the SSE stream (`?run=`), `/api/row?id=&run=` one row's full detail, `/api/prompt?run=`,
`/api/plan-jev` (the Plan / jev panel's data), `/api/health`, `/ctx/api?run=` the Context / jev view as JSON. Only discovered run dirs (or dirs under `bench/ecommerce/runs/` or `MC_RUNS`) are readable.

A row's detail also shows, when calls.jsonl has them (#886-#890): "What the model was shown" (`result.shown`: the
refusal with its choices, why, effect and context, a rules card, a spec slice), the context lines with their static
scores (`result.context`), and jev's shadow scores beside them (`shadow`; jev is off and only logged).

### Context / jev (#899)

Open a row in the bench table and press **context / jev** in its detail bar (the toggle stays on as you move between
rows). It shows the run summary (refusals, lines shown of all candidates, kept %, static-vs-jev disagreement % over the
lines jev scored) and, for every refusal in the selected row's turn, each context line with its static score
(`packages/engine/line/context/contextScore.mjs`), jev's shadow score when logged, the rank under each, and KEPT/DROPPED under
the cap (5, or 15 on a repeat). Rows where static and jev disagree on kept/dropped are highlighted. The choices with
why/effect/context, the rules card and the spec slice sit above the table.

Runs from before #886 have no `result.context`: their candidates are rebuilt from the refusal with
`trace/tools/jev/contextLines.mjs` and labelled **reconstructed**; the cap then comes from in-run repeats of the same
code and tool, bounded by `logs/hint-state.json` when present. Code: `context-view.mjs` (pure join + `/ctx/api?run=`),
`context-view.client.js` (served as `/ctx/view.js`).

### Full input / raw output (#913)

When a qwen-agent turn has `logs/turn-input/<turn>.json` and `logs/turn-output/<turn>.json` (default on;
`BENCH_LOG_TURN_IO=0` turns them off), the row detail gets a **full input / raw output** toggle: every message exactly as
sent to Ollama (the system prompt put back from `logs/system-prompt.txt`, referenced by sha256), the options, and the raw
response (thinking, content, native tool calls, parsed calls). Code: `turn-io.mjs` (`/turn-io/api?run=&turn=`),
`turn-io.client.js` (served as `/turn-io/view.js`; it wraps `renderDetail`, so the hook is one script tag).

## Test

```
node --test packages/tools/dev/mission-control/mission-control.test.mjs packages/tools/dev/mission-control/context-view.test.mjs packages/tools/dev/mission-control/plan-jev.test.mjs packages/tools/dev/mission-control/turn-io.test.mjs
```

The parser, join, counters, timeline and loop detector over `fixtures/runs/fixture-qwen` (record shapes copied from
qwen-agent.mjs and plan-cli.mjs); the Context / jev join over `fixtures/runs/fixture-context` (logged context, jev
shadow with two disagreements, an unreachable jev, reconstructed refusals, `hint-state.json`). To see the panel without a live run:
`MC_RUNS=packages/tools/dev/mission-control/fixtures/runs npm run mc`.

## Beam eval panel (#902)

The planner eval of epic #900 (fit the request into the Trace map by parallel runs), below the other panels
(`beam-eval.mjs`, browser side `beam-eval-panel.mjs`; one hook line each in `server.mjs` and `index.html`). Per
requirement: the beam's run tree, live while a run is going (opened, closed with its reason, the run it ended on), tailed
from `trace/eval/beam/runs/<setup>/<item>/events.jsonl`; the arms' readings; the final question and the requester's
answer; the Opus-Grader's score and justification; the owner's score and note (rubric buttons, saved through Trace's
eval API); agreement. On top: the setup summary (mean per judge, agreement rate, items disagreeing by 2 or more first)
and the deterministic metrics (NLP recall, prune accuracy, runs opened/closed, questions, tsc/condition fails, time,
per layer and per arm with the "rescued by the beam" count). It reuses Trace's renderers (`trace/src/ui/beam.mjs`) and
eval API (`trace/src/beam-routes.mjs`): `/beam-eval/*` and `/api/beam/*`. These are the only routes that write
(owner grades, replay re-runs); a re-run calls Opus only when the server runs with `TRACE_BEAM_LIVE=1`.

```
node --test packages/tools/dev/mission-control/beam-eval.test.mjs
```
