# Changelog

Newest first.

## A1 — 2026-09-29
- `toEnglish(code, kind)` now returns `{ english, steps, title }` instead of a bare string. `english` is unchanged (same flat "title: step1; then step2; ..." string, so nothing that read it before breaks). `steps` is new: one entry per top-level statement of the refactored function/method body, each with `{ english, code, start, end }` — its own sentence, its own code slice, and its node range in the refactored source. This is the addressable unit the next block (drag-to-reorder step rows on the demo) will operate on.
- `/api/to-english` now returns the `steps` array alongside `refactored`, `english`, and `atoms`.
- Added `to-english.test.js` (`node --test`) covering the flat string, per-step ordering, code-slice/offset correctness (including the class-method wrapper-offset case), and that `extractAtoms` is unaffected. Wired `npm test` to run it (was a no-op placeholder before).
- Verified on the demo (`node server.js`, http://localhost:5175/demo.html): `/api/chunk` and `/api/to-english` responses unchanged in shape apart from the additive `steps` field; existing block rendering in `demo.html` is untouched (block ~1 of LIN-119; blocks 2-4 — reorder UI, red-on-break highlighting, editable wording — are separate follow-up commits).
