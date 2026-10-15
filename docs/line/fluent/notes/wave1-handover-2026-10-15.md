# Fluent build, wave 1 hand-over (2026-10-15 ~00:40 UTC)

- Plan + contracts: docs/line/FLUENT-PLAN-2026-10-15.md. Plan page: https://claude.ai/artifact/HwgVFom6D4FBSMe5RSkjZZ
- Live board (db: tasks/<id>, release/current; write with ArtifactData, pin if_version): https://claude.ai/artifact/RG6vQ6E4ka7eCmcyqrk6wg
- Integration branch line/import-smith-codemod on private at f3b27614: T0.1 paths cf76e053, T0.2 wiring 88733ba3 + 9b8e8020, wave-1 merges (T1.1 contract, T3.1 compare, T4.1 grammar).
- Counts: Smith 757/757, codemod 231/231, line-fluent 106/106, eslint clean. Full suite was running (heavy.sh npm test) at hand-over; log in the old session's scratchpad full-suite.log. Tag fluent-v0.1.0 only after it passes.
- Owner mode: ALL PARALLEL, as many agents per task as possible (owner, after first saying one at a time).
- Wave 2 candidates: T1.2 gate runner, T2.2 construct english CLI, T1.3 pilot prep. Blocked: T0.4 (owner yes to push wave 3 + import-v2), codemod pin conflict (atoms-probe 9dc24ab vs in-repo).
- line-links tables (smith.json, atomic-codemod.json) still point at ~/Desktop clones; owner chose "explain more" then re-scoped, undecided.
