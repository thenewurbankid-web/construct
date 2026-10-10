# Page Map section — promoting `/pagemap` into the shell

Status: draft, mocks + spec, ready for Ad hoc Dev buildability input and Design QA review. Part of: [[LIN-85]] (Design the Trace product UI), `screen-map.md` §2 Page Map row, [[LIN-99]]. Base shell (`app-shell-nav.md` rev 4) is owner-approved — this spec assumes it, not revision 1's server-rendered-partial shape, which the issue's own description still cites as a limitation; that limitation no longer applies (see §1).

Base: `src/ui/pagemap.html` + `pagemap.mjs` (served today at `/pagemap`, standalone, reachable only by direct URL from `/`). Per `screen-map.md` §2: "Same structure/review/states-and-flows tabs, same wireframe/source/original-preview split, now mounted inside `/` instead of served as its own HTML document." This is a promotion into the shell, not a redesign of the tool's internals.

## 1. Correction to the issue's own buildability note

LIN-99's description (written before `app-shell-nav.md` rev 4 landed) frames this as limited by "the shell's server-rendered-partial limitation — nav is a full page reload, no client-side state survival yet." That was true of revision 1, which this spec does not use. Revision 4's `go(section)` (app-shell-nav.md §4) switches sections by toggling `hidden` on sibling `<section>`s inside one document — no reload, no DOM teardown. Practical effect: Page Map's in-memory state (`S.data`, `S.ref`, the selected node, scroll position, open tab) **survives navigating away and back**, the opposite of what the issue anticipated. This spec treats that survival as the default behavior, not a gap to design around — simpler than the issue expected, not harder.

## 2. What ports as-is vs. what the shell changes

| Piece | Today (`/pagemap`, standalone) | Inside `/`, as a section |
| --- | --- | --- |
| Three-pane grid (`pm-grid`: left tabs, mid tabs, right panel) | `<main class="pm-grid">`, full viewport height below its own header | Same markup, same CSS classes, unchanged — the grid is self-contained and doesn't assume it owns the whole page |
| Header (`pm-top`: brand, title, picker, changelog link, undo/redo, theme) | Its own `<header>`, page-specific | **Removed as a whole.** Brand, theme toggle and account placeholder move to the shared `.top` bar (`app-shell-nav.md` §2) — duplicating them here would be a second theme toggle and a second brand link on the same page. Page picker, Undo, Redo and the "Changelog" link are section-specific controls with no shell equivalent; see §3 for where they go. |
| Coverage summary + proposals bar (`pm-summary`) | Below the header, above the tabs | Unchanged position, now sits directly below the shared `.top` bar instead of below `pm-top` |
| "How ids and decisions work" `<details>`, warn/msg status lines | Unchanged | Unchanged |
| Tabs (Structure / Review / States & flows; Wireframe / Source / Original preview / Rendered) | Unchanged | Unchanged — these are the tool's own navigation, not the shell's, and nothing here collides with the 6-item nav |
| Apply dialog (`<dialog id="applyDlg">`) | Unchanged | Unchanged |

Net: this is almost entirely a deletion (the standalone header) plus a relocation (picker/undo/redo/changelog-link), not new design work on the tool itself.

## 3. Section header — where the removed controls go

The shared `.top` bar (brand | nav | theme + account) has no slot for per-section controls today — Run and Handoffs don't need one. Page Map needs four: the page picker (`#picker`), Undo, Redo, and a link to `/changelog`.

Add a **section sub-header** row, directly below the shared `.top` bar and above `pm-summary`, present only while the Page Map section is active:

```
┌──────────────────────────────────────────────────────────────────┐
│ ⧉ Trace   ▦ Projects  ▶ Run  ◫ Page Map  ⇥ Handoffs  ◔ Insights ⚙│  ← shared .top (unchanged)
├──────────────────────────────────────────────────────────────────┤
│ Page: [ checkout.html ▾ ]                    Changelog  ↶ Undo ↷ Redo │  ← new .pm-subhead
├──────────────────────────────────────────────────────────────────┤
│ ████████████░░░░ 73% covered · 4 proposals          pm-summary   │
│ ...                                                               │
```

