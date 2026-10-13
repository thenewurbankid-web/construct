# Isolation harness (#941)

The arms, runs and findings are in `RESEARCH.md` and `config.mjs`; `run.mjs` runs them. This page covers driving
the 1.5b from outside: a harness (Claude Code, OpenCode, ...) or a person.

## Driving the 1.5b: drive.mjs, drive-mcp.mjs, harness-drive.sh

`drive.mjs` is a small CLI over the same blocks as arm H (briefBuilder, sampler, spliceApplier, check-runner).
Every call prints at most 40 lines (`show-code` prints whole starting files).

```
node bench/isolation/drive.mjs show t03-book-availability        # SPEC excerpt + function, signature, header, types; no file
node bench/isolation/drive.mjs show-code t03-book-availability   # SPEC excerpt + the full starting file (CW arm only)
node bench/isolation/drive.mjs try t03-book-availability --brief brief.txt --run cd1   # 1.5b, N<=5, T 0.7 top_p 0.8 top_k 20
node bench/isolation/drive.mjs check t03-book-availability --file BookPage.tsx --run cd1   # tsc + task check, no model
node bench/isolation/drive.mjs summary --run cd1
```

- `try` runs itself under `packages/tools/dev/heavy.sh` (it may wait for another Ollama job). By default the brief is
  an intent note: the 1.5b gets briefBuilder's brief for each function plus the note as `LEAD'S NOTE` (arm I's
  pattern), one sampled round per function. `--raw` sends the brief alone as the whole prompt.
- One function per request. `blocks/briefGuard.mjs` rejects a brief that holds an implementation (a function body
  over 2 statements, or more than 3 consecutive code lines) or, on a multi-function task, names another target
  function; a rejection is logged as a try (`FAIL brief`). Multi-function tasks need `--fn <name>` (MCP `fn`): each
  call runs that function's round on the file the earlier rounds built, `OK <fn>` until the last one is checked.
- `blocks/prefill.mjs`: the 1.5b is called through `/api/generate` with `raw: true` and the ChatML template applied
  here, the assistant turn prefilled with the exact signature plus `{`, stopped at a column-0 `}` and cut by brace
  depth; the prompt names only that function (`fnGoal` narrows the task statement). spliceApplier stays strict.
- Output: `PASS (...)` or `FAIL <format|fragment|tsc|check|error> (...)` plus the first error (at most 5 lines).
- Log: `results/claude-drive/<run>.jsonl`, one line per try (arm CD) or check (arm CW): task, harness, attempt,
  brief or written chars, 1.5b calls, tokens in/out, wall ms, pass, failure class.

`drive-mcp.mjs` exposes the same four commands as stdio MCP tools (`task_show`, `task_show_code`, `task_try` with the
brief as a string, `task_check` with the file content as a string). Each tool runs the CLI, so behaviour and logging
are identical; inputs are kept under `results/claude-drive/{briefs,written}/<run>/`. Env: `DRIVE_RUN`, `DRIVE_HARNESS`.
Bench-local until a measured win moves it into `packages/mcp`.

`harness-drive.sh` runs one fresh headless session per task and arm, with only two MCP tools each and no shell or
file tools. Default arms: CD (`task_show` + `task_try`, the brief is a note on briefBuilder's brief; the harness
never sees the file), CD-raw (same tools, `task_try` with `raw: true`: the brief is the whole 1.5b prompt) and CW
(`task_show_code` + `task_check`).

```
bench/isolation/harness-drive.sh --harness claude --run cd1
bench/isolation/harness-drive.sh --harness opencode --run cd1 --model ollama/qwen3:4b
```

Session results land in `results/claude-drive/<run>/<harness>-<arm>-<task>.json` (usage incl. cache read/write,
num_turns, total_cost_usd, duration_ms, model); `summary` joins them with the JSONL per task, arm and harness.
OpenCode runs from a throwaway project dir with its own `opencode.json`; the global config is not touched. Its
default model (OpenCode's free tier) refuses headless runs (403 FreeTierError), so pass `--model`.

Tests (no model): `node --test bench/isolation/test/drive.test.mjs`.
