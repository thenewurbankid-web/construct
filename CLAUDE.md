# Working on construct-final

Instructions for any AI agent working on this repo — the Construct tool
itself, not a project that uses it. `AGENTS.md` and `architecture.yml` at
this root are leftover output from once running `construct init .` here;
they describe the contract Construct enforces on *target* projects, not
this one — ignore them here.

## Vision — read before proposing or building anything new

See the "Vision" section at the top of `README.md` in full; it is this
project's charter. Short version: Construct is a library of small,
deterministic, non-LLM "lego blocks" that build/refactor a web app under
user-defined constraints, extended by a UI (`ui/`) so a human can observe
and collaborate — a cockpit, not an autopilot. The same blocks are exposed
to LLMs (`--llm` flags today, an MCP server with deterministic flows later)
so automated work goes through the same repeatable machinery a human would
use, instead of an LLM reinventing the task with tokens every time. Mantra:
an LLM understands an example better than an instruction — hand the next
layer a concrete example, not an abstract spec. Before adding a capability,
ask: does this add a deterministic block, make an existing one more atomic,
improve an example handed downstream, or extend the cockpit UI — or does it
quietly make an LLM do work a block should be doing instead?

## Core philosophy — how we build

- **Like JHipster** for AI-native React + TypeScript apps: a generator,
  enforcer and cockpit over a known stack, not a new framework. Value is
  repeatable blocks and a human in the loop, not owning commodity code.
- **Embrace open source, never reinvent the wheel.** Wrap an OSS tool by
  default (permissive licenses only); hand-build only the differentiators
  (architecture rules/validator, plan/impact, narrator, test generator,
  approval gate, workspace containment). Swap hand-rolled code only where an
  audit shows a real stability/maintenance win.
- **Automate how we work.** Board, milestones, changelog, versioned docs and
  the UI stay in sync by machinery, not memory; a step done by hand twice
  becomes a block or a script.
- **Everything is switchable** (Mechanical | AI per action, model provider,
  mock | real per service, per project); guardrails (containment, per-diff
  approval, session gate, deterministic checks before AI output lands) stay
  on regardless.
- **No single point of failure, no deadlocks** — in the product (in-memory
  state, one engine slot, one machine are tracked as stability debt) and in
  how we work (branches/issues never only a session, isolated worktrees/
  ports per job, one heavy-job queue that waits for memory, a stall
  watcher).
- **A no-code IDE experience.** Visual first: select, pick, click, Generate;
  code is a drill-down ("View source", "Edit as file"), never the default
  surface. Screens show documentation, structure, diffs and choices before
  a code editor. **Every block (feature, layer, page, component, flow card,
  step) offers the same two exits: "View/edit code" and "Fill with AI"**
  (inline Mechanical | AI control, output as a reviewable diff).
- **The goal**: developers' (and AI's) time goes to innovation, not
  repeating the same work.

## Dogfooding: Construct's own UI must be built using Construct

`ui/` should itself be organized as a real Construct feature (domain/
service/workflow/hook/component/page/controller) and pass `construct
validate`, not just be "a React app that lives here" — this is how the
framework gets proven.

This needs Construct to support **React + TypeScript beyond Next.js App
Router** — today's assumptions (`page.tsx` entry, `app/` routing,
`route-resolver.mjs`'s Next.js-shaped URL resolution) don't fit `ui/
client`'s Vite SPA or `ui/server`'s Express backend. Generalizing this (a
`framework` option in `architecture.yml`, an abstracted route/controller
entry point) is its own epic with atomic sub-issues — don't force a
premature Next.js rewrite of working UI code first; migrate `ui/` onto
Construct as a second, separately tracked epic once support exists.

## Dogfood cycle (standing instruction, owner 2026-09-22)

