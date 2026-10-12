# Carry-over for a fresh session (2026-10-12, evening)

Start here. Read `CLAUDE.md`, `LINE.md`, then this file.

## State
- `work/2026-09-23` is at **af65c912**, local only. It has not been pushed to the public or the private remote. It holds:
  - wave 6: cloud-knows, cloud-modes, bench-gaps, line-expressions, atoms-core (14 atoms) and primitives-core (40 primitives);
  - the AI cleanup (one ladder, unmeasured steps off, retired pieces removed, PNG mocks on LFS);
  - logic verification steps 1, 3, 5 and 6.
- **Tests:** the full suite passes with 0 failures, eslint has 0 errors, and the tsc ratchet is at 472. All Playwright specs pass except one (below).
- **Docs branch:** `claude/nervous-ramanujan-d81f1e` holds docs commits that are not yet on the work branch: the roadmap, the logic-verification spec and owner decisions, the ladder fixes in the roadmaps, and this file. Merge it before writing new docs.
- **Tracker:** https://claude.ai/artifact/MeBjHC1CW7ZHHc4M95t7AN. Mark a row done only when it is merged and its UAT walk has passed. lv1, lv3, lv5 and lv6 are at 95% and merged; they still need a walk.
- **Design page and mocks:** https://claude.ai/artifact/VtVxSB2mpCmsrgtKCBCQsq (a drill-down system design, with cleaned mocks). The source is in the session scratchpad: `mocks-src/build.mjs`.

## Update (2026-10-12, late): work/2026-09-23 is at 663e17de, local only
- Done and merged: the line-knows "Change: plan" fix (stale graph reuse in knows/service.mjs); every UAT walk now
  starts Under the hood (Cockpit opens in Chat); new walks: uat/two-modes, uat/what-line-knows, and CLI walks in
  ui/e2e/uat/cli (cs2, primitives, atoms, lv; `node ui/e2e/uat/cli/run-all.mjs`); cs2 apply refuses with no
  terminal and asks y/N in one. Tracker: 14 rows marked done.
- Main checkout had missing deps; `npm install` was run at its root and in ui/client.

## Update (2026-10-12, 14:50): og wave merged locally
- Done: item 1 (full npm test: 6,680 tests, only known flakes); item 2 (#793 Processes drawer crash, #860 project
  switcher overflow; both specs 10/10); item 4 (#856 readable unit labels, exports named); smaller items (#870
  analyzeRoute removed, #871 embeddings as one AI profile step, #873 library passthrough); lv2 (#861), lv4 (#859),
  lv7 cache + verifyImport logic check (#857); setup gap (#853), heavy.sh macOS RAM check (#854); Android epic #855
  with sub-issues #862-#869, #862/#865/#866/#867/#869 fixed.
- Walks: cs2 and the CLI walks pass 4/4; open-project token assert passes; Train spec 5/5.

## Open, in order
1. og/lv7-transforms (c62032af transforms -> proven, bb6ce58e purity into logic map and G1) conflicts with #856's
   exportName in packages/engine/line/logicMap.mjs and graph/build.mjs (both sides additive); merge it by hand.
2. Real flow (item 5): reaches step 14 of 67 after #858 and #872; step 14 is #875 (renamed component reads as
   missing + added; per-file renames recommended). Clone kept at /tmp/construct-realflow-142056.
3. Pipeline repo: fast-forward core/ship (runs/core-ship, 61eee8f) to line-merge-pipeline 3886a74, then
   `node packages/line-links/link.mjs --pin`, then the link tests.
4. Settings-menu flake (cold dev-server compile, not a race), Train UAT walk, lv4 hook runner + V8 coverage, lv8.
5. Designer: Cockpit library selector on New project (#873); token-gated apply route for cs2; Memory-tab copy.

## Rules that bite
- **Never push to the public repo** (thenewurbankid-web/construct): the work branch has max-ai-ui-derived content. Cloud work goes only to `private`. Ask the owner before any public push.
- **Mac care:** one heavy lane; jest `--maxWorkers=2`; Playwright `--workers=1`; node `--test-concurrency=2`; at most about 8 agents.
- **Worktree installs:** never combine `link-worktree-node-modules.sh` with `npm install`. Note that macOS has no `timeout`.
- **AI steps:** each needs a measured win recorded on its profile, or it ships off.
