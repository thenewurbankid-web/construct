# Working on Construct

This repo is the Construct tool itself, not a project that uses it.
`AGENTS.md` and `architecture.yml` at the root are leftover output of
`construct init .`; they describe what Construct enforces on *target*
projects. Ignore them here.

## Branch, machine, verification

- `main` is frozen at tag `stable-2026-09-23`. All work lands on
  `work/2026-09-23`: branch from `origin/work/2026-09-23`, `git pull --rebase`
  before every push, never force-resolve a conflict (stop and report).
- Heavy commands (`npm test`, Playwright, `next dev`, `npm ci`) run through
  `packages/tools/dev/heavy.sh` (15 GB, no swap). Single test files run
  directly. Playwright: `--workers=1`, one dev server, no lingering processes.
- Done means: `packages/tools/dev/heavy.sh npm test` 0 fail on the combined
  tree, eslint clean, plus the task's own manual bar. Smoke-test single files
  while iterating; full suite once at the end.
- Delegation mechanics (worktree setup, brief template, verifying reports,
  rescue, cost): `docs/DELEGATION.md`. An agent is a fresh session: it knows
  only its brief, this file, the issue and the repo docs.

## Vision (charter: README.md "Vision")

Construct is a library of small, deterministic, non-LLM blocks that build and
refactor a web app under user-defined constraints, plus a cockpit UI (`ui/`)
where a human observes and collaborates: a cockpit, not an autopilot. The
same blocks are exposed to LLMs (`--llm` today, MCP later) so automated work
runs through repeatable machinery instead of tokens. Mantra: hand the next
layer a concrete example, not an abstract spec. Before adding anything, ask:
does it add a deterministic block, make one more atomic, improve an example
handed downstream, or extend the cockpit, or does it quietly make an LLM do a
block's work?

## How we build

- Like JHipster for AI-native React + TypeScript: generator, enforcer and
  cockpit over a known stack, not a new framework.
- Wrap OSS (permissive licenses only) by default; hand-build only the
  differentiators (rules/validator, plan/impact, narrator, test generator,
  approval gate, workspace containment).
- Automate how we work: anything done by hand twice becomes a block or a
  script; board, changelog, docs and UI stay in sync by machinery.
- Everything is switchable (Mechanical | AI per action, provider, mock |
  real, per project); guardrails (containment, per-diff approval, session
  gate, deterministic checks before AI output lands) never switch off.
- No single point of failure or deadlock, in the product (in-memory state and
  one engine slot are tracked debt) and in how we work (isolated worktrees and
  ports, one heavy-job queue).
- No-code IDE: visual first, code is a drill-down. Every block (feature,
  layer, page, component, flow card, step) offers the same two exits:
  "View/edit code" and "Fill with AI" (output as a reviewable diff).

## Standing constraints

- **Dogfood the UI**: `ui/` must become a real Construct feature that passes
  `construct validate`. That needs support for Vite SPA and Express beyond
  Next.js App Router (a `framework` option, an abstracted route entry), its
  own epic. Do not force a Next.js rewrite of working UI code.
