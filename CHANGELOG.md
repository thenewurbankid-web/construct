# Changelog

Newest first.

## A2 — 2026-09-29
- `reorderSteps(code, kind, order)` in `to-english.js`: rebuilds a function/method with its top-level statements reordered (or dropped, when an index is omitted from `order`) via Babel AST + `@babel/generator`, not text-splicing — so the output is always well-formed. New `POST /api/reorder-steps` endpoint takes `{ code, kind, order }` and returns `{ refactored, english, steps, title }`, all re-derived from the rebuilt code.
- Demo: each block's English now renders as a list of step rows (one per `steps[]` entry from A1) instead of one flat read-only sentence. Rows drag-and-drop to reorder, support Alt+Up/Down to swap with a neighbor from the keyboard, and have a delete (×) button. Every move/delete calls `/api/reorder-steps`; the refactored code textarea and the step rows are both replaced with the server's response, so the English is always re-derived from the code that's actually there — editing the sentence text directly was never possible, so the two can't drift. An undo button restores the block's previous `{ code, steps }` from a per-block stack.
- Added `reorderSteps` tests to `to-english.test.js` (swap, drop, class-method unwrap-stays-unwrapped). `npm test`: 10/10 passing.
- Verified on the demo (http://localhost:5175/demo.html): analyzed the default `FormValidator` class, dragged a step row to a new position and confirmed both the row order and the code textarea updated together, deleted a row, and undid it back.
- Block 2/4 of LIN-119. Remaining: red-on-break highlighting for a reordered step that now runs before a binding it uses is defined (block 3), and editable step wording resolving to registry atoms with an "Add implementation" path for unrecognised wording (block 4).

## A1 — 2026-09-29
- `toEnglish(code, kind)` now returns `{ english, steps, title }` instead of a bare string. `english` is unchanged (same flat "title: step1; then step2; ..." string, so nothing that read it before breaks). `steps` is new: one entry per top-level statement of the refactored function/method body, each with `{ english, code, start, end }` — its own sentence, its own code slice, and its node range in the refactored source. This is the addressable unit the next block (drag-to-reorder step rows on the demo) will operate on.
- `/api/to-english` now returns the `steps` array alongside `refactored`, `english`, and `atoms`.
- Added `to-english.test.js` (`node --test`) covering the flat string, per-step ordering, code-slice/offset correctness (including the class-method wrapper-offset case), and that `extractAtoms` is unaffected. Wired `npm test` to run it (was a no-op placeholder before).
- Verified on the demo (`node server.js`, http://localhost:5175/demo.html): `/api/chunk` and `/api/to-english` responses unchanged in shape apart from the additive `steps` field; existing block rendering in `demo.html` is untouched (block ~1 of LIN-119; blocks 2-4 — reorder UI, red-on-break highlighting, editable wording — are separate follow-up commits).
