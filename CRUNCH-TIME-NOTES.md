# Crunch Time Notes

Claude's own working notes and status log for this branch — the mirror
image of `CRUNCH-TIME.md` (that one is instructions in, this one is
updates/notes out). Read `CRUNCH-TIME.md` first for current direction;
write here to keep the owner current and to leave notes for continuing
this work later, in this session or another one.

Newest entry on top.

---

## 2026-09-30 22:58 UTC

**Set up tonight:** `crunch_time` branch (off `main`, pushed), the Crunch
Time dashboard artifact (live, patch-release view, `db`-backed), and this
notes file plus its instructions companion.

**Findings worth remembering:**
- Construct's own `construct validate` never runs `dependency-cruiser` —
  that file at the repo root is a decorative scaffold template shipped to
  *target* projects, not something Construct enforces on itself. The real
  enforcer is custom: `packages/core/architecture-enforcer.mjs`, AST-based,
  reading `packages/core/config.mjs`'s `DEFAULT_LAYERS` as the single
  source of truth. `dependency-cruiser` and a future `sheriff` target are
  both just optional **export formats** (`construct export ci --target
  ...`) offered to target-project users for their own CI — adding Sheriff
  doesn't touch Construct's internal mechanism either way.
- Sheriff confirmed real: `@softarc/sheriff-core` (core) +
  `@softarc/eslint-plugin-sheriff` (ESLint integration), config via
  `sheriff.config.ts`, module boundaries via barrel files (`index.ts`) or
  explicit tags, zero runtime deps, TypeScript-only peer dep. Exact config
  schema not yet confirmed (intro doc page didn't carry it) — need
  `/docs/configuration` before writing the renderer.
- Construct already has a real barrel-file convention Sheriff's module
  detection could key off directly: `SLICE-002` enforces feature
  `index.ts` as the only public-API surface between features
  (`packages/core/soc-enforcer.mjs`).

**Two architecture decisions still open, logged on Notice Board #224, not
mine to resolve alone:**
- #374 — PR #786 vs. an already-shipped duplicate Git-screen-shell
  implementation upstream.
- #717 — the `defineViewModel` typed-contracts proposal vs. the
  already-shipped `LIN-146..#173` runtime ViewModel layer. Left uncommitted
  in worktree `agent-a06ac3f63525db525`, not rescued, pending this call.

**Next:** pull Sheriff's real config schema, then build the
`renderSheriffConfig()` export target per `CRUNCH-TIME.md`'s current
instructions.
