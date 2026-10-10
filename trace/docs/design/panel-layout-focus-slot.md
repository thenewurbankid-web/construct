# Run screen — focus-slot panel layout, slim ring, pinned Ask, field drop targets, gap rows

Status: spec written in parallel with build (owner decision 2026-09-29, [[LIN-117]]): all 7 items below are **adopted, no approval gate**. This doc is the reference Ad hoc Dev aligns each block against as it lands, not a confirmation request — [[LIN-116]]'s original "recommend 2/3/5/6, then request_confirmation" framing is superseded by that decision.
Part of: [[LIN-116]] (spec) / [[LIN-117]] (build, Ad hoc Dev, in progress). Builds on `docs/design/run-api-panel-and-wires.md` (API contract panel, drag-to-attach) and `docs/design/screen-map.md` (ring/Ask/Handoff semantics).
Base: `trace/src/ui/demo.html` `#s-fit` section — `#side` (ring + progress + Ask), `#stage`/`#map` (canvas, contract rail), `src/ui/canvas/` (Map view), `inspector/inspector.mjs` (Ask card, drawer pattern).

## 0. Why this order (matches LIN-117's build sequence)

Numbered 1–7 below in the order Ad hoc Dev is building them, each its own minor release. Items are independent enough to ship and screenshot separately; later items (5–7) build visually on top of earlier ones (1–4), which is why they're sequenced last even though the owner's original brainstorm listed the focus slot first.

## 1. Progress ring → slim summary strip

**Before:** `#hero` (`demo.mjs`, ring SVG, `r=56`, `CIRC` circumference) renders a full ring card at the top of `#side`, ~180px tall, one state legend row per segment (fit/wait/gap/tie/stub).

**After:**
```
┌─ header ──────────────────────────────────────────────────────┐
│ {mark} Trace        8/29 fit · 3 waiting · 2 gaps    build 214 │
└──────────────────────────────────────────────────────────────────┘
```
- Strip sits in `<header class="top">`, next to the existing `#bBuild` release badge — same row, not a new row (header height unchanged).
- Text order matches ring legend order (fit → wait → gap; tie/stub fold into "waiting" and "gaps" respectively when their count is 0, so the strip never grows past 3 clauses). Counts come from the same `summarize()` (`vocab.mjs`) the ring already calls — no new aggregation.
- `#side`'s ring card (`#hero`) is removed entirely; `#progress` (the `role="status" aria-live="polite"` announcer) stays and now announces into the strip's `<span>` instead of the removed card.
- Click target: clicking the strip scrolls/focuses the first unresolved Ask (same target the pinned bar in §2 opens), so the ring's old function as "the thing that tells you what's left" isn't lost, only compressed.

