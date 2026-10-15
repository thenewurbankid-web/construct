# Fluent build: published pages and their data

All pages are private claude.ai artifacts on the owner's account. To work from another account, republish from
the sources here; a link only opens for its owner and anyone it is shared with.

| Page | Link | Source in repo | Data |
|---|---|---|---|
| Fluent Build Board | https://claude.ai/artifact/VYndtXxtfnVBzKVbXSbsHh | `board.html` | db, snapshot in `board-data/` |
| Fluent English Plan | https://claude.ai/artifact/W7PQWdprAh1gHibHkqUE8y | `plan.html` | none (static) |
| Smith Atoms | https://claude.ai/artifact/VyLUndJe64ZfZEojij9E7b | built by `packages/line-codemod/bench/atoms/atoms-page/build.mjs` | generated from the Smith catalog |
| JS Reference Atlas | https://claude.ai/artifact/WgS7uBhJUJVYBYvaYonPao | built by `packages/line-codemod/bench/atoms/js-reference/site.mjs` | generated from `reference.json` |

`packages/line-codemod/bench/atoms/rebuild-pages.mjs` (task T5.4a) rebuilds and checks the last two.

## Fluent Build Board
- Icon `board`. Runtime contract 0.2.78.
- Capabilities (pass exactly this on a first publish):
  `{"db":{"rules":[{"path":"tasks","read":"view","write":"admin"},{"path":"release","read":"view","write":"admin"},{"path":"agents","read":"view","write":"admin"}]}}`
- Viewers only read. Claude writes through the ArtifactData tool, pinning `if_version` on every write to an existing doc.
- Shows: Overall hero (KPIs, plan countdown, elapsed), Current release hero, Closest to done hero, Agents panel,
  Reports, and the plan tree (epic > task > subtask) with contract, risks + mitigations, Claude's view, report,
  line counts and an ETA countdown per item.
- Data shapes: `CONTRACTS.md`, "Board data".

### Restore on another account
1. Publish `board.html` with the capabilities above (any `file_path`; keep the title "Fluent Build Board").
2. Load `board-data/`: every file is `{id, data, version}`. For each, an ArtifactData `batch` entry
   `{op: "set", collection: "<tasks|agents|release>", doc_id: id, data: data}`; up to 50 entries per batch.
3. Put the new link in this file and in `CONTINUE.md`.

### Fresh seed
`tools/seed-board.mjs` writes the original 38-item seed (one JSON per item, plus `release.json`) into `./seed/`.
Its ETAs are relative to 2026-10-15T00:00Z; change `t0` before reusing it.

## Fluent English Plan
Static page (icon `map`): the five stages, start-state facts, pass bars and owner decisions. The text version that
agents read is `docs/line/FLUENT-PLAN-2026-10-15.md`; that file wins when the two disagree.

## Notes
`notes/` holds the shared session notes from 2026-10-14/15: the last-24h survey, the wave 1 hand-over, the R9
every() build notes and Atomic English steps 1-4 (with the owner's six open questions).
