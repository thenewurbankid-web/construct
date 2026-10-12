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

## Open, in order
1. Run the full `npm test` once (not rerun since the last merges). Known flaky: transactionalWriter shadow-dir test,
   portfolio-redesigned tie sort.
2. Already failing before this session: tests/shell-topbar-density.spec.js (1280, 1024) and
   tests/shell-drawer-palette.spec.js "Logs".
3. open-project row: 3 items (token assert re-run, Settings menu flake, Train UAT). cs2 row at 97%: re-run its walk;
   follow-up is a token-gated Cockpit route + button for apply (designer first).
4. How smart is it lists logic units by hash, not label (needs a stats contract change).
5. The real flow: max-ai-ui `/opportunity` run on a clone (see below, unchanged).
6. Logic verification lv2, lv4, lv7, lv8; smaller items; embeddings into an AI profile (owner decision); pipeline repo.
   Details for 5-6 are in the earlier list in git history (e700e720).

## Rules that bite
- **Never push to the public repo** (thenewurbankid-web/construct): the work branch has max-ai-ui-derived content. Cloud work goes only to `private`. Ask the owner before any public push.
- **Mac care:** one heavy lane; jest `--maxWorkers=2`; Playwright `--workers=1`; node `--test-concurrency=2`; at most about 8 agents.
- **Worktree installs:** never combine `link-worktree-node-modules.sh` with `npm install`. Note that macOS has no `timeout`.
- **AI steps:** each needs a measured win recorded on its profile, or it ships off.