Every real dogfood test — using Construct (CLI or Cockpit) to build something
real, outside this repo — is tracked under the `[Epic] Dogfooding` issue
(#489, `dogfood` label) per its own template. Two rules that apply every
time a dogfood run finds something, not just the first one:

1. **Bugs and improvements a dogfood run surfaces are always high
   priority** — triage them ahead of other non-urgent backlog, don't let
   them sit. A dogfood test exists to find real friction before a real user
   does; treating its findings as routine backlog defeats the point.
2. **Dev ex is user ex — our users are devs.** When deciding how to fix
   something a dogfood run found, weigh it as a user-experience problem,
   not only a correctness bug: would a developer actually using Construct
   feel this friction, and does the fix make Construct feel like it's
   doing the work for them (per the Vision section) or still leaving a gap
   for them to bridge by hand. #495-498 (found analyzing #490) are the
   worked examples of this: each ties a concrete failure back to what a
   developer would actually experience, not just "the check was wrong."

## GitHub issue discipline (standing instruction)

Repo: `thenewurbankid-web/construct`. Issues track all real work and stay in
sync with what's actually true, not a point-in-time snapshot (see #35).

1. **Every unit of work gets an issue** before or as you start it. Search
   first (`gh issue list --search "<keywords>" --state all`); comment/
   reopen a match instead of duplicating. File mid-task discoveries before
   moving to the next distinct unit. Retroactive filing (a changelog-style
   entry with the files/tests that back it) is fine for pre-existing work.
   Trivial changes (typos, comment-only, formatting) fold into whichever
   issue/commit they're part of.
2. **Comment only on one of four things** (owner, 2026-09-22 — tightens this
   further than before): a real **status change** (closing, reopening — one
   line: "Done in <sha>, verified: <suite>"); a **dropped task**, with why
   it was dropped; a **future note for dev** (rule 12's closing content,
   only when a developer genuinely needs it); or something that must be
   **highlighted to other devs** specifically, not just the owner. Nothing
   else — no starting comment, no progress chatter, no comment per action,
   no restating what the issue body/board already shows. Tell every
   subagent this rule; post any closing note yourself.
3. **Issue state must reflect reality.** Close the moment work is verified
   done (`npm test` passing in full, plus the task's own manual bar); never
   leave finished work open, never close unfinished work. New work that
   reopens/supersedes closed work says so in a comment with a link.
4. **Granularity**: a parent "epic" issue for a multi-part feature, one
   atomic sub-issue per independently-shippable module, each closable on
   its own and referencing the parent (`[Module N] ...`, `Epic X.Y — ...`
   where they fit). A flat issue is fine for small, one-piece work.
5. **Keep the project board matching reality** — state plus column always
   true. If unreachable (no Projects scope), say so explicitly and ask for
   a token or for cards to be moved manually.
6. **Never write a GitHub token to disk** — inline it in the one command
   that needs it. A token pasted in plaintext chat is compromised; fine to
   keep using for that session if told to, but tell the owner to rotate it.
7. **One external write (create/comment/close/PATCH) per action** — never
   chain GitHub API writes in one command; bulk scripts get blocked by this
   environment's safety classifier, single `curl`/`gh` calls go through.
8. **Commit and push at every milestone**, not just at the end of a feature
   — one commit per independently-shippable piece (rule 4's boundaries),
   never one giant commit at the end. Uncommitted work is invisible to
   anyone but the current session and is lost if it ends badly.
9. **Never sit idle while backlog work exists.** Pick up the next queued
   item as soon as something in flight finishes — capacity being free is
   itself the go-ahead. Pause only for a genuine human decision (security/
   safety tradeoff, ambiguous requirement, credentials only the human has).
10. **Default to parallel, independent work streams** over serializing out
    of caution, even over overlapping files.
    - **Prefer real isolation**: dispatch with `isolation: "worktree"` over
      the shared tree when supported; merge each branch back explicitly
      once verified.
    - Without worktree isolation, rely on rule 8's frequent commits/pushes
      and rule 2's comments as mitigation; `git pull --rebase` before every
      push; stop and report — never force-resolve — on a real conflict.
    - **Respect the machine** (15 GB, no swap; OOM kills end sessions): at
      most **two** agents run heavy work at once; wrap every heavy command
      (`npm test`, Playwright, `next dev`, `npm ci`) in `packages/tools/dev/heavy.sh`
      (serializes machine-wide, waits for free RAM, prunes stale
      `/tmp/construct-*`). `--workers=1`, one dev server, Ollama only when
      needed, no lingering background servers; clean up `/tmp`.
11. **Every UI feature gets a real Playwright test, run for real** (`ui/`
    work with a rendered screen; `src/`/CLI-only is covered by `npm test`).
    A spec under `ui/e2e/` must exist and have actually run before closing.
    **Screenshots are for the documentation website only** — never in
    issues, comments or chat; curated by `demo-curator`, live under `site/`.
12. **A closing note is written only when it helps the next developer**: a
    new command, API, setup step, known exception or non-obvious next step
    (commands runnable from the issue alone). A fix or refactor with none of
    these closes with the one line from rule 2. `src/`-only work follows the
    same test.

## Token economy (standing instruction)

- **Reporting and tracking are frugal** (owner, 2026-09-21): refresh dashboards (Trinity, board) once per
  work wave or on request, never on a timer; no board or issue write that only restates state that
  machinery already shows; agents report findings once, at the end.

- No progress chatter or narration in agent reports — findings and results
  only; no running commentary on an issue beyond the rule-12 closing note.
- Screenshots only for the documentation website (rule 11); one commit per
  shippable piece, not per file (rule 8).
- Run the full verification suite once at the end of a task; smoke-test
  individual pieces while iterating instead of re-running everything each
  small change.
- Never paste large file contents or full test logs into a report — cite
  `path:line` and counts. Never read a dispatched agent's transcript; read
  its final report and verify with your own commands instead.
- Prefer `packages/tools/dev/status.sh` and `packages/tools/dev/verify.sh` over composing many
  small ad hoc shell calls for the same picture.
- Delegate with a complete brief (scope, files, acceptance bar, report
  format) so the agent needs no follow-up round trip to start.
- Plugins (official marketplace, project scope; local `.claude/settings.json` is git-ignored, so
  install per machine: `claude plugin install <name>@claude-plugins-official --scope project`):
  `session-report` (token/cache/subagent report from local logs; run after each wave, cache breaks
  over 100k tokens are the costly ones), `claude-md-management` (audit this file, keep it lean),
  `typescript-lsp` (go-to-definition and find-references instead of grep-and-read; needs
  `npm i -g typescript-language-server typescript`). Rejected after review: `frontend-design`
  (fights our token-based design system), `project-artifact` (Trinity covers it), `code-simplifier`,
  `context7`/`serena` (external service, heavy).
- Prefer a deterministic Construct block over reasoning by reading files —
  see "How agents should orient" in `docs/DOGFOODING-2026-09.md`.

## Notifications (standing instruction)

Notify the owner (via `PushNotification`, where a channel exists) when a
request is finished or something needs their attention (a blocking
decision, a security finding) — not for routine progress or anything you
can verify and merge yourself. Fail silently if there is no channel — never
an error or a message about the channel.

A success result from `PushNotification` is not proof of delivery (it can
report success with no Remote Control binding to deliver over) — send it,
don't claim it arrived, don't ask the owner to check (`ListAgents` shows
whether this session is Remote-Control-connected). This doesn't replace the
Notice Board (#224), where owner-attention items still go.

## Demos module (Module 8) — on-demand feature documentation

Full rules and the single source of truth: `docs/DEMOS.md` — read it before
creating or curating a demo. Short version: only when asked (never
proactively), file a parent `[Demo Guide] <feature>` referencing #125, then
one real GitHub sub-issue per capability (never a flat mega-ticket), each
with separate CLI/UI/Core sections, real evidence (frugal screenshots or a
terminal transcript), a Benefit block and a "Verified on" line. Delegated to
the `demo-curator` agent (`.claude/agents/demo-curator.md`) — run it after
any wave that changes user-visible behaviour. Standard issue discipline
(rules 1-2, 4, 12) still applies.

## Media module (Module 10) — user-guide videos

Short, real screen-recorded guides (`docs/MEDIA.md`), made by the `media`
agent (`.claude/agents/media.md`): scripted Playwright recordings of the
real Cockpit/CLI, built in parts (each 1-2 min, own script, narration,
subtitles, checkpoint), subtitles as a separate track (never burned over the
UI), published on the documentation website only — never on issues. Invoke it to plan/record an
episode or to re-record after a visible UI change. Standard issue
discipline still applies.

## Project board (standing instruction)

Work is tracked on the user-owned Projects v2 board (`docs/PROJECT_BOARD.md`
is the reference). When filing an issue, set **Module**, **Sub-module** and
**Kind** (Area is derived), set **Priority** on anything open that is not
Standing, and link it to its parent epic (GitHub sub-issues plus a "Part of
#N" line). Pull requests don't go on the board. Maintenance is delegated to
the `project-manager` agent (`.claude/agents/project-manager.md`) — run it
at the end of each work wave and whenever the board looks off; it also
checks Module/Sub-module/Area consistency and the open-core boundary.
Deterministic hygiene (closed→Done, reopened→In progress, missing issues,
archive Done >14 days) is automated by
`.github/workflows/project-board-hygiene.yml` (needs the `PROJECT_TOKEN`
secret).

## Design module (Module 9) — product and UX design

The Cockpit is designed before it is built. Charter, principles, tokens,
the 3-pane cockpit layout, mocks and the ticket-shape/hand-off rules live in
`docs/design/` (`docs/design/README.md` is the entry point). Delegated to
the `designer` agent (`.claude/agents/designer.md`): invoke it BEFORE
building any new Cockpit screen or a visible change to an existing one, for
design/accessibility reviews, and when tokens change; it never edits
`ui/client` product code. Implementation tickets link back with `Design: #N
(mock: <file>)` and still need the rule-11 Playwright test. Open-core: the
Cockpit UI is proprietary-future, design work stays in `docs/design/`, and
no open-core package depends on it.
