# Delegating work to agents

For the orchestrator writing a brief and for the agent that receives one.
CLAUDE.md holds the rules; this page holds the mechanics. When a mechanic
changes (branch, ports, setup), change it here, not in chat.

## Branch state

- `main` is frozen at tag `stable-2026-09-23` (a1dd0bc). Nothing merges to it
  until the owner unfreezes.
- All work lands on `work/2026-09-23`. Every branch starts from
  `origin/work/2026-09-23`, rebases on it before pushing, and pushes to it
  directly (`git push origin HEAD:work/2026-09-23`) once verified.
- Release tags (`v*.*.*`) are cut on the work branch; the docs site builds from
  the work branch and those tags.

## Setup in a fresh worktree

Worktrees are created on frozen `main` and have no `node_modules`:

```bash
git fetch origin && git checkout -B <branch> origin/work/2026-09-23
```
then, as a **separate** command (chaining it into the checkout with `&&` has tripped the sandbox's
worktree-containment guard — the string "git" inside "github-comment-bridge" reads as nested git use):
```bash
M=/home/developer/Desktop/repos/construct
for d in . ui/server ui/client ui/e2e; do
  [ -d "$M/$d/node_modules" ] && ln -sfn "$M/$d/node_modules" "$d/node_modules"
done
```
and the comment-bridge link as a third command (the same guard refuses any command whose text contains
"git" inside its path, so it cannot share the loop; without it `packages/tools/github-comment-bridge/test/github.test.mjs`
fails on a fresh worktree):
```bash
ln -sfn /home/developer/Desktop/repos/construct/packages/tools/github-comment-bridge/node_modules packages/tools/github-comment-bridge/node_modules
```
If the checkout silently didn't run (you're still on the worktree's default branch, based on frozen
`main`), rename the branch and rebase onto `origin/work/2026-09-23` before continuing — don't build on
frozen `main`.

A worktree's `node_modules` symlink points at the main checkout, so `@line/construct-core` (and the other `@line/*` packages) resolve to the MAIN checkout's copy, not the worktree's. If a test fails only in a worktree because it sees old core code, replace the `@line/*` entries with symlinks to the worktree's own `packages/*` (a small overlay directory), do not edit the main checkout.

The links are git-ignored. Never `npm install` in a worktree unless the brief
says so (one package, through `heavy.sh`, lockfile committed).

## Machine limits (15 GB, no swap; an OOM kill ends every session)

- Single test files run directly: `node --test <file>`.
- Anything heavy (`npm test`, Playwright, `next dev`, `npm ci`, `npm install`)
  runs through `packages/tools/dev/heavy.sh`, which serializes machine-wide and
  waits for free RAM. Full suite once, at the end, never per change.
- Playwright: `--workers=1`, one dev server, own port range, kill it after.
- Tests that bind ports pick an unused range first (`grep -rn "PORT_BASE\|listen(" ui/server/src/*.test.mjs`); 47300-47999 are taken by the dev-server tests.
- Clean up `/tmp/construct-*` and any process you started.

## Brief template

One deliverable a fresh session finishes in 10-15 minutes. Larger work is
split into sequenced slices, each verified before the next starts.

```
You are a fresh session on thenewurbankid-web/construct. Read CLAUDE.md first
and follow it; mechanics are in docs/DELEGATION.md.
SETUP: branch <name> per docs/DELEGATION.md.
ISSUE: #N (or: file the sub-issue "<title>" with "Part of #N", link it as a
  GitHub sub-issue via gh api graphql addSubIssue — one command each).
CONTEXT: <files, recent commits, what is already done, what is out of scope>.
DELIVERABLE: <one thing>, with tests that fail before the change.
ACCEPTANCE: targeted tests pass; `packages/tools/dev/heavy.sh npm test` 0 fail;
  eslint clean; Playwright spec under ui/e2e/ run for real if a screen changed.
AI-READY (any block or chain step): summary of fixed size, closed options with stable ids, attribution
  recorded, rules-only fallback, replay-scorable; see docs/BLOCK-CONTRACT.md "AI-ready by design".
FINISH: commit "[#N] <summary>", `git pull --rebase origin work/2026-09-23`,
  `git push origin HEAD:work/2026-09-23`; stop and report on a real conflict.
  Do not close the issue.
REPORT (short, findings only): commit SHA, test counts,
  `git ls-remote origin work/2026-09-23` output, surprises as path:line.
```

Agents are fresh sessions: they know only the brief, CLAUDE.md, the issue and
the repo docs. Anything that matters (branch, ports, verification bar, what not
to touch) goes in the brief or in a doc, never in chat history.