- **Dogfood runs** (epic #489, label `dogfood`): every finding is high
  priority and is judged as developer experience, not only correctness. Does
  the fix make Construct do the work, or leave a gap to bridge by hand?
  (#495-#498 are the worked examples.)
- **Typed contracts** (epic #500, `packages/core/typed-contracts/`): when
  writing or generating a unit for a layer with a factory (`defineDomain`,
  `definePage`, `defineComponent`, `defineExpression`, `defineService`,
  `defineWorkflow`, `defineController`, `defineRoute`, `defineProvider`), use
  it. Phase 1 rules (`HOOK-001`, `PAGE-008/009`, `DOMAIN-002`, `READ-004`,
  filename `Name.layer.ext`) are off by default. Do not delete the old
  denylist rules until phase 2 dogfood evidence lands.
- Prefer a deterministic Construct block over reasoning by reading files
  (`docs/DOGFOODING-2026-09.md`, "How agents should orient").

## Issue discipline (`thenewurbankid-web/construct`)

1. Every unit of work has an issue before or as it starts. Search first
   (`gh issue list --search "<kw>" --state all`); reuse or reopen a match.
   File mid-task discoveries before moving on. Trivial fixes fold into the
   current issue.
2. Tickets are user stories: "As a `<role>`, I want `<capability>`, so that
   `<benefit>`", label `story`, 2-4 acceptance bullets, a milestone. Slices
   and design are sub-issues (GitHub sub-issue link plus a "Part of #N"
   line); design is optional and never a gate. Multi-story features get an
   epic parent. Bugs and chores stay flat. Obsolete work is closed with a
   one-line reason naming what supersedes it.
3. State reflects reality: close the moment work is verified done; never
   close unfinished work; work that reopens or supersedes links back.
4. Comment only when it adds what state and commits do not show: a dropped
   task and why; a note the next developer needs (new command, API, setup
   step, known exception, non-obvious next step, runnable from the issue
   alone); something to highlight to other devs; verification detail worth
   keeping. No start, progress or "done" comments. Closing needs no comment.
5. Board (`docs/PROJECT_BOARD.md`): set Module, Sub-module, Kind, Priority and
   the parent link when filing. PRs are not on the board. If the board is
   unreachable, say so and ask for a token.
6. GitHub writes: one create/comment/close/PATCH per command, never chained
   (bulk scripts get blocked). Never write a token to disk; a token pasted in
   chat is compromised, tell the owner to rotate it.
7. Commit and push every shippable piece; never one giant commit.
   Uncommitted work is invisible and dies with the session.
8. Never idle while backlog exists. Pause only for a genuine human decision
   (security tradeoff, ambiguous requirement, credentials).
9. Parallel, isolated streams by default (`isolation: "worktree"`, merge back
   explicitly once verified). One deliverable per delegation, 10-15 minutes.
10. Every UI feature has a Playwright spec under `ui/e2e/` that actually ran
    before closing; `src/` and CLI work is covered by `npm test`. Screenshots
    exist only for the docs site (`site/`, curated by `demo-curator`), never
    in issues, comments or chat.

## Token economy

- Report once, at the end: findings and results, counts and `path:line`, no
  narration, no pasted logs. Never read a dispatched agent's transcript; read
  its report and verify with your own commands.
- Verify claims: `git ls-remote` for pushes, re-run the affected tests, full
  suite once on the combined tree.
- Dashboards (Trinity, board) refresh once per wave or on request, never on a
  timer; no board or issue write that restates visible state.
- `packages/tools/dev/status.sh` and `verify.sh` over many ad hoc shell calls.
- Plugins and dev tooling: `docs/DELEGATION.md`, "Tooling". Run
  `session-report` after each wave.

## Notifications

`PushNotification` the owner when a request is finished or needs a decision
or a security finding, never for progress. No channel: fail silently. A
success result is not delivery: send it, do not claim it arrived. Owner
attention items also go on the Notice Board, #224.

## Modules with their own playbooks

- Demos (`docs/DEMOS.md`, agent `demo-curator`): only when asked; a
  `[Demo Guide]` parent under #125 with one sub-issue per capability and real
  evidence. Run the agent after any wave that changes user-visible behaviour.
- Media (`docs/MEDIA.md`, agent `media`): scripted Playwright recordings,
  subtitles as a separate track, docs site only.
- Board (`docs/PROJECT_BOARD.md`, agent `project-manager`): run at the end of
  each wave; deterministic hygiene in
  `.github/workflows/project-board-hygiene.yml`.
- Design (`docs/design/README.md`, agent `designer`): opt-in only, never a
  gate. Otherwise reuse patterns from `docs/design/` (for example the
  `.pal-group` disclosure). The designer never edits `ui/client`. Cockpit UI
  is proprietary-future; open-core packages never depend on `docs/design/`.
