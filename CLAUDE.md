# Working on construct-final

This file is instructions for whichever AI agent (Claude Code or otherwise)
works on this repo — the Construct tool itself, not a project that uses it.
(`AGENTS.md` and `architecture.yml` at this same root are leftover output
from once running `construct init .` on this repo; they describe the
contract Construct enforces on *target* projects, not this one — ignore
them here.)

## Vision — read this before proposing or building anything new

See the "Vision" section at the top of `README.md` in full; it is this
project's actual charter, not marketing copy. Short version: Construct is a
library of small, deterministic, non-LLM "lego blocks" that build/refactor a
web app under user-defined constraints, extended by a UI (`ui/`) so a human
can observe and collaborate — a cockpit, not an autopilot. The same blocks are
exposed to LLMs (via `--llm` flags today, an MCP server with deterministic
flows eventually) so automated work goes through the same repeatable
machinery a human would use, instead of an LLM reinventing the same task with
tokens every time. Mantra: an LLM understands an example better than an
instruction — layers should hand the next layer a concrete example, not an
abstract spec. Before adding a new capability, ask: does this add a
deterministic block, make an existing one more atomic, improve the example a
layer hands the next one, or extend the cockpit UI — or does it quietly make
an LLM do work a block should be doing instead?

## Core philosophy (owner, 2026-09-21) — how we build, between us

- **We are like JHipster** for AI-native React + TypeScript apps: a generator,
  an enforcer and a cockpit over a known stack, not a new framework. Our value
  is repeatable blocks and a human in the loop, not owning commodity code.
- **We embrace open source and never reinvent the wheel.** New work wraps an
  OSS tool by default (permissive licenses only, see the open-core policy);
  we hand-build only the differentiators: architecture rules/validator, plan
  flows and impact, the narrator and test generator, the approval gate,
  workspace containment. Existing hand-rolled code is swapped only where an
  audit shows a stability or maintenance win, never for its own sake.
- **We automate how we work.** Board, milestones, changelog, versioned docs
  and the UI stay in sync by machinery (workflows, scripts, agents), not by
  memory. If a step is repeated by hand twice, it becomes a block or a script.
- **Everything is switchable**: Mechanical | AI per action, model provider,
  mock | real per service, each block on/off per project. Guardrails stay on
  regardless of the switch: containment, per-diff approval, session gate,
  deterministic checks before any AI output lands.
- **No single point of failure, no deadlocks** — in the product (in-memory
  state, one engine slot, one machine are tracked as stability debt) and in how
  we work (work lives on branches and issues, never only in a session; isolated
  worktrees and ports per job; one heavy-job queue that waits for memory; a
  stall watcher). Protocols in this file exist to guarantee that.
