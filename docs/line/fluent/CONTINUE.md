# Fluent build: continue from here (any Claude account)

Stopped by the owner 2026-10-15 ~00:25 UTC ("stop all", "commit ... so that we continue from here from any claude account").

## Read first (also ARTIFACTS.md for the pages and CONTRACTS.md for every data shape)
1. `docs/line/FLUENT-PLAN-2026-10-15.md`: vision, how we work, contracts C1-C5, tasks.
2. `docs/line/CARRYOVER-2026-10-15-smith.md`: why Smith and the codemod live in construct.
3. This file.

## Where things are
- Branch `line/import-smith-codemod` on `private` (construct-private only, never `origin`). Wave 1 tip f3b27614; wave 2 merges on top.
- Code: `packages/line-smith` (@line/smith), `packages/line-codemod` (@line/codemod), `packages/line-fluent` (@line/fluent: contract/, compare/, grammar/, gate/, pilot/, coverage/, student/, records/, lsp/).
- Wave 2 agent branches on private: `line/fluent/<task-id>`. Merged (checked against git 2026-10-15): t0-5 probe port, t1-1, t1-2a, t1-2c, t1-3a-c, t2-2, t3-1, t3-2a, t3-3a, t4-1, t4-3a, t4-4a, t5-4a (check `git log f3b27614..private/line/import-smith-codemod`). Pushed, not merged: t2-3a-coverage (5caf65fd), t0-6-links-inrepo (2ee07648), t1-2b-equivalence (de0ebf60), t2-1-spike (WIP commit, unverified), t1-2d-types (50019eff, one commit; the agent was killed, so unverified).

## Board and plan pages
- Live board: https://claude.ai/artifact/VYndtXxtfnVBzKVbXSbsHh (republished 2026-10-15 from `board-data/`). Plan page: https://claude.ai/artifact/W7PQWdprAh1gHibHkqUE8y.
- Originals on the first account (not visible from the second): board https://claude.ai/artifact/RG6vQ6E4ka7eCmcyqrk6wg, plan https://claude.ai/artifact/HwgVFom6D4FBSMe5RSkjZZ.
- Sources here: `board.html` (db-backed: collections `tasks`, `agents`, `release/current`), `plan.html`.
- `board-data/`: snapshot of the board's db at stop time, one JSON per document (`tasks/<id>.json`, `agents/<id>.json`, `release/current.json`; each file is the document's fields, and the filename is its id).
- From another account: publish `board.html` as a new artifact with capabilities
  `{"db":{"rules":[{"path":"tasks","read":"view","write":"admin"},{"path":"release","read":"view","write":"admin"},{"path":"agents","read":"view","write":"admin"}]}}`,
  then load `board-data/` with ArtifactData `batch` writes (`set`, collection + doc_id from the filename, `file_path` = the file), max 50 per batch. Update the links above.

## Test state
- Smith 757/757, codemod 231/231, line-fluent wave 1 106/106 (all inside construct).
- Full suite on wave 1 (f3b27614 + T0.1/T0.2): 7636 tests, 7572 pass, 3 fail, 55 skipped. fluent-v0.1.0 NOT tagged. Failures:
  1. studio-export editor "volume knobs" (timing under load; passed alone before, unrelated).
  2. "every generated contract.d.ts is current": run `node packages/tools/line-module/contracts.mjs` (new workspace packages need contracts).
  3. "every exports target of a workspace package exists": @line/smith exports `dist/`, which exists only after `npm run build` in packages/line-smith. Fix: build before the check, or point exports at sources.

## Owner's latest operating rules
- Work on ONE task at a time, with the same capacity: 14-18 agents on that one task (split it into file-disjoint 15-20 min leaves with contracts). Owner's words: "work on one task at a time will same capacity".
- The task closest to done always has 4-5 agents.
- Every task and subtask files a `report` on the board when done (shape in the plan doc / board.html `reportHtml`).
- Heavy jobs one at a time (`packages/tools/dev/heavy.sh`); full suites may move to a cloud session once a cloud environment for construct-private exists (owner: cloud only for full suites).

## Next
1. Fix the 2 real suite failures, re-run the full suite, tag fluent-v0.1.0 at the passing commit.
2. Merge t0-6-links-inrepo after verifying; finish T1.2 (gate) as the one task with full capacity.

## Wave 3 (2026-10-15, dev only)
Owner rules for this wave: dev work only, no benchmarks or baselines (T0.3, T1.4, T3.4, T3.5 are skipped); run open tasks in parallel, one session each, on its own `line/fluent/<task>` branch; the orchestrator verifies and merges one at a time.
- Merged into `line/import-smith-codemod` (tip e0d36374): t0-5 probe port, t0-6-links-inrepo, t2-3a-coverage, t1-2b-equivalence, t4-2-hover. All 251 line-fluent tests pass on the combined tree.
- Running (Claude Desktop sessions), each pushes its branch and reports: t1-2d-types, t2-1-spike (T2.1a), t2-4-writeatoms (merges `line/import-v2-static-breakdown` eae0470a into its branch first, per the owner), t5-1-generator, t5-2-mcp, t5-3-cockpit, and `line/fix-missing-exports` (restores `fixtureRows`, `fallowFunctions`, `complexityByName`, which break 7 test files on the base).
- Merge recipe: fetch the branch, `git merge --no-ff`, run the changed test files plus `node --test $(find packages/line-fluent -name '*.test.mjs')`, push to private, then set the task to done on the board (ArtifactData `update` with `if_version`).
- Board shows "When it's 100% done", "How it's done", and "Capabilities by release" (grouped by task `version`, else by `release/current.items`, else Later).