- Left: page picker, unchanged markup/behavior (`<select id="picker">`), now reads "Page:" instead of a visually-hidden label since there's no `<h1>Page map</h1>` anymore to give the control context.
- Right: Changelog link (plain text link, same as today, same target `/changelog` — that page is not yet a section itself, out of scope here), then Undo/Redo (same `pm-btn`/disabled-state behavior as today).
- This row is Page-Map-specific chrome, not a shell primitive — it doesn't generalize to other sections and shouldn't be built as one. Implement as a child of `#s-pagemap`, not the shared nav component.
- `build` (the build-badge span in today's header) is dropped, not relocated: it's redundant with the shared shell's project/run context slot (`app-shell-nav.md` §2, left side of `.top`) once that's wired to real data — tracked as a shell-level concern, not this section's.

## 4. Nav entry and badge

- Nav icon: `◫` placeholder per `app-shell-nav.md` §3/§8 (new icon needed — Page Map isn't `fit`, `handoff`, or any of the 27 existing `icons.mjs` keys; same open item as the other four new sections, not reopened here).
- No count badge. Unlike Run (`queue.length + question`) and Handoffs (unresolved count), Page Map has no per-item queue that maps to a single number a user would act on — "4 proposals" is a `pm-summary` detail, not nav-badge material. If the owner wants a review-needed signal in the nav later, that's new scope, not implied by this promotion.
- Active-item highlight: same `[aria-current="page"]` mechanism as every other item (`app-shell-nav.md` §4), nothing section-specific.

## 5. States

| State | Behavior |
| --- | --- |
| **Default** (page loaded, no node selected) | Three-pane grid populated, right panel shows "Select a node in the structure or the wireframe." — unchanged from today |
| **Loading** | `#covText` shows "Loading..." until `/api/pagemap/pages` and the first `/api/pagemap?...` resolve — unchanged; no shell-level loading state needed since the section mounts instantly (content was already in the DOM, just `hidden`) |
| **Node selected** | Right panel populates, wireframe/source/rendered panes highlight the selected node — unchanged |
| **Section re-entered after navigating away** | New behavior enabled by the shell (§1): state from the last visit (`S.data`, `S.ref`, selected node, active tab, scroll position) is still live in memory — nothing to re-fetch or re-render on return, unlike a full reload. No design work needed here beyond *not* adding a reset-on-mount call that would throw this away. |
| **Error** (API failure) | `#warn`/`#msg` status lines, `role="status"`/`aria-live="polite"` — unchanged |
| **Empty** (no pages discovered) | Not currently designed in the standalone tool either — out of scope here, same as today; flag as a pre-existing gap, not introduced by this promotion |

## 6. Accessibility

- **Keyboard path**: shared nav → shared header (theme/account) → section sub-header (picker → Changelog → Undo → Redo) → `pm-summary` → left tabs/tree → mid tabs/viewer → right panel. This is the existing DOM order inside the `pm-grid` section, with the new sub-header inserted ahead of it — no `tabindex` reordering needed beyond what the shell's own keyboard path (`app-shell-nav.md` §9) already establishes for everything above `pm-summary`.
- **Heading structure**: today's standalone page has a `<h1>Page map</h1>` inside `pm-top`. Removing that header (§3) removes the page's only `<h1>`. The section needs its own heading for the accessibility tree even though it's not shown visually as chrome — add a visually-hidden `<h2>Page Map</h2>` (matching the nav item's label) as the first child of `#s-pagemap`, same pattern every other section should use so the six sections form a sane heading outline inside the one document.
- **Contrast**: no new color tokens introduced by this spec (§3's sub-header reuses existing `pm-btn`/link styles); nothing new to check against `theme.test.mjs` or the `demo-tokens.css` sibling test from `app-shell-nav.md` §8.4.
- **`prefers-reduced-motion`**: no new animation introduced; `demo.css`'s existing blanket rule already covers anything ported in verbatim.

## 7. Open items for Ad hoc Dev / Design QA

1. **CSS scoping.** `pagemap.css` is written for a standalone document (likely assumes `body`/`html` sizing it hasn't needed to share with five other sections). Confirm it can be scoped to `#s-pagemap` without full-page assumptions (`100vh`, fixed positioning relative to viewport rather than the section) leaking into the other five sections' layout. Not verified against the actual CSS in this pass — flagging as the one real risk in an otherwise low-risk port.
2. **`/pagemap` as a standalone URL.** Per `screen-map.md` §2 this becomes a section, not a route — confirm whether the standalone HTML document is retired outright or kept as a redirect to `/` + this section, matching whatever precedent Ad hoc Dev sets for the other four promoted screens (Handoffs, Insights, Settings/About face the identical question).
3. **New nav icon** (shared open item, `app-shell-nav.md` §8.1) — not re-litigated here.
