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
for d in . ui/server ui/client ui/e2e packages/tools/github-comment-bridge; do
  [ -d "$M/$d/node_modules" ] && ln -sfn "$M/$d/node_modules" "$d/node_modules"
done
```
If the checkout silently didn't run (you're still on the worktree's default branch, based on frozen
`main`), rename the branch and rebase onto `origin/work/2026-09-23` before continuing — don't build on
frozen `main`.

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
FINISH: commit "[#N] <summary>", `git pull --rebase origin work/2026-09-23`,
  `git push origin HEAD:work/2026-09-23`; stop and report on a real conflict.
  Do not close the issue.
REPORT (short, findings only): commit SHA, test counts,
  `git ls-remote origin work/2026-09-23` output, surprises as path:line.
```

Agents are fresh sessions: they know only the brief, CLAUDE.md, the issue and
the repo docs. Anything that matters (branch, ports, verification bar, what not
to touch) goes in the brief or in a doc, never in chat history.

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
