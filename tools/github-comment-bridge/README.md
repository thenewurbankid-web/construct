# github-comment-bridge

A small, standalone poller that lets a human trigger a real `claude` CLI run by
posting a specially-formatted comment on a GitHub issue, and reports the
result back on that same issue.

This is **not** part of the Construct CLI, the `src/` architecture tooling, or
the `ui/` app. It has its own `package.json`, separate from the rest of the
repo — its GitHub API calls go through `@octokit/rest` (the official SDK,
#94), and it uses Node's built-in `child_process` for running the `claude`
CLI itself.

It runs as its own long-lived OS process, in its own terminal. It is not
embedded in any particular Claude Code session, and it keeps working after
whatever session started it has ended — that's the point: it's a bridge
between "someone leaves a comment on GitHub" and "the `claude` CLI actually
does something about it," independent of any one conversation.

## Why polling, not a webhook

There is no public endpoint to receive GitHub webhooks here, and standing one
up would need a tunnel and a different token/setup story. Polling the REST
API on an interval is simpler, needs only a personal access token, and is
good enough for a human posting a comment every so often.

## The one trigger pattern

A comment fires a run **only if its first line is exactly**:

```
/claude <instruction text>
```

- Case-sensitive. Must be the first line of the comment (leading/trailing
  blank lines aside from that don't count — it's line 1 or nothing).
- Anything else — a comment that merely mentions "claude", or has `/claude`
  somewhere other than the start of line 1 — is ordinary discussion and is
  **never** treated as a trigger. This is the only supported pattern,
  intentionally, so there's no ambiguity about what will or won't fire a
  run.
- Text on lines after the first is included as additional instruction
  detail (folded into the same instruction sent to `claude`), so you can
  write a short trigger line followed by a longer explanation.
- `/claude` with nothing after it and no follow-up lines is not a trigger
  (there'd be no instruction to run).

Examples that **do** trigger:
```
/claude investigate why the Playwright suite in #37 is flaky and propose a fix
```
```
/claude
Please re-read the latest discussion above and update the plan accordingly.
```

Examples that **do not** trigger:
```
I wonder if /claude could help here.
```
```
Claude, can you take a look?
```

## Session continuity per issue

Since this runs as a separate OS process, it can't literally "resume a
subagent" from some other Claude Code session. The real equivalent that
exists is the `claude` CLI's own `--resume <session-id>` flag combined with
`--output-format json`, which returns a `session_id` in its result.

This tool keeps a local `sessions.json` map of `{ "<issueNumber>": "<claude session id>" }`.

- The **first** `/claude ...` trigger on a given issue starts a fresh
  `claude` session (no `--resume` passed) and records the `session_id` it
  returns.
- Any **later** `/claude ...` trigger on that same issue passes
  `--resume <that session id>`, so `claude` continues the same
  conversation/context instead of starting cold — it remembers what it
  already did on that issue.
- Different issues get different, independent sessions.

This was verified by hand, not assumed — see "What was actually verified"
below.

## What each trigger runs

When a trigger comment is detected, the bridge:

1. Fetches the issue's title and a short excerpt of its body via the GitHub
   API.
2. Builds a prompt containing the issue number, title, body excerpt, and the
   triggering comment's instruction text.
3. Posts an immediate "Working on it..." acknowledgement comment on the
   issue (so it's obvious on GitHub that something is happening).
4. Runs, in the repo directory:
   ```
   claude -p "<the built prompt>" \
     --output-format json \
     --permission-mode acceptEdits \
     [--resume <session id, if this issue has one>] \
     [--max-budget-usd <cap, if configured>]
   ```
   - `-p` (print mode) + `--output-format json`: run one non-interactive
     turn and return a single parseable JSON object (including
     `session_id`, `result`, `total_cost_usd`, `is_error`, etc.) instead of
     an interactive session.
   - `--permission-mode acceptEdits`: this is deliberately **not**
     `--dangerously-skip-permissions` / `--allow-dangerously-skip-permissions`
     (a full bypass of all permission checks). `acceptEdits` is the scoped
     mode that lets Claude actually read/write files and run tools headlessly
     — there's no human present to click "approve" — without granting the
     broadest possible access. This was tested directly (see below): it
     successfully ran a shell command and wrote a file with zero permission
     prompts or denials.
   - `--max-budget-usd`: an optional per-run spend cap (default `3`,
     configurable, see below) as a safety valve against a single triggered
     run running away on cost.
5. Waits for that `claude` run to finish (synchronous per trigger — the next
   poll cycle only starts once the current one's triggers are all handled),
   then posts a second comment on the issue summarizing the result (or the
   error, if the run failed or timed out).

## Comment de-duplication ("last seen" cursor)

State is kept in `.state/state.json` (gitignored, created on first run):

```json
{
  "initialized": true,
  "lastSeenCommentId": 123456,
  "lastPollIso": "2026-09-16T18:00:00.000Z",
  "botLogin": "your-bot-account"
}
```

- **First run ever**: the bridge does not scan the repo's comment history for
  old `/claude` text. It records the current highest comment id and current
  time as a baseline and only reacts to comments posted *after* it starts.
  This avoids accidentally firing on something written before the bridge
  existed.
- Every poll after that fetches comments via
  `GET /repos/{owner}/{repo}/issues/comments?since=<lastPollIso>&sort=created&direction=asc`,
  but the real de-duplication guard is the numeric **comment id**, not the
  timestamp: only comments with `id > lastSeenCommentId` are considered.
  Comment ids are unique and only ever increase, so a comment is never
  processed twice — even though GitHub's `since` filter matches on
  `updated_at` and can return an old, already-handled comment again if it
  gets edited later. (Practical effect: editing an old comment does not
  retrigger it — only genuinely new comments do.)
- The poll-start timestamp is snapshotted *before* the network call and only
  saved *after* the whole cycle's triggers are handled, so a comment created
  while a previous cycle is still processing a long `claude` run is never
  missed on the next cycle.
- The bridge fetches its own identity once via `GET /user` and never treats
  a comment authored by that same login as a trigger — so it can't
  react to its own "Working on it..." / summary comments.

## Setup

```bash
cd tools/github-comment-bridge
npm install   # no-op today; there are no dependencies, this just confirms package.json is valid
```

### Token

Export a GitHub personal access token with at least `repo` scope in the
terminal you'll run this in:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- The token is read **only** from the `GITHUB_TOKEN` environment variable at
  runtime. It is never hardcoded anywhere in this tool, never written to
  `.state/`, and never logged.
- Because this runs as a long-lived, unattended process, **use a token
  dedicated to this service** rather than reusing a short-lived token you
  already had open for something else — that way you can revoke it
  independently later without breaking anything else.

### Run it

In its own terminal, from `tools/github-comment-bridge/`:

```bash
npm start
```

It will keep running, polling on an interval, until you stop it
(`Ctrl+C` / `SIGTERM`). It must be started in its own terminal/process — it
is intentionally independent of any particular Claude Code session, and is
meant to outlive the session that launched it.

### Configuration (all optional, via environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `GITHUB_TOKEN` | *(required)* | GitHub token, `repo` scope |
| `GITHUB_OWNER` | `thenewurbankid-web` | repo owner |
| `GITHUB_REPO` | `construct` | repo name |
| `BRIDGE_ALLOWED_LOGINS` | *(defaults to `GITHUB_OWNER` alone)* | comma-separated GitHub logins allowed to trigger a run. **Security-critical**: this repo is public, so anyone can comment on it — only logins in this list can ever cause a real `claude` run. The bridge fails closed (refuses to poll) if this resolves to an empty list. Only widen it to add specific trusted collaborators; never point it at "everyone." |
| `BRIDGE_REPO_DIR` | `/Users/shashank/Repositories/construct-final` | working directory `claude` is invoked in |
| `BRIDGE_POLL_INTERVAL_MS` | `45000` (45s) | time between poll cycles |
| `BRIDGE_CLAUDE_BIN` | `claude` | the CLI binary to invoke |
| `BRIDGE_RUN_TIMEOUT_MS` | `1200000` (20 min) | kills a `claude` run that hangs longer than this |
| `BRIDGE_MAX_BUDGET_USD` | `3` | passed as `claude`'s `--max-budget-usd`; set to `0` or `""` to disable the cap |
| `BRIDGE_STATE_DIR` | `<this tool's dir>/.state` | where `state.json` / `sessions.json` live |

## What was actually verified vs. assumed

Verified directly, by hand, in this environment (not guessed from docs):

- `claude --help` was read in full to pick real, current flags for this
  installed version (`2.1.270`) rather than assuming older/different flag
  names.
- `claude -p "<prompt>" --output-format json --permission-mode acceptEdits`
  was run for real in a scratch directory. It returned a single JSON object
  including a `session_id`, correctly read a file it was asked to read, and
  reported `is_error: false`.
- A second run with `--resume <that session_id>` was run for real and
  correctly recalled the contents of the file from the first run, without
  re-reading it — confirming `--resume` really does continue the same
  `claude` conversation across separate process invocations, and that the
  returned `session_id` stays stable across resumes.
- A further real run under `--permission-mode acceptEdits` (no `--resume`)
  was asked to run a shell command (`ls`) *and* write a new file. It did
  both, with `"permission_denials": []` in the JSON result and the file
  actually present on disk afterwards — confirming `acceptEdits` (a scoped
  mode) is sufficient for real headless tool use, so the broader
  `--dangerously-skip-permissions` bypass was not needed.
- The GitHub side: `GITHUB_TOKEN` present in this environment turned out to
  be **invalid** for the GitHub REST API (`GET /user` and
  `GET /repos/thenewurbankid-web/construct` both returned
  `401 Bad credentials`), so posting real comments or calling `/user`
  could not be exercised end-to-end with real write/auth credentials from
  this environment.
- What *was* verified for real: the repo is public, so the read-only
  endpoints this tool depends on (`GET /repos/{owner}/{repo}/issues/comments`
  and `GET /repos/{owner}/{repo}/issues/{n}`) were called **anonymously
  against the live `thenewurbankid-web/construct` repo** and returned real
  data. A dry-run script drove the actual `pollOnce()` function from
  `src/poller.mjs` against those real reads, with only `getAuthenticatedUser`
  and `postIssueComment` mocked (no valid token to call them for real, and
  posting a fake comment to the real repo would have been a bad idea
  regardless) and `claude` itself mocked (to avoid spending real cost in a
  test run). That exercised, against real repo data: baseline
  establishment, a synthetic first `/claude` trigger dispatching with no
  prior session, a synthetic second trigger on the same issue correctly
  passing the previously-returned session id to simulate `--resume`, and the
  id-based de-duplication cursor advancing correctly across cycles.
- Not verified end-to-end with real credentials: an actual `POST` of a real
  comment to a real issue, and `GET /user` against a genuinely valid token.
  Both are thin, well-documented REST calls (`src/github.mjs`); the
  uncertainty is only about *this environment's* token, not about whether
  the code is correct. Whoever runs this for real should first confirm
  their own `GITHUB_TOKEN` works with a quick
  `curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user`
  before trusting the bridge to post on their behalf.
- Unit tests (`npm test`, Node's built-in test runner, no extra
  dependencies) cover trigger parsing (case sensitivity, first-line-only,
  multi-line instructions, non-matches) and the full `pollOnce()` control
  flow against in-memory fakes: baseline-on-first-run, dispatch-on-trigger,
  session resume on a second trigger for the same issue, self-comment
  filtering, and id-based de-duplication of an edited/reappearing old
  comment. All 18 tests pass (`node --test`).

## Files

```
tools/github-comment-bridge/
  index.mjs              entry point: wiring + poll loop + shutdown handling
  src/config.mjs         env var -> config, GITHUB_TOKEN required here
  src/github.mjs         GitHub REST client, built on @octokit/rest
  src/trigger.mjs        the "/claude ..." first-line trigger parser
  src/jsonStore.mjs       tiny atomic JSON file read/write helper
  src/claudeRunner.mjs    prompt building + spawning the real `claude` CLI
  src/poller.mjs          the pollOnce() orchestration: cursor, dedup, dispatch
  test/                  node:test unit tests (no network, no `claude` calls)
  .state/                created at runtime: state.json, sessions.json (gitignored)
```
