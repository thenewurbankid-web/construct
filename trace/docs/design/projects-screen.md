# Projects screen — generalizing "Drop in"'s scenario picker into a run list

Status: **Design QA: pass with one required fix** ([[LIN-243]], applied — §5's Loading-state justification corrected to match `init()`'s real await order). Ready for Ad hoc Dev buildability input, then owner `request_confirmation`, per [LIN-98](/LIN/issues/LIN-98)'s definition of done.
Part of: [[LIN-85]] (Design the Trace product UI), `docs/design/screen-map.md` §2/§3 (revision 3, Projects row), [[LIN-95]] / `app-shell-nav.md` revision 4 (approved — this screen mounts as the nav's `projects` section).
Base: `trace/src/ui/demo.html` + `demo.mjs` — section id `#s-projects`, reached via the persistent nav's `go("projects")` (app-shell-nav.md §4), replacing today's always-shown `#s-drop` (`demo.html:41-75`).

## 1. What this replaces

Today `#s-drop` (`demo.html:41-75`) is the only thing on screen when the page loads: a hero, a 3-card scenario picker (`paintScenarios`, `demo.mjs:249-265`), a design thumbnail, a contract panel, and a "Wire it" button that immediately starts the one chosen scenario's run. There is no concept of "my runs" — there are three fixed scenarios and whichever one is `app.scenarioId` is implicitly "current."

`screen-map.md` §2's Projects row calls for "a list/grid of runs (past + in-progress), each showing its ring-state summary at a glance," with "New run" as the entry point. This spec generalizes the existing scenario-card grid into that run list, and folds the existing "Drop in" content (design thumbnail + contract panel + Wire it) into the "New run" flow rather than deleting it — nothing here is thrown away, it's reorganized.

| Today | Projects screen |
|---|---|
| 3 scenario cards, always visible, one of which is implicitly "current" | A list of runs: the 3 demo scenarios *plus* any run actually started this session, each a row with a ring summary |
| Picking a card (`pick()`, `demo.mjs:266-273`) sets `app.scenarioId` and repaints thumb/contract in place | Picking a row's primary action opens that run on the Run section (`go("run")`) — the demo's existing single-run-at-a-time model is unchanged; "opening" a row just navigates to where it already is |
| "Wire it" (`#bWire`, `demo.html:71`) starts a run for the selected scenario | "New run" is a distinct entry point (§4) — a wizard, not a card pick — that ends the same way: a call to the existing `startRun()` (`demo.mjs`'s run-start path) |
| Design thumbnail + Contract panel live inline in `#s-drop`, scoped to whichever scenario is picked | Both move into the "New run" wizard body (§4) — they are pre-run-setup content, not run-list content |

## 2. Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ⧉ Trace   ▦ Projects  ▶ Run ⬤3  ◫ Page Map  ⇥ Handoffs ⬤1  ◔ Insights  ⚙ │  ← .top (unchanged, app-shell-nav.md §2)
├───────────────────────────────────────────────────────────────────────────┤
│  Runs                                                    [+ New run]      │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │ ⬤ Portfolio Health            A real page          ■ 8 ▲ 0 ▣ 0 ◆0 □0│  │ ← row: title, tag, ring chips, open
│  ├─────────────────────────────────────────────────────────────────┤     │
│  │ ⬤ Invoices                    Lots of Asks         ■13 ▲ 2 ▣ 0 ◆4 □0│  │
│  ├─────────────────────────────────────────────────────────────────┤     │
│  │ ⬤ Orders                      Fix, then Replay     – not run yet –│  │
│  └─────────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Header row**: "Runs" label (reuses `.label` class, `demo.html:48`'s pattern) left, "New run" button (`.btn.primary`, same visual weight as today's `#bWire`, `demo.css`'s `.btn.primary` class) right.
- **Run list**: one row per scenario (today: 3, fixed by `SCENARIOS`, `scenarios.mjs`). Each row is a clickable block reusing `.scen-card`'s existing visual language (`demo.css:77-89` — border, hover, `aria-checked` accent treatment) but as a list row (`role="listitem"` in a `role="list"`, not `role="radio"` in a `radiogroup` — picking a row *navigates*, it doesn't *select among mutually exclusive options* the way the old picker did; see §3 for why that semantic change is required, not cosmetic).
- **Row content**: title (`.scen-title`, unchanged style) + tag pill (`.tagpill`, unchanged) left; ring-state chip strip (§3) right, reusing `paintLegend`'s existing `.chip`/`.sw` markup (`demo.mjs:591-594`, `demo.css:149-156`) rather than inventing a new summary widget.
- **Content area**: `<main id="main">` unchanged element (app-shell-nav.md §2); `#s-projects` is one more `<section class="screen">` alongside the renamed `#s-fit`/`#s-hand` and the new `#s-pagemap`/`#s-insights`/`#s-settings`.

## 3. Ring-state summary per row

Reuses `paintLegend()`'s exact pattern (`demo.mjs:591-594`): a `.chip` per state (`fit`, `wait`, `gap`, `tie`, `stub`, in that fixed order — `STATES`, `vocab.mjs:33`), each with a `.sw` swatch (shape **and** color per state — dashed outline for Gap, dotted for Stub, split-diagonal for Tie, solid fill for Wait, tinted fill for Fit; `demo.css:151-155` — already satisfies "shape/word besides color," not color alone) and a count. This is the exact component `screen-map.md` §5 asks for reuse of ("the ring stays the spine... never re-skinned per section") — no new visual vocabulary, just the existing legend strip moved onto a row.

- **Data source**: a scenario's last completed run's `stats` object (`run.stats`/`run.final`, shape `{fit, wait, gap, tie, stub}`, produced by `summarize()` and cached per scenario at `app.last[sc.id]` — `demo.mjs:43,756`). This is live state today; no new tracking needed, just reading `app.last[s.id]` instead of only using it for "same result on Replay."
- **Not-yet-run state**: a scenario with no entry in `app.last` (true for all three on a fresh `Reset demo`, `demo.mjs:386-394`) shows plain text "– not run yet –" instead of the chip strip — not five greyed-out zero-chips, which would read as "every part already checked and found empty" rather than "nothing has happened here." Matches `paintScenarios`' own existing `missing`/`st?.present === false` branch (`demo.mjs:251-253`) for "not found on this machine," which already uses a text note instead of fabricating zeroed chips.
- **In-progress run**: if the row's scenario is the one `app.run` currently points at and it hasn't reached `done`/`error`, show a small spinner + "Running…" in place of the chip strip (reuses the existing `.spin` class, `demo.mjs:623-624`) rather than a stale previous-run summary, so the row doesn't look finished while a run is actually live.

## 4. "New run" entry point

**Owner note for Design QA to confirm, not an open design question:** the real backend only has three fixed scenarios (`SCENARIOS`, `scenarios.mjs`) plus the import wizard's Swagger/Subframe/Markers flow for bringing in a new contract+page pair — there is no server-side notion of an arbitrary "new project" beyond that. So "New run" is scoped as: **pick an existing scenario to run again, or walk the import wizard to bring in a different contract/page combination.** This spec does not invent a backend capability that doesn't exist.

"New run" opens a panel (modal or inline expansion — Ad hoc Dev's call, not prescribed) with two entry paths:

1. **Run an existing scenario** — the content `#s-drop` shows today when nothing is wired yet: the design thumbnail (`#thumb`, `demo.html:51-57`, `paintThumb()`, `demo.mjs:289-306`) and contract panel (`#contract`, `demo.html:58-62`, `loadContract()`, `demo.mjs:317-...`) for whichever scenario is picked, ending in the existing "Wire it" button (`#bWire`, unchanged behavior — calls the same run-start path it does today). This is a direct port, not a redesign: same markup, same functions, just reached from "New run" instead of being the page's permanent default content.
2. **Import a different contract/page** — the import wizard's four real steps (`import-wizard.mjs:24`, `STEPS = ["swagger", "endpoint", "subframe", "markers"]`), ported from the standalone `/import-wizard.html` route into this panel. **Correction to this issue's own description:** the issue text says "contract import step + design import step (Subframe, currently stubbed)" as if there are two steps; the actual wizard has four (`stepsHtml`, `import-wizard.mjs:28-31`) — swagger (contract upload, reuses `contract-panel.mjs` unchanged), endpoint (pick which API response is "the list"), subframe (project/page/component picker — **stubbed**, falls back to a labelled fixture because live OAuth 2.1 can't complete headlessly, `import-wizard.mjs:9-12`), and markers (auto-suggest + click-to-mark, built on existing pure modules). All four port as-is; this spec doesn't redesign any of them, only relocates the wizard's existing `installImportWizard()` mount point from its own page into this panel.
3. **Finishing either path** hands off to the existing "Wire it" / run-start call and the person lands on the Run section (`go("run")`) to watch it, exactly like finishing "Drop in" does today.

## 5. States

| State | Behavior |
|---|---|
| Default | Run list shows all three scenarios as rows, each with its ring summary or "not run yet" text (§3) |
| Loading (first paint) | **Correction (Design QA, LIN-243): matches today's existing sequencing, not an immediate paint.** `init()` (`demo.mjs:1044-1063`) awaits `/api/examples` then `refreshStatus()` before calling `paintScenarios()` — today's scenario cards are already gated behind both fetches, there is no earlier unconditional paint. Projects keeps that same order: nothing renders until both resolve, then all three rows paint together with whatever ring-summary/"not run yet"/"not found on this machine" state each scenario already has (§3) — no separate two-stage reveal where rows appear first and the "not found" note arrives later. |
| Empty | Not reachable with the current fixed-scenario backend (§4) — `screen-map.md`'s generic "empty state (no runs yet)" scope bullet is satisfied by the per-row "not run yet" text (§3), not a separate zero-state illustration, since the row list itself is never actually empty (always 3 rows) |
| Error | A scenario marked `missing`/`st?.present === false` (§3) shows its existing alert note (`demo.mjs:253`, reused verbatim) inline in the row instead of a chip strip or "not run yet" text — distinguishing "can't run this" from "haven't run this yet" |
| Row open / in-progress | §3's spinner state |
| "New run" panel open | §4 — the two entry paths; this is a new UI state, not reachable today since "Drop in" has no modal/panel concept, just an always-visible section |

## 6. Accessibility

- **Keyboard path**: nav → header ("Runs" label, "New run" button) → run list (each row a `<button>` or `<a>`, native Tab order, Enter/Space activates) → "New run" panel content when open. No `tabindex` reordering needed — list order in the DOM matches visual/reading order, same reasoning as app-shell-nav.md §9.
- **Focus-visible**: reuses the existing global `:focus-visible` rule (`demo.css:28`, cited in app-shell-nav.md §9) — no new rule for rows or the "New run" button.
- **Semantics**: `role="list"`/`role="listitem"` for the run rows, not `role="radiogroup"`/`role="radio"` (today's `#scen`, `demo.html:49`) — picking a row navigates to the Run section rather than selecting among mutually exclusive options kept on the same screen, so the old radio-group semantics would misdescribe the interaction (a screen reader announcing "1 of 3" implies you're choosing one of three alternatives to stay on, not opening one of three items).
- **Ring summary chips**: inherit `paintLegend`'s existing accessibility properties unchanged — each `.chip` already carries a `title` with the state's full definition (`demo.mjs:594`, `TERMS[k].def`) and shape-plus-color per swatch (§3); nothing new to verify here since this spec reuses the component exactly.
- **Reduced motion**: the in-progress row's `.spin` element and any panel-open transition are covered by `demo.css:414-416`'s existing blanket `prefers-reduced-motion` rule (cited in app-shell-nav.md §1/§9) — no new gating code.
- **Contrast**: no new color pairing — the ring chips reuse `demo-tokens.css` tokens exactly as `paintLegend` already renders them (covered by the existing/planned `demo-tokens.test.mjs`, app-shell-nav.md §8 item 4); the row card border/hover/accent states reuse `.scen-card`'s existing, already-shipped styling (`demo.css:77-89`) unchanged.

## 7. Open items for Ad hoc Dev / Design QA

1. **"New run" panel shape** (§4): modal dialog vs. inline expansion below the "New run" button is left to Ad hoc Dev — doesn't change any content or accessibility requirement above, just the container.
2. **Import wizard relocation** (§4 path 2): confirm the four-step `installImportWizard()` mount (currently only wired on the standalone `/import-wizard.html` page, `import-wizard.html:37-54`) can mount into this panel's DOM node with no changes beyond the mount point — the function already takes a `root` element and an `example` option (`import-wizard.mjs:224`), so this should be a relocation, not a rewrite, but flagging for confirmation since it's never been mounted anywhere but its own page before.
3. **Row click target**: whether the whole row is clickable or only a dedicated "Open" affordance per row is a buildability/density call, not specified here — either satisfies §6's keyboard-path requirement as long as it's a single reachable control per row.
4. **Scenario-row ordering**: today's fixed array order (`SCENARIOS`, `scenarios.mjs:4-26` — portfolio, invoices, orders) is kept as the row order; no sort-by-last-run or sort-by-state is specified, since there's no product requirement cited for it and the fixed backend doesn't support reordering anyway.
