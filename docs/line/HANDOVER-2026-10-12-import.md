# Handover: Line Import v2, opportunity run (2026-10-12)

**Start here.** Read the following first:
- `docs/line/import-v2/CONTRACT.md`
- `docs/line/review.md`, section "Import v2"
- `CLAUDE.md` and `LINE.md`

`work/2026-09-23` is at **5801a7de** (local, never pushed). It holds wave 4 (awaiting the owner's UAT; checklist in review.md under "Wave 4: ready for owner UAT"), the walk fix, the yaml-comment fix, the plan lock, System 1 accuracy and Import v2.

## The owner's goal
Import a feature from a target app by reading its routes and files. Build a logic map and characterization tests, fit the existing logic into Line's blocks (page, component, workflow, fixture, usecase, service, domain), and import step by step until no logic unit is missed and every test passes. The first real case is max-ai-ui `/opportunity`.

## What the end-to-end run showed
The run was on a clone. Driver: `~/Repositories/construct-old-copies/opp-e2e-2026-10-12/run.mjs` (plus log.jsonl); to reproduce it, copy the agent route test in `test/line-import-agent.test.mjs`.
- `start` took 29 min.
- Route family `/opportunity` gave 7 routes, but the closure was 187 files: 15,152 units, 1,603 blocks, 840 steps, and 250 units that no rule placed.
- 1,252 characterization tests were generated, and all passed before any move. Unit coverage was 1,748 of 15,152.
- Step 1 was fine. Step 2 (move `opportunityAdapter` into the library) kept every unit, but 102 of the 1,252 tests failed. The loop stopped correctly and offered recheck or undo.

## Fix 1: feature scope
`readRouteFamily` with `excludes: []` follows every import: the app shell, the store, the UI kit, and so on.
- The rule: a file belongs to the feature only if it is reachable from this route family and from no other route in the app.
- Files that other routes also use are "shared": list them in `RouteClosure.shared`, reference them, and do not import or fit them. They could become library candidates later, as a separate import.
- Use the reverse import graph (`line/import.mjs` `importGraph`) together with the full route table.
- Expected result: about 14–30 files for `/opportunity`. The earlier prototype traced 14 files with 637 units.

## Fix 2: a move breaks the generated tests' mocks
This is likely, not yet confirmed; inspect a failing test first, e.g. "#001 renders with 24 data hooks…". The generated tests in `__line_characterization__/` mock modules by path. After a move, the component imports from the new path, so the mock no longer applies.
- Either the move tools (`tsFileMove` and the `line.import.*` and extract tools) also rewrite `jest.mock(...)` and import paths inside the characterization folder,
- or the characterizer mocks in a form that follows moves.
- Add a test: move a mocked module and the characterization tests still pass.

## Fix 3: speed
Start should take minutes once the scope is right. Profile the characterize step, and cache the map and tests by file hash.

## Then
Re-run `/opportunity` end to end on a fresh clone until it reaches `done` with every check passing, or with only owner-waivable units left. After that, pre-walk the Cockpit UAT in review.md ("Import v2" → UAT) and hand the owner one UAT list.

## Owner rules (still in force)
- Ask the owner only before a public push.
- Every write goes through Construct's writer.
- Only a person approves writes.
- Take the recommended call and keep going.
- Pre-UAT on the owner's behalf; only the owner's UAT marks a step done.
- Heavy jobs go through `heavy.sh`. Don't combine `link-worktree-node-modules.sh` with `npm install` (it damaged the main checkout's node_modules once; it was repaired with `npm ci`).

## Decided, still to do later
- Layers wave: domain/usecases/services kinds formalized; Sheriff as the dependency-rule engine wrapped by Construct; publint, are-the-types-wrong and knip as findings.
- OSS wave: zod schemas, fast-check, AST instead of regex, dagre, Express 5, parseArgs, pluralize, stable JSON, eslint-plugin-playwright, a generated client contract.
- Nx affected and cache trial.
- Rename the Train `train_*` routes and tools to `training_*`.
