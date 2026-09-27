# E2E lanes (#420, part of the SPOF-hardening epic #410)

`ui/e2e/` has grown to ~95 spec files over 12 Playwright configs (`ui/e2e/playwright*.config.js`),
run `workers: 1`, `fullyParallel: false`. Run serially end to end that's long enough to be the review
bottleneck on a shared dev box, and two concurrent suites in the same checkout race on
`ui/client/.next` (see "One checkout per concurrent run" below). Two lanes split the cost:

## 1. Smoke — required before merge

`ui/e2e/playwright.smoke.config.js`: `smoke.spec.js` (the "does the harness even work" check) plus
one spec per primary screen (`ui/client/features/shell/domain/PrimaryScreens.ts` /
`Navigation.spec.mjs`: **Features**, **Pages**, **Components**, **Git**, **Tests**):

| Screen | Spec |
| --- | --- |
| Features | `tests/features-screen.spec.js` |
| Pages | `tests/pages-screen.spec.js` |
| Components | `tests/components-screen.spec.js` |
| Git (route `/review`) | `tests/review-mode.spec.js` |
| Tests | `tests/tests-tab.spec.js` |

Target: **under 5 minutes**. Run it with:

```bash
cd ui/e2e
npm run test:smoke-lane                       # local
../../packages/tools/dev/heavy.sh npm run test:smoke-lane   # on the shared box (see below)
```

CI: `.github/workflows/e2e-smoke.yml`, triggered on every pull request into `work/2026-09-23`. This
is the gate a PR needs before merge; branch protection on `work/2026-09-23` should list its check
("smoke") as required (a repo setting, not a file — set once in GitHub's branch protection UI).

## 2. Full suite — sharded, on merge and nightly

`.github/workflows/e2e-full.yml` runs every `playwright.*.config.js` file found under `ui/e2e/` (read
from disk, not hand-listed, so a new config is picked up automatically), **one job per config**, each
`--workers=1` exactly like a local run. Triggers: push to `work/2026-09-23` (i.e. on merge) and a
nightly cron. Each job prints its own duration and pass/fail to the run's summary
(`$GITHUB_STEP_SUMMARY`), so "how long does the full suite take" has an actual number instead of the
unreproduced "22 minutes" figure that opened #420 — per-config, since that is what's ever run as a
unit.

Each shard is its own GitHub-hosted runner (its own disposable VM), so the two-heavy-jobs rule and
`packages/tools/dev/heavy.sh`'s machine-wide lock don't apply there — those exist for several
local/agent runs sharing the one dev box (see below). They still apply to anyone running the full
suite, or several of its configs, locally.

## One checkout per concurrent run (machine section, `CLAUDE.md`)

Already documented in full in `ui/README.md` ("Ports and concurrent runs (#140)"): two Playwright
suites in the *same* checkout share `ui/client/.next`, so a cold-start compile can race between them.
Use a distinct checkout/worktree (plus `E2E_CLIENT_PORT`/`E2E_SERVER_PORT` for distinct ports) per
concurrent run; `E2E_REUSE_SERVERS=1` is for local debugging only, never for two independent runs.
`CLAUDE.md`'s own machine section now carries the one-line summary so it isn't `ui/README.md`-only.

## TMPDIR / RAM-backed `/tmp`

Playwright's own config and `ui/e2e/support/workspace.js` create their scratch state under the OS
temp dir (`os.tmpdir()`): per-run state dirs, the preloaded default project, per-worker fixtures.
`packages/tools/dev/heavy.sh` prunes `/tmp/construct-*`-style directories by owner-pid liveness (see
its header comment), not by age, specifically because a full e2e run can run long.

Checked on this box: `/tmp` is already `tmpfs` (RAM-backed, ~7.7G — `df -h /tmp` / `mount | grep tmp`),
so no `TMPDIR` override is needed here; Playwright's temp I/O never touches the disk. On a machine
where `/tmp` is a plain disk-backed filesystem, point `TMPDIR` (and `E2E_STATE_DIR` if set explicitly)
at a `tmpfs` mount before running Playwright — disk I/O for the volume of small temp files an e2e run
creates (one project checkout plus per-test fixtures) is otherwise a real, avoidable slowdown, and
`heavy.sh` already honors `TMPDIR` for its own pruning (`CONSTRUCT_HEAVY_TMP` defaults to
`${TMPDIR:-/tmp}`).
