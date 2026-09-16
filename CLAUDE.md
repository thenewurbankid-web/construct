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
2. **Comment before starting, and on every decision and every outcome —
   strictly, not just for long or multi-session tasks.** This is the rule
   most likely to be skipped under time pressure; don't skip it.
   - **Before starting** any unit of work, post a comment on its issue
     stating what you're about to do and the plan/approach — before
     writing code, not after. A human watching the issue should be able to
     tell you've started and what you intend, without waiting for a
     result.
   - **At every real decision point** during the work (a design choice, a
     tradeoff, an unexpected finding that changes the plan), post a
     comment when it happens, not folded into a later summary.
   - **On every outcome** — pass, fail, blocked, or a bug found — post a
     comment when that outcome occurs, even if the issue isn't closing
     yet (e.g. "3 of 6 done, here's what's left" is its own comment, not
     something to hold until everything is finished).
   - **This applies to delegated work too.** If you hand a unit of work to
     a subagent, YOU (the delegator) are responsible for the before/during/
     outcome comments actually happening on the right issue — either by
     instructing the subagent explicitly to post them itself at each stage
     (not just "report back at the end"), or by posting them yourself as
     soon as you learn the subagent has started/decided/finished something.
     "I'll comment once the agent's final report comes back" is exactly
     the failure mode this rule exists to prevent — it looks, from the
     issue, like nothing happened for the entire duration of the work.
   - It is fine for these to be several small comments rather than one
     large one — the issue thread should let someone reconstruct exactly
     what happened, in order, without reading the code or waiting for a
     final wrap-up.
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
11. **Every UI feature gets a real Playwright test, run for real, with a
    real screenshot attached to its GitHub issue — mandatory, not optional,
    no exceptions.** This applies to `ui/` work specifically (anything
    with a rendered screen), not to `src/`/CLI-only work (that's covered
    by `npm test`, not screenshots). Concretely, before closing any UI
    issue:
    - A Playwright test exists under `ui/e2e/` covering the feature's
      actual user-visible behavior, not just an API-level check.
    - It was actually run (headless is fine) — not just written.
    - At least one real screenshot from that run is attached directly to
      the issue as an inline image (see #37 for the pattern — commit
      PNGs to a dedicated branch, e.g. `ui-screenshots`, and embed via
      `raw.githubusercontent.com` links in the issue comment; never just
      describe what a screenshot would show).
    - If a UI change alters existing screens' appearance (e.g. a new
      theme), old screenshots on old issues go stale — re-run and post
      fresh ones wherever the change is significant enough that "what it
      actually looks like now" is worth re-confirming, not just left to
      go unverified.
    This is retroactive: any already-closed UI issue that shipped without
    this gets caught up, not grandfathered in.
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
