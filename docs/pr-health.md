# PR health (`construct review`)

`prHealth` answers one question deterministically: **what does the change between two commits mean?**
GitHub shows a pull request as a pile of changed lines. Construct knows which feature and layer each line
lives in, what the layer graph allows, and what the project's own rules say, so the review indicators are
assembled from blocks that already exist. No model, no network, no GitHub login: local branches are
first-class. Epic #285; engine tickets #314 (indicators that need no plan) and #316 (blast radius).

- Code: `packages/engine/prHealth.mjs` (indicators), `packages/engine/gitTrees.mjs` (read-only git).
- Contract: `schemas/pr-health.v1.json`.
- Consumes: `impactFromChangedFiles` (the same function Research mode uses), the `rule:<ID>` impact seed,
  `planTouches()`, the workflow narrator's `enumerateScenarios`.

## CLI

```
construct review <base> <head> [--plan <file>] [--features a,b] [--no-merge-base]
                               [--format json|markdown] [--dir <path>]
construct review --usage
```

`--plan` reads a plan JSON (`{steps:[{touches}]}` or a `planTouches()` result); `--features` is the shorthand.
With neither, the scope indicator is `measured:false` (no plan is normal, never an error). The `research`
verb is unchanged.

## API

```js
import { prHealth } from './packages/engine/prHealth.mjs';
const report = prHealth(root, { base: 'main', head: 'feature/x', expected: plan /* optional */ });
// report.ok === false => { error: { code, message } }; it never throws.
```

## The five indicators

Every indicator has `headline` (the computed sentence), `evidence`, `source` ("where the number comes from"),
`measured`, `status` (`clear | info | attention | not-measured`) and `deterministic: true`. A clean result is a
positive headline, never an empty card.

| id | What it says | Comes from |
|---|---|---|
| `blast-radius` | "The plan declared 1 feature; this change touches 3." Delta both ways; extra files listable. Absent (`measured:false`, neutral reason) with no plan. | `planTouches()` vs the changed files' features |
| `unexplained` | Changed files with no import path (through barrels) to the rest of the change or to what the plan declared, with the layers that would normally connect them; a shared component edited while its consumers are untouched. | impact report `reasons`, `SHARED-COMPONENT` |
| `rule-regressions` | Violations new on head only (pre-existing ones are a number, never counted), each with rule id and the layer constraint that explains it. | `validate` on both trees, `rule:<ID>` seed |
| `public-surface` | Exports that stopped/started being public, and which features import the index. | `PUBLIC-API`, before/after exports |
| `flow-diff` | "This change removes the path idle → pending → rejected → success", in the narrator's own words. | `enumerateScenarios` on both commits |

Findings are `mechanical` (a Construct block resolves it with no model; carries `fix.via` and `fix.available`)
or `conversation` (a human decides). The two are never merged. The engine only classifies; it fixes nothing.

## Read-only guarantee

Refs are validated (no leading `-`, no control characters), resolved with `git rev-parse --verify
--end-of-options`, and only the resulting object id is used afterwards. Git is spawned with argv arrays (never a
shell), `--literal-pathspecs`, `--no-optional-locks`, and `--` before paths. Trees are read from temporary
`git worktree add --detach` checkouts under `os.tmpdir()` (hooks and LFS filters disabled), always removed in a
`finally` and on exit/SIGINT/SIGTERM, so the working tree, index, branches, stash and `git worktree list` are
byte-identical afterwards. Uncommitted local changes are never part of a comparison.

## Exceptions

- A change over the impact cap (200 files) degrades to a feature-level summary (`degraded.truncated`);
  `unexplained` then says it is not measured rather than guessing.
- Violations are matched by rule + file + message, so a file that was moved and still violates reads as new.
- Only workflow files with an XState machine are diffed; scenarios are capped at 100 per machine (`incomplete`).
- `SLICE-002` is classified mechanical but no refactor command performs it yet (`fix.available:false`).
- A run killed with SIGKILL cannot clean up; the next run removes its own `construct-prhealth-<pid>-` debris.

## In the Cockpit (Review mode, #312 / #313)

Review is the fourth top-level mode (`Explore / Plan / Build / Review`; `Plan` is only the new label of the old
Research button). `/review` lists the current project's **local branches** compared against a base (default
`main`), each with the badges this engine computed; `/review?base=main&head=<branch>` reviews one change:
changed units grouped by feature then layer (Browser), what each unit now does from `summarizeUnit` on the head
commit (stage), and the five indicators (Tools). No plan means "not measured", shown as a neutral card.

Server (`ui/server/src/review*.mjs`, all behind the session gate): `GET /api/review/branches?base=`,
`POST /api/review/analyze {base, heads[]}`, `GET /api/review/change?base=&head=`. Branch names come from the
client and are accepted only if they are exactly a branch listed by `git for-each-ref refs/heads` of the current
project (never a path or repository from the client; a leading `-` is refused). The engine runs in a forked child
process per job, one at a time, so a slow analysis never blocks a request. The list source is an adapter
(`reviewRefs.mjs`); a GitHub pull request source is a later ticket.

### Findings, scope and states (#315, #316, #318)

- **Findings tab** (Tools) lists every finding in two groups that are never blurred: *Can be fixed
  mechanically* (the engine's `resolution: mechanical`, with the exact `fix.via` command; `fix.available:false`
  reads "No automated fix yet") and *Needs a decision* (`conversation`; never a fix of any kind). Selecting one
  shows it on the stage. The command is **shown, never run**: nothing in Review applies a fix (auto-fix is #317).
  The drawer's Findings tab says how many are mechanical.
- **Blast radius**: pick a saved plan (the plans of the project's processes) from "Compare with a plan"; the
  plan's `planTouches` is passed to the engine as `expected`. With none, scope is a calm grey "Not measured" and
  every other indicator is unchanged. `GET /api/review/plans` lists the choices; `plan=<id>` on `POST
  /api/review/analyze` and `GET /api/review/change` selects one. The id is compared with the store's own listing
  and refused (404, `BAD_PLAN`) otherwise; it is never used to build a path.
- **States**: an error says what happened and what to do next (`code` from the server: `NOT_A_GIT_REPO`,
  `BAD_REF`, `BAD_PLAN`, `TIMEOUT`, `GIT_FAILED`, ...); a repository with no commit or no other branch says so;
  a change over 200 files shows the engine's `degraded` banner (which checks still ran) instead of an error;
  at 390 px one pane shows at a time with the bottom tab bar.

## Next

The Cockpit slices (#312, #313, #315, #317, #318) render this JSON; reading a real GitHub PR (#278) only
needs to produce the two refs.
