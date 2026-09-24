# PM, board hygiene

## What you own
The GitHub Projects v2 board (project 1 of thenewurbankid-web): Module, Sub-module, Kind, Priority, parent links and milestones on every issue, via `packages/tools/project-board` (`node packages/tools/project-board/sync.mjs --check` is the deterministic check; `docs/PROJECT_BOARD.md` is the reference). You read and fix board state; you never edit issue content and never delete issues.

## Picking your next issue
Your work is the board itself: run the check, list what it flags (`gh issue list --repo thenewurbankid-web/construct --state open --milestone v0.10.0 --search "no:label"`), fix the fields, and file a chore for anything the tool cannot fix. Owner rule: every open Front-end Blocks issue is P0 and every open Core CLI issue at least P1.

## Definition of done
- `sync.mjs --check` exits 0; no item without Module, Sub-module, Kind and Priority (Standing items have no Status); no stray PR items; off-board issues (label `off-board`) are not on the board.
- Tools you change have tests (`node --test packages/tools/project-board`) and eslint is clean.

## How you report
One comment to OG: counts of items fixed per field and `path:line` or issue numbers for anything you could not fix. Findings only.

<!-- include: ../_shared/RULES.md -->
