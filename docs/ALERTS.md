# Alerts (#655)

When a build, a docs deploy, a test run or an agent run fails, the owner and the agent hear about it without looking.
Everything is GitHub-native and deterministic: no model, no third-party service, no secret in any file.
The block is `packages/tools/dev/alert.mjs`; its tests are `packages/tools/dev/test/alert.test.mjs`.

## What an alert is

A GitHub issue of `thenewurbankid-web/construct` with the labels `alert` and `off-board` (never on the board, see
`docs/PROJECT_BOARD.md`), titled `[alert] <key>: <title>` and assigned to `thenewurbankid-web`, so GitHub notifies the owner
by email and in the mobile app. The **key** is the identity: a repeat failure with the same key adds a comment (new run URL and
time) to the open alert instead of opening a second issue, and `resolve` comments and closes it. The next failure after that
opens a new alert.

The body holds a small set of fields: severity, lane, check, commit range, run URL, time, and the last output truncated to 3000
characters. Every field passes a redactor that strips `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`, `sk-` and `AKIA` shapes,
bearer tokens, `Authorization:` header values and `NAME_TOKEN=value` assignments, before and after the cut.

Severity: `info` (not assigned, so nobody is notified; for an FYI), `warn` (default) and `critical` (the same notification,
flagged in the body). Both `warn` and `critical` are assigned to the owner.

## Which alerts exist

| Key | Raised by | Meaning | Resolved by |
| --- | --- | --- | --- |
| `build-<branch>-<lane>` (`build-work-2026-09-23-cockpit`) | `build-on-ready.yml`, Alert step | that lane was held by a failing light check (build-on-ready exit status 3); the other lanes were still tagged | a later run that tags the lane, or any green run |
| `build-<branch>` | the same step | the run failed with no held lane (checkout, plan or `npm ci` failed) or a tag could not be pushed | the next green run |
| `docs-<branch>` (`docs-work-2026-09-23`) | `pages.yml`, `alert` job, work branch only | the docs build or deploy failed | the next green docs run |
| `docs-main-schedule` | `alert.mjs watch` | the SCHEDULED docs build of `main` failed | see below |

The Alert step of `build-on-ready.yml` runs `if: always()` after the check, tag and push step (which is unchanged) and reads
`job.status` and the saved output of the build. It never changes the result of the run (`continue-on-error`), and a cancelled run
does nothing. The `alert` job of `pages.yml` runs only for `refs/heads/work/2026-09-23`; a pull request, a push to `main` or a schedule
run is untouched, and only that job has `issues: write`.

**Known blind spot.** The scheduled docs build runs from the frozen `main`, whose workflow cannot be edited, and it is expected
to fail until `main` is unfrozen or its `schedule` is removed. `watch` (below) raises `docs-main-schedule` for it from outside,
with that note, at most once a day (a repeat on a later day comments on the open alert). Silence it as described below.

## The agent: `status` and `watch`

```bash
node packages/tools/dev/alert.mjs status [--json]                    # everything currently wrong
node packages/tools/dev/alert.mjs watch  [--json] [--state-file <p>] # only what is new since the last call
```

`status` merges three sources: open alert issues; workflow runs that failed in the last 24 hours on `work/2026-09-23`, `studio`
and `main` (a run followed by a green run of the same workflow is marked recovered); and, only when the local Paperclip answers on
`http://127.0.0.1:3100`, the agents of the company "Line" whose status is `error` or that were paused by a budget hard stop
(read-only, agents you paused yourself are ignored; `--paperclip off` skips it, `--paperclip <url>` points elsewhere, loopback
only). A source that cannot be read is named, the others are still reported.

`watch` prints the same items once. Its state (the ids already reported, at most 500, plus the day of the last
`docs-main-schedule` alert) is `~/.cache/construct/alerts.json` (`$XDG_CACHE_HOME/construct/alerts.json`), written atomically.
Nothing new: no output and exit 0, so a cron job or the OG heartbeat can call it every time for the cost of three `gh` reads.
With `--json` it prints `{"new": [...]}`. Delete the state file to see everything again.

## Raise and resolve by hand

```bash
node packages/tools/dev/alert.mjs raise --key deploy-hosted --title "hosted Cockpit is down" --severity critical \
  --body "Caddy answers 502" --lane cockpit --run-url https://... [--tail-file out.txt]
node packages/tools/dev/alert.mjs resolve --key deploy-hosted --note "restarted"
```

Locally the runner is `gh` (signed in with `gh auth login`); in Actions `GH_TOKEN` is `${{ github.token }}`. The first `raise`
creates the two labels if they are missing, one command each. Exit status: 0 done, 1 an error, 2 usage.

## Silence a key

Close the alert issue by hand: it stops commenting, and the next failure opens a fresh one. To stop a class for good, remove the
cause (unfreeze `main`, delete the `schedule:` trigger of `pages.yml` there) or, for a noisy source, resolve it with a note.
`info` severity raises without notifying. To mute your own notifications for a key, unsubscribe from its issue on GitHub.

## Not built (MVP)

A phone push through a private channel (needs a secret the owner creates, for example an ntfy topic or a Telegram bot token,
stored as a repository secret); chat integrations; any email code (GitHub's assignment notification is the email); a dashboard;
alerts from a local test run that is not in CI; a Paperclip agent run failing inside Paperclip's own run history (only the agent's
status is read). Two concurrent `raise` calls for the same new key can open two issues (the CI concurrency groups prevent it there).
