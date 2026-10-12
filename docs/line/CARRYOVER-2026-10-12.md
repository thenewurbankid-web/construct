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

## Open, in order
1. **`ui/e2e/tests/line-knows.spec.js:66` "Change: plan" fails.** After you approve, a second "Move OrderButton" proposal stays "proposed". It fails the same way on d9b75dc8, so it predates the merge. Fix it in the cloud-knows change flow.
2. **UAT walks for the merged rows:** im1, im2, im3, j5, cs2, cu4, cu5, open-project, atoms, primitives, two modes, What Line knows, and lv1/3/5/6.
3. **The real flow:** run max-ai-ui `/opportunity` to done with `~/Repositories/construct-old-copies/opp-e2e-2026-10-12/run2.mjs <construct-root> <out-dir>`, on a clone only. Then build the shop through Cockpit chat.
4. **Logic verification**, next steps (the spec is in `docs/line/HANDOVER-2026-10-12-import.md`):
   - **lv2:** add `logicVerify/purity.mjs` `classifyUnit`, reusing Morpheus's transitive effect scan.
   - **lv4:** the isolated runner in `verifyPair.mjs` `RUNNERS.isolated`, in a child-process sandbox with recording fakes.
   - **lv7:** wire it into Import v2 / `verifyImport` and the Cockpit step view, and cache `analyzeClosure` per file hash.
   - **lv8:** the L2 dev server and L3 browser levels, plus the proof run on the clones.
5. **Smaller items:**
   - Cockpit can't create a project from the primitives library yet: `lineNewProjectApi` doesn't pass `library` through, and there is no selector in the UI.
   - Recheck `/api/validate` against the middleware hooks when `mw-ladder` merges.
   - `import.mjs` `analyzeRoute` is a leftover LLM call that only tests use.
   - Memory embeddings have a second switch next to the AI profiles; this needs an owner decision.
6. **Pipeline repo:** fast-forward core/ship to 3886a743, then bump Construct's pin together with the studio-editor link.

## Rules that bite
- **Never push to the public repo** (thenewurbankid-web/construct): the work branch has max-ai-ui-derived content. Cloud work goes only to `private`. Ask the owner before any public push.
- **Mac care:** one heavy lane; jest `--maxWorkers=2`; Playwright `--workers=1`; node `--test-concurrency=2`; at most about 8 agents.
- **Worktree installs:** never combine `link-worktree-node-modules.sh` with `npm install`. Note that macOS has no `timeout`.
- **AI steps:** each needs a measured win recorded on its profile, or it ships off.