- **A no-code IDE experience.** (Owner, 2026-09-21.) The Cockpit feels like an
  IDE (rail, tabs, quick-open, keyboard-first) but is visual first: you select,
  pick, click and press Generate; code is a drill-down ("View source", "Edit as
  file") that is one click away and never the default surface. Screens show
  documentation, structure, diffs and choices before they show a code editor.
  **Every block (a feature, layer, page, component, flow card, step) offers the
  same two exits: "View / edit code" (drill down to the real file) and "Fill
  with AI" (the inline Mechanical | AI control, output as a reviewable diff).**
- **The goal**: make developers' lives easy so people and AI can spend their
  time on innovation instead of repeating the same work.

## Dogfooding: Construct's own UI must be built using Construct

`ui/` is not exempt from the architecture Construct enforces on everyone
else — it should itself be organized as a real Construct feature (domain/
service/workflow/hook/component/page/controller) and pass `construct
validate`, not just be "a React app that happens to live in this repo."
Dogfooding is how the framework actually gets proven, not an afterthought.

This requires Construct itself to support **React + TypeScript as a
first-class target more broadly, not only Next.js App Router specifically**
— today's assumptions (a `page.tsx` entry file, `app/` routing, `route-
resolver.mjs`'s Next.js-shaped URL resolution) don't fit `ui/client`'s Vite
SPA or `ui/server`'s plain Express backend. Generalizing this (a `framework`
option in `architecture.yml` beyond `nextjs`, an abstracted route/controller
entry point that isn't hardcoded to Next.js conventions) is real, foundational
work — track it as its own epic with atomic sub-issues, and don't force a
premature, invasive Next.js rewrite of already-working, tested UI code just
to satisfy this literally before that support exists. Once it does, migrate
`ui/` onto Construct as a second, separate tracked epic.

## GitHub issue discipline (standing instruction)

Repo: `thenewurbankid-web/construct`. This project tracks all real work as
GitHub issues, kept in sync with what's actually true — not a point-in-time
snapshot that rots. See #35 for the audit that established this.

1. **Every unit of work gets an issue before or as you start it** — a new
   capability, a bugfix, a non-trivial refactor. Before filing, search
   existing issues for a match (`gh issue list --search "<keywords>"
   --state all`, or the issues API if `gh` isn't available) — comment on
   or reopen an existing issue instead of creating a duplicate if you find
   one. If none exists, file it. If you discover mid-task that you're
   touching an unfiled unit of work, file it before moving on to the next
   distinct unit, not just at session end. Retroactive filing (documenting
   work already merged, as a changelog entry rather than a request) is
   fine when picking up mid-session work that predates this instruction —
   see #26/#27/#28-#34 for the pattern: what shipped, which files/tests
   back it, closed immediately with that evidence in the body or a
   follow-up comment. Trivial changes with no independent behavior (typo
   fixes, comment-only edits, formatting) don't need their own issue —
   fold them into whichever issue/commit they're actually part of.
2. **Comment only when it carries something.** (Owner, 2026-09-21: "no
   frequent comments ... only if anything to notify the user or notes for
   dev".) There is no mandatory "starting" comment and no progress chatter.
   Write a comment when (a) the owner needs to know or decide something
   (a blocker, a scope change, a security finding), or (b) a developer will
   need a note: the **closing comment** with the rule-12 content (how to run
   it, the API, exceptions, next steps) counts, and so does a gotcha that
   other work depends on. Expect a handful of comments per issue, not dozens.
   This applies to delegated work too: tell every subagent this rule
   explicitly, and post the closing note yourself if it does not.
3. **Issue state must reflect current reality.** Close an issue the moment
   its work is verified done, and don't close something that isn't
   actually done yet. "Verified done" means at minimum: `npm test` passes
   in full (not just the tests you added for this change), plus whatever
   manual verification the task's own bar calls for. Don't leave finished
   work sitting open. If new work reopens or supersedes closed work, say
   so in a comment on the old issue and link the new one, rather than
   silently duplicating.
4. **Granularity matches the existing convention**: a parent "epic" issue
   for a multi-part feature (e.g. #28 for the web UI), with one atomic
   sub-issue per independently-shippable module (e.g. #29-#34) — each
   sub-issue closable on its own, each referencing the parent. Follow the
   existing title conventions (`[Module N] ...`, `Epic X.Y — ...`) when
   they fit; a flat single issue is fine for genuinely small, one-piece
   work.
5. **Keep the project board (Kanban) arranged to match reality** — issue
   state (open/closed) plus its column should always represent what's
   actually true, not what was true when the card was created. If you
   can't reach the board via the API (e.g. a token without Projects
   scope), say so explicitly rather than silently skipping it, and ask for
   a token with Projects (v2) read/write permission, or ask the human to
   move cards to match the issue states you just set.
6. **Never write a GitHub token to a file in this repo or elsewhere on
   disk.** Use it only inline in the shell command that needs it (env var
   or direct substitution), for that command only. If a token has ever
   been pasted in plaintext chat, treat it as compromised — it's fine to
   keep using it for the rest of that session if the human explicitly
   says to, but tell them to rotate it once the work is done.
7. **One external write (issue create/comment/close/PATCH) per action** —
   don't chain multiple GitHub API writes in a single shell command or
   script; do them one at a time. Bulk write scripts have been observed
   to get blocked by this environment's safety classifier; single, plain
   `curl` invocations go through reliably.
8. **Commit and push at every milestone within a subtask, not just at the
   end of a whole feature.** Don't let a long session accumulate a huge
   pile of uncommitted work — when an atomic, independently-meaningful
   chunk lands (a sub-issue's work, a fix, a verified passing test suite),
   commit it and push, then keep going. Group commits by the same
   atomic-unit boundaries this file already asks for in issue granularity
   (rule 4) — one commit per independently-shippable piece, not one giant
   commit at the very end. This is about durability and reviewability, not
   just tidiness: uncommitted work is invisible to anyone but the current
   session and is lost if that session ends badly.
9. **Never sit idle while a session is open and backlog work exists.**
   Once whatever's actively in flight finishes (an agent completes, a
   ticket closes), immediately pick up the next queued/Backlog item
   rather than waiting for the human to explicitly say "go" each time.
   "Queue it for when there's capacity" means capacity being free is
   itself the go-ahead — it does not mean wait for a second, separate
   instruction. The only things worth actually pausing for are genuine
   human decisions this file can't resolve on its own (a security/safety
   tradeoff, an ambiguous requirement, credentials only the human has) —
   not idling by default "just in case."
10. **Default to parallel, independent work streams — don't serialize out
    of caution.** When multiple queued units of work exist, run them at
    the same time rather than one-at-a-time-to-be-safe, even if they touch
    overlapping files.
    - **Prefer real isolation over a shared-tree mitigation when
      available.** If the agent-dispatch tool supports it (e.g. the Agent
      tool's `isolation: "worktree"`), launch parallel agents that touch
      overlapping files in their own git worktree/branch instead of the
      shared working directory — this removes the collision risk at the
      filesystem level rather than just catching it quickly. Merge each
      worktree branch back explicitly (review the diff, then merge/rebase
      onto `main`) once its work is verified done.
    - When worktree isolation isn't used (e.g. an agent already mid-task
      in the shared tree before this was decided), fall back to rule 8's
      frequent small commits/pushes and rule 2's frequent comments as the
      mitigation: small, fast checkpoints make a conflict visible and
      revertible almost immediately instead of a huge unreviewable pile
      discovered at the end. Tell each such agent to `git pull --rebase`
      before every push, and to stop and report rather than force-resolve
      if a real conflict shows up — that's a moment for a human/you
      decision, not a silent auto-merge.
    - **Respect the machine (15 GB, no swap; OOM kills end sessions).** At
      most **two** agents run heavy work at once; wrap every heavy command
      (`npm test`, Playwright, `next dev`, `npm ci`) in `tools/dev/heavy.sh`,
      which serializes them machine-wide, waits for free RAM and prunes stale
      `/tmp/construct-*` test dirs. Use `--workers=1`, one dev server, start
      Ollama only for tests that need it, and never leave background servers
      running. `/tmp` is RAM-backed: clean up what you create.
11. **Every UI feature gets a real Playwright test, run for real.**
    This applies to `ui/` work (anything with a rendered screen), not to
    `src/`/CLI-only work (covered by `npm test`). Before closing any UI
    issue a Playwright test exists under `ui/e2e/` covering the feature's
    actual user-visible behavior (not just an API check), and it was actually
    run. **Screenshots are for the documentation website only**
    (owner, 2026-09-21: "screenshot only in the website"): do not attach
    screenshots to issues or comments and never put images in chat. Website
    screenshots come from real Playwright runs, are curated by the
    `demo-curator` agent, and live under `site/` (see the demos module).
    Specs may still capture images locally for the docs; they are not
    committed to `ui-screenshots` or embedded in tickets.
12. **Every ticket's closing comment (or body, for a changelog-style
    retroactive filing) documents how to actually use what it shipped —
    not just that it shipped.** Specifically, before closing:
    - **Setup/run/install**: the exact commands to install, run, and use
      whatever the ticket delivered (e.g. `cd ui/client && npm install &&
      npm run storybook`) — someone should be able to follow the issue
      alone, with no other context, and get it running.
    - **The API it exposes**: new/changed CLI commands, REST endpoints,
      exported functions, or component props — whatever another piece of
      work (human or agent) would need to call or build on top of this.
    - **Exceptions**: known edge cases it doesn't handle, deliberate scope
      cuts, things that look like bugs but are documented limitations —
      said plainly, not left for someone to discover the hard way.
    - **Future considerations/suggestions**: follow-up ideas, things worth
      revisiting, or a natural next step — even a one-liner. If there
      genuinely isn't one, say "none" rather than omitting the section.
    This applies to every ticket, not just UI ones — a `src/`-only CLI
    change still needs its usage/API/exceptions/next-steps stated, same
    as a UI one needs its screenshot.

## Notifications (standing instruction)

**Notify the owner when a request is finished, or when something needs their
attention — in every session, without being asked.**

- **When to notify**: a request the owner made is complete; a decision only
  they can make is blocking progress; a security finding; an agent finished
  something that needs their call. Anything that means *they would want to
  know now*.
- **When NOT to notify**: routine progress, an agent completing work you can
  verify and merge yourself, or anything that can wait until they next read
  the Notice Board (#224). A notification they did not need is annoying in a
  way that accumulates.
- **Look for a channel, and fail silently if there is none.** Use the
  `PushNotification` tool where it exists. If no notification channel is
  available, say nothing about it and carry on — never turn a missing channel
  into an error, a retry loop, or a message to the owner about the channel.

**A success result is not proof of delivery.** `PushNotification` returns
"Mobile push requested" whether or not the session has a Remote Control
binding to deliver over — on 2026-09-19 it reported success repeatedly while
nothing reached the owner's phone, because this session was not started with
`claude --remote-control`. So: send it, do not claim it arrived, and never
ask the owner to go and check. If delivery genuinely matters, `ListAgents`
shows whether this session is Remote-Control-connected.

Notifying does not replace the Notice Board. Owner-attention items still go
on #224 (see the memory note) — the notification is a nudge toward it, not a
substitute for the written record.

## Demos module (Module 8) — on-demand feature documentation (standing instruction)

See #125 for the epic. A recurring workflow, not a one-time backlog sweep:
when asked to create a demo for a feature, file a **parent ticket** as
`[Demo] <Feature name>` referencing #125, then **one subtask sub-issue per
distinct capability or logical section** of that feature (rule 4's usual
parent-epic + atomic-sub-issue pattern) — never one flat mega-ticket trying
to cover everything. Use judgment on the exact split (per capability or per
section, whichever is cleanest for that feature); the point is real,
individually-closable subtasks, not a rigid taxonomy.

Each subtask (and the parent's own summary) must be written as:

1. **Separate, clearly labeled CLI and UI sections** (and a Core/API
   section where the capability has one) — not interleaved into one
   narrative. A "CLI" section covering that capability's command-line usage
   (real commands + real output), and a "UI" section covering the same
   capability's UI usage (real screenshots), as distinct parts of the same
   subtask. Each section covers the feature's
   full real capability breadth on its own surface (every command/flag/
   layer/option it actually has, verified against current code — not a
   cherry-picked minimal example, and not copied from a possibly-drifted
   old issue description).
2. **Written for users and stakeholders, not engineers.** Plain language
   about what the feature does and how to use it; real commands/output/
   screenshots as evidence. Skip implementation internals (parsing
   details, internal function/module names, rule-engine mechanics) unless
   a stakeholder would actually care — product-demo tone, not
   engineering-design-doc tone.
3. **Real evidence only.** Terminal output from an actual run, never
   fabricated. Screenshots from an actual Playwright run
   (`ui/e2e/tests/demos/`, a dedicated subdirectory, screenshots committed
   to `ui-screenshots` under `ui/e2e/screenshots/demos/`, embedded inline
   — same mechanism as rule 11) — but kept **frugal**: only at genuinely
   meaningful state changes (a result appearing, a form succeeding), not
   one per click/keystroke. A CLI-only capability with no UI surface uses
   a real terminal transcript instead of screenshots.

4. **Guide shape and benefit rule.** A demo topic is a "guide": a parent
   landing-page ticket (who it's for, the problem, one hero screenshot, a
   contents table, a 3-line "why this matters") with one real GitHub
   sub-issue per capability, linked via the sub-issues API. A sub-issue's
   body may keep its internal "As a ... I want ... so that ..." story, but
   **user stories are never rendered on the documentation site** (owner
   decision, 2026-09-20, #290). Every sub-issue carries a **Benefit** block
   (who benefits, what problem it removes, measurable evidence) and a
   "Verified on <commit>" line; a demo without an evidenced benefit is not
   done. Stale, superseded or duplicate demos are consolidated (closed as
   "superseded by #N", never deleted). The full rules live in
   `docs/DEMOS.md`, the single source of truth.
5. **The documentation site is authored, not generated from tickets.**
   `site/content/user/examples/` holds the examples: each opens with the
   **problem**, then the exact command or screen, then the exact result
   (real output, real screenshots), and ends with a "Checked against
   commit" line. CLI, Cockpit and Core examples are separate pages, never
   interleaved (rule 1 applies to the whole site, with Core = the exported
   functions, JSON in and out). The pitch names the problem first: an LLM
   redoing the same task with tokens each time versus repeatable
   deterministic blocks, a cockpit rather than an autopilot. Keep the
   number of pages small and current; prune rather than accumulate.

**Demo/doc upkeep is delegated to the `demo-curator` agent**
(`.claude/agents/demo-curator.md`): run it after each work wave that changes
user-visible behaviour, so demos, the Help Tutorials and `docs/` never drift.

Only create demo tickets when asked — don't proactively file one per
feature. Standard issue discipline (rules 1-2, 4, 12 above) still applies.

## Media module (Module 10) — user-guide videos (standing instruction)

Short, simple, real screen-recorded guides live in `docs/MEDIA.md` and are made by the `media` agent
(`.claude/agents/media.md`): Playwright `recordVideo` runs of the real Cockpit/CLI, on-screen captions, 45-90 s,
published on the documentation website only (like screenshots, never on issues). Invoke it to plan or record an
episode and to re-record after visible UI changes. Standard issue discipline still applies.

## Project board (standing instruction)

Work is tracked on the user-owned Projects v2 board (`docs/PROJECT_BOARD.md` is the reference). When you
file an issue, set **Module**, **Sub-module** and **Kind** on its board card (Area is derived), set **Priority**
on anything open that is not Standing, and link it to its parent epic with GitHub sub-issues plus a
"Part of #N" line. Pull requests do not go on the board. Board maintenance is delegated to the
`project-manager` agent (`.claude/agents/project-manager.md`): run it at the end of each work wave and
whenever the board looks off; it also checks Module/Sub-module/Area consistency and watches the open-core
boundary (Cockpit UI, MCP, predefined envelopes are proprietary; core packages are open). Deterministic
hygiene (closed -> Done, reopened -> In progress, add missing issues, archive Done > 14 days, Area
consistency) is automated by `.github/workflows/project-board-hygiene.yml` (needs the `PROJECT_TOKEN` secret).

## Design module (Module 9) — product and UX design (standing instruction)

The Cockpit is designed before it is built. Charter, principles, tokens, the
3-pane cockpit layout and the concept mocks live in `docs/design/`
(`docs/design/README.md` is the entry point). Design is delegated to the
`designer` agent (`.claude/agents/designer.md`): invoke it BEFORE building any
new Cockpit screen or a visible change to an existing one, for design reviews
and accessibility audits, and when tokens change. The designer produces concept
mocks and specs; it never edits `ui/client` product code.

- **Ticket shape**: a `[Design] <initiative>` parent ticket (mocks embedded,
  rationale, open questions) with one sub-issue per screen or shippable slice
  (rule 4's parent-epic + atomic-sub-issue pattern, linked as real GitHub
  sub-issues). Board Module: **Design**.
- **Implementation tickets link back**: start the body with `Design: #N (mock:
  <file>)`. UI implementation still needs the rule-11 Playwright test and
  screenshot, and must keep the existing e2e specs named in the design ticket
  green.
- **Mocks are labelled** "Concept - not implemented" until the screen ships,
  live in `docs/design/mocks/` (HTML+CSS, PNGs in `png/`), and use only the
  tokens in `docs/design/tokens.md`.
- **Open-core**: the Cockpit UI is proprietary-future; design work stays in
  `docs/design/` and no open-core package depends on it.
- Dev ideology applies to design: reusable, modular, testable, replaceable;
  panes/tabs are slots behind small interfaces.
