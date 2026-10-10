# Run screen — the Run section inside the new persistent nav

Status: Design QA pass-with-fixes ([[LIN-242]], 2026-10-04) — both fixes applied (§3's disclosure-instance self-contradiction removed; §6 item 4's `demo-tokens.test.mjs` pointer corrected to that file's actual ad hoc `test()`/`ratio()` idiom, not a nonexistent `SEMANTIC`/`LARGE_OR_UI` table). Ready for owner `request_confirmation`, carrying the §4 Options-menu recommendation (QA-passed as a reasonable reading of `screen-map.md`'s open item, still needs an explicit owner call) and the follow-up note that `app-shell-nav.md` §8.4 has the same test-file inaccuracy, uncorrected there (out of this spec's scope). Ad hoc Dev buildability input (requested on [[LIN-97]] 2026-10-04) may still land async and does not block the confirmation. Part of: [[LIN-85]] (Design the Trace product UI), `screen-map.md` §2 Run row, [[LIN-97]]. Base (`app-shell-nav.md` rev 4) is owner-approved.
Base: `trace/src/ui/demo.html`'s `#s-fit` section (`demo.mjs`) is the Run screen's foundation; it already carries most of the content this spec needs (ring→strip, Ask, contract rail, field rows, gap rows, focus slot, two-way highlight, adapter chip — all shipped via [[LIN-117]], spec'd in `panel-layout-focus-slot.md`, built; and `run-api-panel-and-wires.md`, the API contract panel + drag-to-attach, also built). This spec does **not** redo that work. It covers what those two specs left open: (1) the Run section's place inside the now-approved 6-item nav (`app-shell-nav.md` rev 4), (2) the open product decision on Studio's Options menu (`useSaved`/`askAll`/auto-run), (3) the "Advanced" drawer that folds in Studio's console/AI-exchange/run-summary panels, (4) the states this section needs end to end, and (5) accessibility notes for the net-new pieces only.

## 1. What's already built vs. what this spec adds

| Piece | Status | Where |
|---|---|---|
| Header strip (ring → text summary) | **Built** (LIN-117) | `demo.mjs:592-713`, `panel-layout-focus-slot.md` §1 |
| Ask card → pinned collapse bar | **Built** (LIN-117) | `demo.mjs:634-659`, `panel-layout-focus-slot.md` §2 |
| Field-row drop targets, gap rows | **Built** (LIN-117) | `panel-layout-focus-slot.md` §3-4 |
| Focus slot (one detail view at a time) | **Built** (LIN-117) | `panel-layout-focus-slot.md` §5 |
| Two-way highlight, adapter chip | **Built** (LIN-117) | `panel-layout-focus-slot.md` §6-7 |
| API contract panel, drag-to-attach | **Built** (LIN-89/90) | `run-api-panel-and-wires.md` |
| Tree/page view toggle | **Built, pre-existing** | `canvas/trace.mjs:662-678,781`; invoked `demo.mjs:1014` |
| Nav/header placement under the new 6-item nav | **New, this spec §2** | — |
| Advanced drawer (console, AI-exchange, run-summary) | **New, this spec §3** | — |
| Options-menu product decision (useSaved/askAll/auto-run) | **New, this spec §4 (decision needed)** | — |
| End-to-end states (empty/loading/error/waiting) | **New, this spec §5** | — |

## 2. Placement under the approved nav

`app-shell-nav.md` rev 4 puts Run as the second of six nav items, with an Ask-count badge (`§3` of that spec: nav item shows `run.queue.length + (run.question ? 1 : 0)`). The Run *section*'s own header strip (`panel-layout-focus-slot.md` §1: `{mark} Trace   8/29 fit · 3 waiting · 2 gaps   build 214`, docked in `<header class="top">`) sits in the same top bar row as the nav, not duplicated:

```
┌─ .top (sticky) ──────────────────────────────────────────────────────────┐
│ ⧉ Trace   ▦ Projects ▶ Run ⬤3 ◫ Map ⇥ Handoffs ⬤1 ◔ Insights ⚙  ☀ 👤     │  ← nav row (app-shell-nav.md)
├────────────────────────────────────────────────────────────────────────────┤
│ 8/29 fit · 3 waiting · 2 gaps                               build 214     │  ← strip, ONLY visible when Run is the active section
├────────────────────────────────────────────────────────────────────────────┤
│  (Run section content: focus slot, canvas, left parts column)             │
└──────────────────────────────────────────────────────────────────────────┘
```

- The strip is Run-section-scoped, not global chrome: it renders only while `go("fit")`/`go("run")` is the active section (reusing the existing `hidden`-toggle mechanism `app-shell-nav.md` §1 describes), the same way Studio's ring was scoped to its own page. No duplicate ring/strip appears on other sections.
- The nav's Run badge count and the strip's "3 waiting" clause read the same underlying state (`run.queue.length`/`run.question`) so they can never disagree — one source, two renderings, not two counters to keep in sync by hand.
- No layout change to the strip itself from `panel-layout-focus-slot.md` §1 — it already docks in `<header class="top">`, which is exactly where the new nav also lives; this section only confirms the two share that row without collision, same owner bullet §3 flags ("project/run context left, theme + account right" — the strip is the "run context" piece of that bullet).

## 3. The Advanced drawer

**Before:** Studio (`index.html`) has three extra panels with no equivalent in the demo's Run section today: the console/AI-exchange log (`index.html:419-425`, `:521-574`), the run-summary popup (`index.html:427-428`, `:984-1034`, a fixed 88vw×86vh modal with Overview/Team actions/Open items/Code changes tabs), and the Options menu (`index.html:364-378`, resolved separately in §4 below since it's a decision, not a port).

**After:** one collapsible "Advanced" drawer at the bottom of the Run section (below the left parts column / focus slot / canvas, full width), closed by default:

```
┌─ Run section ──────────────────────────────────────────────────────────┐
│  [left: parts list]   [center: canvas]   [right: focus slot + Ask bar] │
├──────────────────────────────────────────────────────────────────────────┤
│  ▸ Advanced                                                             │  ← closed (default)
└──────────────────────────────────────────────────────────────────────────┘
```

Expanded:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ▾ Advanced                                                              │
│  ┌─ tabs: Console · Summary ──────────────────────────────────────────┐ │
│  │  (selected tab's panel content, same content as today's Studio    │ │
│  │   panels — console log list / run-summary tabs — ported verbatim) │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Why one drawer with tabs, not two separate drawers:** both are power-user, after-the-fact review tools (what happened during the run / how did it turn out), neither is part of the primary resolve-a-Tie loop the rest of the section serves — bundling them under one disclosure matches `screen-map.md` §3's progressive-disclosure direction ("reduce the nav from top-level pages to fewer, plus in-section depth") better than adding two more disclosure widgets to a section that already has three (pinned Ask bar, focus slot, adapter chip — `panel-layout-focus-slot.md` §2/5/7).
- **Reuse, not rebuild:** the drawer reuses the same disclosure pattern `panel-layout-focus-slot.md` §2/§7 already established (`<button aria-expanded>` toggling visibility) — no new disclosure widget. Tab content is Studio's existing console (`index.html:521-574`, `paintConsole`) and run-summary (`index.html:990-1034`, `paintChanges`/`paintOverview`) logic, ported to render inside the drawer's tab body instead of a docked panel / fixed modal. The modal's own chrome (fixed positioning, resize handles, `#chgTitle`) is dropped — the drawer already provides the "out of the way until opened" property the modal was doing with `position:fixed`, so the modal mechanics don't need to come along.
- **Default state:** closed on every run, not sticky across runs/sessions — matches the Ask pinned bar's existing "doesn't render an empty state" philosophy applied to "doesn't stay open past its usefulness."
- **Accessibility:** `<button aria-expanded="false">Advanced</button>` disclosure, same pattern as `panel-layout-focus-slot.md` §2/§7 — keep reusing this one disclosure convention, don't add a new widget. Tabs inside use standard tab-role keyboard nav (arrow keys between tabs, the way `index.html:997-998`'s existing rail tabs already behave — port that behavior, don't redesign it). `prefers-reduced-motion`: expand/collapse is a height snap, same as `panel-layout-focus-slot.md` §2's gating (alongside `demo.mjs:24`'s `reduced()` helper and the existing gates it feeds, e.g. `demo.mjs:478,564,762,927-930`).

## 4. Open product decision: Options menu carryover

Studio's Options menu (`index.html:364-378`) exposes three controls the demo's `/api/run` call (`demo.mjs:456`) doesn't: `useSaved` (checkbox, demo hardcodes `true`), `askAll` (checkbox, demo never asks about every part), and "Auto-run every example" (button, no demo equivalent).

**Design recommendation (not yet an owner decision — flagging for request_confirmation alongside this spec):** carry `useSaved` and `askAll` forward into the Advanced drawer as a third tab ("Run options"), off by default exactly as Studio defaults them; drop "Auto-run every example" entirely. Reasoning:
- `useSaved`/`askAll` change what a *single* run does and are the kind of power-user control the Advanced drawer exists for (§3) — they belong with Console/Summary, not as permanent top-level controls cluttering the primary Run section.
- "Auto-run every example" operates on a *set* of examples, not the current run — that's a Projects-section concern (the "list/grid of runs" `screen-map.md` §2 describes), not something to carry into the per-run Advanced drawer. Dropping it here isn't dropping the capability; it's relocating it to where the product's IA already puts bulk-run operations, out of this spec's scope.
- This keeps the drawer's three tabs (Console / Summary / Run options) all "things you'd open before or after the primary loop," none of them "things you need mid-resolve," consistent with why they're tucked behind one disclosure at all.

Until the owner confirms, Ad hoc Dev should treat this as the working assumption but not build the "Auto-run every example" removal as irreversible — it's a decision this spec is making a recommendation on, not one `screen-map.md` had already settled (that doc explicitly left it open, §2 Run row).

## 5. States

| State | What's shown |
|---|---|
| **Empty** (no run started yet) | Header strip absent (nothing to summarize yet — matches §2's "strip only renders while active" plus "no run" sub-case). Focus slot empty (`panel-layout-focus-slot.md` §5's existing empty state). Canvas shows the pre-run contract/design drop targets (today's `#s-fit` empty-canvas state, unchanged). Advanced drawer not rendered at all — nothing to show until a run exists. |
| **Loading** (run started, no events yet) | Header strip renders with all-zero counts (`0/N fit`) rather than being absent, since a run now exists — this is the one point where the strip's "only while active" rule (§2) and "no empty state" rule (§3) could conflict; resolving it as: strip appears the moment a run starts, Advanced drawer stays hidden until the run produces its first console/summary content worth showing (avoids an empty "Advanced" toggle that opens to nothing). |
| **Error** (run fails, e.g. contract fetch failure per `demo.mjs:50-67`'s `contractFor`) | Reuses the existing error-surfacing path in the run queue (`demo.mjs:469-476`'s `enqueue`/drain loop already handles non-happy-path events) — no new error chrome invented here; this spec's only addition is that the Advanced drawer's Console tab is where the underlying error detail is visible for debugging, same as Studio's console already surfaces AI/run errors today (`index.html:826`, `type === "ai-log"` handling generalizes to error events). |
| **Waiting for you** (an unresolved Ask) | Fully specified already — `panel-layout-focus-slot.md` §2 (pinned bar) and §1 (strip's "waiting" clause) are the canonical spec for this state; this spec adds nothing new here, only confirms it's unaffected by nav placement (§2) or the drawer (§3), since both are physically below/separate from the Ask bar's sticky position inside `#side`. |

## 6. Accessibility notes (net-new pieces only)

Everything from `panel-layout-focus-slot.md` and `run-api-panel-and-wires.md` already carries its own accessibility notes and is unchanged by this spec. Net-new here:

1. Advanced drawer disclosure and its internal tabs need the same keyboard path as the rest of the section: `Tab` reaches the `▸ Advanced` button before the (currently invisible) tab content, `Enter`/`Space` expands it, then `Tab` enters the tab list, matching `app-shell-nav.md` §9's overall shell keyboard-path requirement (nav → header → content) extended one level deeper (content → drawer → drawer content).
2. Focus-visible styling on the drawer toggle and its tabs reuses the existing global `:focus-visible` rule (`app-shell-nav.md` §2's account-placeholder bullet already established this as the no-new-rule default for shell-adjacent controls) — no new rule needed.
3. The header strip/nav Ask-count badge dual-read in §2 ("one source, two renderings") must stay numerically identical at all times for a screen-reader user who might encounter either one first — if `run.queue.length + (run.question ? 1 : 0)` is wrong in either render, that's a correctness bug, not an accessibility nuance, but it is specifically an accessibility risk because a screen-reader user navigating by landmark may only ever land on one of the two and has no way to cross-check against the other visually.
4. Advanced drawer tab contrast (new text on new chrome) belongs in `src/ui/demo-tokens.test.mjs` — the right sibling file for `demo-tokens.css`-governed chrome (don't start a third contrast-check file), confirmed by direct read (Design QA, [[LIN-242]]). Correction to `app-shell-nav.md` §8.4's framing: that file has no `SEMANTIC`/`TEXT=4.5`/`LARGE_OR_UI=3` table to add a row to — that naming/pattern exists only in `src/tree/theme.test.mjs`, the different `/theme.css` token system. `demo-tokens.test.mjs` instead has two hardcoded `test()` blocks checking a states × surfaces matrix at a flat 3:1. Whoever adds the drawer-tab check should add a new ad hoc `test()` in that file's own idiom (a new pair + `ratio()` call), not "a row" in a table that doesn't exist there. (`app-shell-nav.md` §8.4 itself should get the same correction, out of this spec's scope.)

## 7. Open items for Design QA

1. Confirm §4's recommendation (carry `useSaved`/`askAll`, drop "Auto-run every example") is a reasonable reading of `screen-map.md`'s open item, or flag a different resolution before this goes to the owner.
2. Confirm §5's Loading-state resolution (strip appears immediately, drawer waits for first content) doesn't contradict either source spec's own empty-state rule — this is the one place this spec had to arbitrate between two existing rules rather than just porting one.
3. Confirm the Advanced drawer's tab port (Console/Summary/Run options) doesn't miss an accessibility requirement specific to Studio's current modal/docked versions that doesn't carry over cleanly into drawer-tab form (e.g. the run-summary modal's resize handles have no drawer equivalent — confirm that's an acceptable drop, not an oversight).
