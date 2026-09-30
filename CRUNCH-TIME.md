# Crunch Time Log

Running record of work from this point forward, on branch `crunch_time`
(cut from `main`, separate from the standing `work/2026-09-23` branch other
sessions land on). This file is the first reference for what happened and
when — check here before anything else when picking up mid-stream.

Companion: a live dashboard artifact (patch-release view, atomic task
progress/ETA/milestones) mirrors this log visually and updates in real time.

Format per entry: timestamp, what was asked, what shipped, what's still open.

---

## 2026-09-30 22:55 UTC — Crunch Time tracking started

**Asked:** Track ongoing work in a live artifact (patch-release log, atomic
task progress bars, ETA, milestones) **and** a separate durable doc/log —
this file — as the first reference going forward.

**Shipped:**
- `crunch_time` branch created off `origin/main`, pushed, checked out
- Crunch Time dashboard artifact built (design: warm terracotta-on-cream
  timeline, "Fraunces" display / "Source Sales" body / "JetBrains Mono" for
  versions and data — a changelog-style vertical timeline, one release card
  per request, expandable to atomic tasks with progress bar + ETA + a
  milestone log per task). Wired to the `db` runtime capability so updates
  push live to anyone with it open; falls back to a static seed render if
  `db` isn't available to a given viewer.
- This log file created, committed here.

**Open:**
- Publish the artifact (next step)
- Two real architecture decisions still sitting on Notice Board #224,
  unresolved: #374's duplicate Git-screen-shell implementation (PR #786 vs.
  upstream's already-shipped version), and #717 (defineViewModel
  typed-contract proposal) vs. the already-shipped `LIN-146`..`#173`
  ViewModel layer.
- Sheriff research in progress (module-boundary tool, user wants it as
  primary enforcer with dependency-cruiser kept as backup) — confirmed real
  package (`@softarc/sheriff-core` + `@softarc/eslint-plugin-sheriff`,
  zero deps, TS peer dep only) and confirmed Construct's own `validate`
  never actually runs dependency-cruiser today (it's a custom AST enforcer,
  `architecture-enforcer.mjs`, off `config.mjs`'s `DEFAULT_LAYERS`);
  dependency-cruiser and a future Sheriff target are both just optional
  **export formats** (`construct export ci --target ...`) for target
  projects' own CI, not Construct's internal mechanism. Still need Sheriff's
  exact config schema (intro page didn't have it) before writing the
  renderer. Paused to build this tracker first, per "small increments,
  finish one prototype tonight."
