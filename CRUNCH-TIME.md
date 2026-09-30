# Crunch Time

Standing instructions for work on branch `crunch_time` (cut from `main`,
separate from `work/2026-09-23` — construct-og and Trace keep landing on
that one, not this one). Read this file first, before anything else, when
picking up work here.

## Rules for this branch

1. **Every request becomes one patch release.** A version bump
   (`v0.1.0`, `v0.1.1`, ...), logged as one entry in the Crunch Time
   dashboard: https://claude.ai/artifact/9TQ7N6R3JM71zpe54XhG78
2. **Break each release into atomic tasks.** Each task gets a progress bar,
   an ETA, and a milestone log line per real step — pushed live to the
   dashboard via its `db` capability as work happens, not batched at the end.
3. **Small increments.** Finish one prototype/slice before starting the
   next. Don't fan out into unrelated work mid-release.
4. **This file states intent and rules, not history.** What actually
   happened lives in the dashboard (live) and in git log/PRs (durable).
   Update this file when the rules or the current focus change — not as a
   running journal.
5. **Check the dashboard before starting anything new** — it's the live
   status; this file is the standing rule set.

## Current focus

Sheriff adoption: add `@softarc/sheriff-core` + `@softarc/eslint-plugin-sheriff`
as a new `construct export ci --target sheriff` output, made the default
recommendation over the existing `dependency-cruiser` target (which stays
available, demoted to a fallback option — Construct's own `validate` never
actually runs either today; both are export formats for target projects'
CI, not Construct's internal enforcer, which stays the custom
`architecture-enforcer.mjs`). Exact Sheriff config schema still needed
before writing the renderer.
