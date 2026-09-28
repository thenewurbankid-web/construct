# Delivery plan

#635. What each team is expected to ship, on what cadence, who owns it, what
gates it, and how it rolls back. Evidence of what actually shipped is read
from git, never asked for: `packages/tools/dev/delivery-report.mjs` (raw
per-day, per-lane commits/tags/releases) and
`packages/tools/dev/ship-plan.mjs` (this plan laid over that report, so
planned, delivered, held and pending are visible side by side). Both are
read-only and deterministic — no model, nothing written.

## Daily: a build tag per lane

Every lane with a `tagPrefix` in `packages/tools/dev/lanes.json` ships daily
(Mon-Fri) as `<lane>/build-YYYY-MM-DD-HHMM`, produced by
`packages/tools/dev/build-on-ready.mjs` once a lane has a capability commit
since its last tag.

| Lane | Tag | Owner | Gate | Rollback |
|---|---|---|---|---|
| construct | `construct/build-DATE` | Construct lane (dev + QA) | `node --test test/*.test.mjs` (lanes.json `construct.check`) | Redeploy from the previous `construct/build-*` tag's commit; the held tag is never pushed. |
| guardrails | `guardrails/build-DATE` | Guardrails lane | architecture-enforcer/AST/typed-contracts suite (`guardrails.check`) | Redeploy from the previous `guardrails/build-*` tag. |
| cockpit | `cockpit/build-DATE` | Cockpit lane | server tests + client unit specs (`cockpit.check`) | Redeploy from the previous `cockpit/build-*` tag; `ui/` has no independent deploy target yet, so this is the commit the next cockpit build starts from. |
| site | `site/build-DATE` | Website lane | site tests + `site/build.mjs` (`site.check`) | Redeploy the previous `site/build-*` tag's static output; the docs site is served from a build artifact, not live git. |
| design | `design/pack-DATE` | **On hold** — never assigned work (standing OG policy). Cadence paused; `ship-plan.mjs` marks every day `held` with that reason instead of treating it as a gap. | `git diff --check` on `docs/design` (`design.check`) — kept live so a resume needs no re-plumbing. | N/A while on hold. |
| adhoc | `adhoc/build-DATE`, on branch `studio` | Ad hoc lane | Studio test suite (`adhoc.check`) | Redeploy from the previous `adhoc/build-*` tag on `studio`. |

A lane whose check fails is `held` (no tag pushed) by `build-on-ready.mjs`
itself — a different, code-level hold than `ship-plan.mjs`'s day-level hold
below, which fires when a lane produced neither a tag nor a commit at all on
a working day.

## Weekly: a Line release

A `vX.Y.Z` tag on `work/2026-09-23`, aimed for every Monday.

- **Owner:** OG.
- **Gate:** full `npm test` 0 fail on the combined tree, eslint clean, every
  lane's latest build tag reachable from the release commit.
- **Rollback:** re-point `stable-*`/deploy at the previous `vX.Y.Z` tag's
  commit; the frozen `main` tag (`stable-2026-09-23`) is never moved.

## Every two weeks: a milestone

A GitHub milestone (`vX.Y.0`) closes every two weeks.

- **Owner:** OG.
- **Gate:** every P0/P1 issue in the milestone closed with verified evidence
  (`docs/PROJECT_BOARD.md` state matches reality — see `CLAUDE.md` §"Issue
  discipline").
- **Rollback:** slip the milestone's due date and move unfinished issues to
  the next one; a milestone is never closed with open P0/P1 work inside it.

Milestones aren't in git, so neither report script verifies this cadence —
it's read from `docs/PROJECT_BOARD.md` and the GitHub milestone directly.

## The Daily Ship Plan artifact

```
node packages/tools/dev/delivery-report.mjs --since D --until D [--json]
node packages/tools/dev/ship-plan.mjs        --since D --until D [--json]
```

`ship-plan.mjs` wraps `delivery-report.mjs`'s report: every day in
`[since, until]` (including a day the report has no entry for at all, i.e.
nothing landed anywhere) gets a status per lane:

- **delivered** — a build tag or a commit landed for that lane that day.
  Nothing is delivered without one or the other.
- **held** — a working day (Mon-Fri) passed with neither, and a reason is
  attached: the design lane's standing on-hold policy, or (for any other
  lane) `no commits or build tag landed for <lane> on <date>`.
- **pending** — a working day still to come; not yet due, so not held.
- **not-a-working-day** — a Saturday or Sunday; lanes aren't planned to ship
  then, so this is never held.