**Accessibility:** strip text carries the counts in words, not color-coded chips — satisfies "shape or word besides colour" without new work, since it was already text. `aria-live="polite"` region moves with it (reuse `#progress`'s existing id/role, just relocated in the DOM). Contrast: strip text against `--top`/header background must hit the existing `theme.test.mjs` `SEMANTIC` check for UI text (4.5:1, not the looser 3:1 large-text bar, since header text is small) — add a row for `.strip` if not already covered by an existing header-text check.

## 2. Ask card → pinned collapse bar

**Before:** the Ask card lives inline in `#side`/`#sideBody`, always expanded, pushed down the column when the API details drawer (LIN-90) opens above it.

**After (details closed):** Ask renders full, as today, at its current position in `#sideBody`.
**After (details open):**
```
┌─ right column ──────────────────────┐
│ ┌─ API details (focus slot, §5) ───┐ │
│ │ GET /api/orders              ✕  │ │
│ │ ...                              │ │
│ └──────────────────────────────────┘ │
│ ...rest of column...                 │
│ ┌──────────────────────────────────┐ │
│ │ 1 question waiting — answer   ▾ │ │  ← pinned bar, column bottom
│ └──────────────────────────────────┘ │
└───────────────────────────────────────┘
```
- Bar is `position: sticky; bottom: 0` inside `#side` (not `fixed` — stays inside the column, doesn't overlap the main stage), one line, count + verb ("1 question waiting — answer" / "3 questions waiting — answer" via existing `plural()` helper from `vocab.mjs`).
- Click or `Enter`/`Space` (it's a `<button>`, not a div) expands in place, pushing the pinned position down to just above the true bottom of the column; the API details panel above is untouched, matching §1's "compress the summary, not the mechanism" principle. Expand/collapse only, never navigates away.
- Zero-Ask state: bar isn't rendered at all — same "the Ask card doesn't render an empty state" rule the current inline card follows (`demo.mjs` — Ask only mounts when the queue is non-empty).
- **Buildability note:** this only needs a CSS position change (`sticky`) plus one collapse/expand toggle on the existing Ask card markup — no new component, matches Ad hoc Dev's LIN-90 pattern of reusing inspector drawer chrome rather than inventing new panel types.

**Accessibility:** collapsed bar is a real `<button aria-expanded="false">`; expanding sets `aria-expanded="true"` and moves focus to the first focusable element inside the expanded card (standard disclosure pattern, matches the demo's existing `.pal-group` disclosure convention referenced in the parent repo's `docs/design/README.md`). `prefers-reduced-motion`: collapse/expand is a height snap, no slide animation, when reduced motion is set (gate alongside the existing gates at `demo.mjs:20,341,461`).

## 3. Field rows as drop targets (magnetic nearest-compatible)

**Before:** per `docs/design/run-api-panel-and-wires.md` §4, a dragged Tie wire highlights whole **API cards** as compatible/incompatible; dropping anywhere on a compatible card resolves the tie to that endpoint (not a specific field).

**After:** the drop target is the **field row** inside the open API details card (§3 of that doc's "Fields used by this run" list), not the card as a whole:
```
┌─ API contract — GET /api/orders ──────────┐
│  Response  {view|edit}                     │
│   id                                        │
│   total     ← drop here (compatible, ring)  │
│   status    ← drop here (compatible, ring)  │
│   placedAt  (dimmed: incompatible type)     │
└──────────────────────────────────────────────┘
```
- "Magnetic nearest-compatible" = while dragging, the nearest compatible **field row** (not card) gets the `--acc` ring + ✓ mark from the existing spec's §4/§7 (`run-api-panel-and-wires.md`); if the pointer is over a card with no compatible field within a snap radius, the whole card dims per the existing incompatible treatment.
- Drop resolves the tie to `endpoint + field` (a more specific attachment than the existing card-level drop), same `answered → ledger` path, same confirmation toast, just naming the field in the toast text ("Attached to GET /api/orders · total").
- This refines rather than replaces `run-api-panel-and-wires.md` §4: same compatibility function (§4.4 of that doc, static type match), same keyboard path (§7.2–7.3), scoped down from "compatible card" to "compatible field row within that card." Existing spec's card-level compatible/incompatible visual states still apply one level up (a card with zero compatible fields still dims as a whole).

**Accessibility:** field-row-level target names are exactly the field label already rendered ("total", "status") — no new accessible-name work. Keyboard cycling (existing spec §7.2) now cycles fields, not cards, when the details panel is open; announcement text updates to "2 compatible fields" instead of "2 compatible APIs."

## 4. Gap rows in the details card

**Before:** Gaps render only as red wires ending at the canvas's `gap` special node (`parts.mjs`); the API details card (LIN-90) has no gap-specific section.

**After:**
```
┌─ API contract — GET /api/orders ──────────┐
│  Fields used by this run                   │
│   total     → Total (fit)                  │
│   status    → (tie, 2 parts)                │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Missing (2)                                │
│   ┄ customer.email  (design needs it)       │
│   ┄ discountCode    (design needs it)       │
└──────────────────────────────────────────────┘
```
- Dashed rows, appended below the existing "Fields used by this run" list (not mixed in) — reuses `run-api-panel-and-wires.md` §3's existing "2 gaps in the contract" line, now rendered as a row list instead of a count-only line, in the same section position that spec already reserved.
- Row dash style reuses the existing dashed-wire visual (`pal.gap`/`--red` token, dashed stroke) so "dashed = gap" stays one vocabulary item across canvas and panel, not two conventions for the same meaning.
- Red gap wires on the canvas now terminate visually at this row's position when the details panel is open (a targeting/anchor change in `map.mjs`'s edge endpoint calc) rather than the generic `gap` special node — only when that endpoint's details panel is the one open; otherwise wires still end at the shared `gap` node as today.
- Clicking a missing row: no drop target (per `run-api-panel-and-wires.md` §2, gaps aren't draggable — fixing one is a contract edit), instead opens the existing "Edit contract" mode already in the panel, cursor placed at the closest existing field.

**Accessibility:** "Missing" heading + count precedes the rows (screen reader gets the count before the list, same pattern as "Fields used by this run"). Dash style pairs with the "✗ missing" word in the row text — never dash-only, since dash-vs-solid is a subtle visual distinction to require of color-blind or low-vision users without a text backup.

## 5. Right column = one focus slot + rest below

**Before:** the API details drawer (LIN-90) is a full-height right-side drawer overlaying/replacing the column; the Ask card and other `#sideBody` content are pushed down or hidden while it's open.

**After:**
```
┌─ right column (#side) ──────────────┐
│ ┌─ focus slot ─────────────────────┐ │  ← whatever was clicked:
│ │  (empty when nothing selected)   │ │    API details / part details /
│ │  API details, OR                 │ │    adapter flow (§7)
│ │  part details, OR                │ │
│ │  adapter flow                    │ │
│ └───────────────────────────────────┘ │
│  progress strip note (§1, in header, │
│  not repeated here)                   │
│  story panel (unchanged)              │
│  Ask pinned bar (§2)                  │
└────────────────────────────────────────┘
```
- One slot, one thing in it at a time: clicking a part (left column) or an API card (canvas) replaces the focus slot's contents — never stacks two detail views. This is the mechanism that makes §2's "pinned bar at the bottom" and §6's "click a part → scrolled-to-field" behave predictably: there's exactly one place per-click state can live.
- Empty state: focus slot collapses to zero height (no empty card chrome) when nothing is selected — column shows only the story panel + Ask, matching today's default layout exactly when nothing has been clicked yet.
- `#sideBody`'s other content (story panel) stays below the slot, always rendered, per the existing side-body order — the focus slot is inserted above it, not instead of it.

**Buildability note (for Ad hoc Dev, flagging explicitly since it's a DOM restructure):** this is a container-level change — `#side` needs a new `#focusSlot` mount point above `#sideBody`, and today's LIN-90 drawer implementation needs to target that mount instead of its own drawer container. Sequencing this after §1–4 (as LIN-117 orders it) means the drawer's internal content (contract panel, field rows, gap rows) is already built and stable before its container moves — lower risk than doing the container move first.

## 6. Two-way highlight

**Before:** clicking a canvas node calls `onSelect`, which highlights the matching row in the parts list (`inspector.mjs`) only — one direction, click-only, no hover.

**After:**
- Hover a **field row** (in the open focus-slot details, §3/§4) → its wire (canvas) and the design part it resolves (left column, `inspector.mjs` row) both get a highlight ring (reuse the `--acc` token treatment from `run-api-panel-and-wires.md` §4, not a new highlight color).
- Hover a **part** (left column row) → its wire + the API card/field it resolved to light up the same way, symmetric to the above.
- Click a part → opens its API details in the focus slot (§5) **scrolled to the relevant field row** (anchor scroll, not a full re-render) — this is the one interaction that changes focus-slot contents from a hover-only preview into a committed selection; hover never changes what's in the focus slot, only click does.
- Hover highlight is transient (mouseleave clears it); click selection persists until another click or `Escape`.

**Accessibility:** hover-only interactions have no keyboard equivalent by definition, so the **click** path (which does have full keyboard support per `run-api-panel-and-wires.md` §7) must remain the accessible route to the same information — a keyboard user reaches "part → its API, scrolled to field" via Tab + Enter, never needing hover. Reduced motion: scroll-to-field uses `scrollIntoView({behavior: reduced() ? "auto" : "smooth"})`.

## 7. Adapter card → chip under its API chip

**Before:** per `run-api-panel-and-wires.md` §5, the adapter flow is a full step inside the API contract panel, shown in place of the panel's normal content once "Create adapter" is triggered.

**After (adapter exists, not being edited):**
```
GET /api/orders  [chip]
 ⇄ adapter        ← small chip, under the API chip, click to expand
```
**After (expanded):** same full adapter flow as `run-api-panel-and-wires.md` §5 (field picker, transform, live preview, Save/Cancel), rendered in the focus slot (§5) in place of whatever else was there, same "one thing in the slot" rule.
- The collapsed chip is the **persistent indicator** that an adapter exists on this endpoint — visible even when the focus slot holds something else (a different API's details, or nothing). This is new: today an adapter's existence is only visible while its flow is open.
- Chip label is text ("⇄ adapter"), not icon-only, so its meaning doesn't depend on recognizing the ⇄ glyph.

**Accessibility:** chip is a `<button aria-expanded>` matching §2's pinned-bar pattern (same disclosure convention reused a third time in this doc — canvas the design system, don't invent a fourth disclosure widget). Contrast of the chip's small text/background needs the same `theme.test.mjs` UI-text check as §1's strip.

## 8. Buildability summary (for Ad hoc Dev, cross-referencing LIN-117's order)

| # | New DOM/state? | Reuses | Risk flagged |
|---|---|---|---|
| 1 | Header strip element | `summarize()`, `#progress` live region | Low |
| 2 | Sticky bottom bar + toggle | Existing Ask card markup, `.pal-group`-style disclosure | Low |
| 3 | Field-row-level drop math | `run-api-panel-and-wires.md` §4 compatibility fn, scoped to rows | Low-medium (same function, finer grain) |
| 4 | Missing-rows list + wire anchor change | Existing dashed-wire style, existing gap count line | Medium (canvas anchor calc touches `map.mjs`) |
| 5 | `#focusSlot` mount point | LIN-90's existing drawer content | **Medium-high** — container move, sequence last of the "new chrome" items so drawer internals are stable first |
| 6 | Hover highlight wiring (canvas ↔ list, two-way) | `--acc` highlight treatment | Medium — first two-way (not just click) interaction in the Map |
| 7 | Persistent adapter chip + expand | §2/§5's disclosure pattern, `run-api-panel-and-wires.md` §5 flow | Low (once §5 exists) |

## 9. Open items for Design QA

1. Confirm the header strip (§1) doesn't collide with the existing `#top-actions` button row at narrow viewport widths — no responsive breakpoint spec exists yet for the header; flag if one is needed before this ships.
2. Confirm the `--acc` ring token (reused three times here: §3, §6, and already in `run-api-panel-and-wires.md` §4/§7) still passes 3:1 contrast against both the field-row background and the canvas background in both themes — same token, two new contexts.
3. §6 (two-way highlight) is the one item here without a prior spec to build on (the other six extend `run-api-panel-and-wires.md` or `screen-map.md`); give it the closest read.