A missing symlink doesn't always fail loudly right away: `packages/docs-site/lib/apiDocs.mjs`
does a literal `fs.existsSync(repoRoot + '/node_modules/typedoc/...')` check rather than Node's
own module resolution, so it only ever finds `typedoc` via the worktree's *own* `node_modules`
symlink, never by walking up to the outer checkout the way a plain `import` does. Most tests pass
fine without the root symlink (resolution walks up into the main checkout); a batch of ~40
unrelated-looking failures (api-manifest/apiDocs tests, every `ui/server/*.test.mjs`, every
typed-contracts tsc test) with no connection to what you changed means the setup step was
skipped, not that you broke something — symlink node_modules for every directory in the setup
list above, then re-run before concluding a regression.

## Verifying a report (orchestrator)

A report is a claim. Before closing or building on it:

1. `git ls-remote origin work/2026-09-23` shows the claimed SHA; `git log
   --oneline <previous-tip>..origin/work/2026-09-23` shows only the expected
   commits.
2. Re-run the affected test files in the main checkout; three times for
   anything with ports, child processes or timers.
3. A lone flaky failure is investigated, not re-run away: it is usually two
   test files sharing a port range or a temp path.
4. Full `heavy.sh npm test` once on the combined tree before the next push.
5. Close the issue yourself. Post a note only when CLAUDE.md rule 4 says so.

Never read an agent's transcript; read its report and verify with your own
commands.

## Monitoring and rescue

- Silence is not progress. Check evidence:
  `git -C .claude/worktrees/agent-<id> log --oneline origin/work/2026-09-23..HEAD`
  and `git -C .claude/worktrees/agent-<id> status --short`.
- `ISSUES="278 254" packages/tools/dev/watch-agents.sh &` exits after about 18
  minutes without movement and wakes the orchestrator.
- Stalled: message the agent to commit and push what it has.
- Dead: commit its uncommitted work as an explicit WIP on its own branch
  (excluding `node_modules` links), push, and record on the issue what exists
  and what was never verified. A fresh agent inherits it critically.
- Prune: `.claude/worktrees/agent-*` directories that are clean and fully
  merged into the work branch are removed with `git worktree remove <dir>` then
  `git worktree prune`. Never remove a dirty or unmerged one.

## Cost

A dispatched agent costs roughly 80k-240k tokens; tests, `gh` calls and edits
are near-free by comparison. Do XS work directly. Never dispatch against a
ticket blocked on an owner decision. Run as many agents in parallel as the
memory allows (check `free -m`; each agent is ~400 MB plus its test
processes), with `heavy.sh` serializing the heavy commands.

## Keeping a session alive (og-watchdog)

`packages/tools/dev/og-watchdog.sh` runs from cron every 3 minutes and does two things.

- **No session:** when no interactive Claude Code session is running in this repo, it starts OG in a detached tmux session named `og` with `--agent og --permission-mode auto --remote-control`, so work resumes and the owner can reach it from claude.ai/code or the phone.
- **Idle session:** when the newest transcript write for the repo (subagent logs included) is older than the threshold, it writes a handoff snapshot to `~/.og-watchdog/handoffs/` (git state, last 12 hours of commits, agent worktrees with unpushed commits, `status.sh`, and the previous session's last message; no model writes it), closes the session and starts a fresh OG whose prompt points at that snapshot. If the idle session is the watchdog's own OG, OG is first asked to write its own handoff note (memory plus push) and is closed once it answers, or after 15 minutes. Thresholds: 30 minutes for the OG session (a long silent command such as a full test run writes no transcript until it ends), 120 for any other session (a VS Code session, say); a process younger than the threshold is never idle. At most 12 recycles per rolling 24 hours.

The resume prompt is `~/.og-watchdog/prompt.txt`; edit it to change what OG does on start.

- `og-watchdog.sh status` shows what it sees, including idle time; `attach` opens the tmux session (Ctrl-b d leaves it running); `recycle` recycles now (`OG_FORCE=1` skips the idle test).
- `pause` before you work in the tree yourself for a long stretch (two sessions collide, and a paused watchdog neither starts nor closes anything); `resume` afterwards.
- A started session that dies within 15 minutes (usage limit, crash) backs the next start off 5, 10, 20, 40, then 60 minutes.
- `install` copies the script to `~/.og-watchdog` and writes the cron entry; rerun it after editing the script. `uninstall` removes the entry. `test/og-watchdog.test.mjs` runs the script against fake sessions and a throwaway repo.

## Tooling

Plugins are installed per machine at project scope
(`claude plugin install <name>@claude-plugins-official --scope project`):
`session-report` (token/cache/subagent report from local logs; run after each
wave, cache breaks over 100k tokens are the costly ones),
`claude-md-management` (audit CLAUDE.md, keep it lean), `typescript-lsp`
(go-to-definition instead of grep-and-read; needs
`npm i -g typescript-language-server typescript`). Rejected after review:
`frontend-design` (fights the token-based design system), `project-artifact`
(Trinity covers it), `code-simplifier`, `context7`/`serena` (external service,
heavy).

`packages/tools/dev/status.sh` gives one-shot status (PRs, agent worktrees,
heavy lock, memory, hosted health); `packages/tools/dev/verify.sh <branch>`
verifies a branch merged with the current checkout in one summary.
