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

**Bench telemetry.** Watches the newest run dir (`bench/ecommerce/runs/<name>/logs/`, newest log mtime) across the main
checkout and every `.claude/worktrees/*`; the RUN picker or `?run=` pins one. Tails, by byte offset with `fs.watch`
plus a 1 s poll (partial lines wait for their newline; truncation or replacement resets):

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

Every source degrades on its own: a missing git, `ollama` or lock shows as unavailable in its panel and the rest keep
streaming.

## Endpoints

`/` the page, `/events` the SSE stream (`?run=`), `/api/row?id=&run=` one row's full detail, `/api/prompt?run=`,
`/api/health`. Only discovered run dirs (or dirs under `bench/ecommerce/runs/` or `MC_RUNS`) are readable.

## Test

```
node --test packages/tools/dev/mission-control/mission-control.test.mjs
```

The parser, join, counters, timeline and loop detector over `fixtures/runs/fixture-qwen` (record shapes copied from
qwen-agent.mjs and plan-cli.mjs). To see the panel without a live run:
`MC_RUNS=packages/tools/dev/mission-control/fixtures/runs npm run mc`.
