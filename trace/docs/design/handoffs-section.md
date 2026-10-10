# Handoffs screen — the Handoffs section inside the new persistent nav

Status: Design QA ([[LIN-247]]) failed revision 1 and passed after fixes (2026-10-04) — see §2/§6 corrections below (badge data source, contrast test file, stale line citation). Buildability comment posted on [[LIN-100]]; Ad hoc Dev input still outstanding but non-blocking (§7's two questions are flagged open, not decided here). Part of: [[LIN-85]] (Design the Trace product UI), `screen-map.md` §2 Handoffs row, [[LIN-100]]. Base (`app-shell-nav.md` rev 4) is owner-approved — LIN-95 is done.
Base: `trace/src/ui/demo.html`'s `#s-hand` section (`demo.mjs:818-868`, `toHandoffs()`/`teamCard()`) is the Handoffs screen's foundation — the per-team board (team name, scope, item list with ring-term badges, mail subject preview, "Open in mail app"/"Edit and rewrite with AI" actions) is already built and working today. This spec does not redo that. It covers what step-3-in-a-wizard left out: (1) the section's place inside the approved 6-item nav and its Ask-count badge, (2) turning a per-run, disappear-on-navigate view into a persistent destination with history across runs (the net-new piece named in the issue), (3) states end to end, (4) accessibility notes for the new pieces only.

## 1. What's already built vs. what this spec adds

| Piece | Status | Where |
|---|---|---|
| Per-team board (team name/scope, item list, ring-term badge per item) | **Built** | `demo.mjs:853-864`, `teamCard()` |
| Mail composer (subject preview, "Open in mail app", "Edit and rewrite with AI") | **Built** | `demo.mjs:860-868`, `emailText()`/`openMail()` |
| Fix band (contract-fix prompt + Replay) | **Built** | `demo.mjs:842-844` |
| Empty team state ("Nothing for X. No email needed.") | **Built** | `demo.mjs:856` |
| Nav/header placement under the new 6-item nav, Ask-count badge | **New, this spec §2** | — |
| History list across runs (the issue's one required net-new piece) | **New, this spec §3** | — |
| Per-item ring/state badge reframed as the section's own "ring summary" (screen-map §3) | **Carried forward, reframed in §4** | — |
| End-to-end states | **New, this spec §5** | — |

## 2. Placement under the approved nav

Handoffs is the fourth of six nav items (`app-shell-nav.md` §3), with an Ask-count badge. **Correction (Design QA, LIN-247):** it does not read the Run badge's formula — `run.queue.length`/`run.question` are both already drained by the time `toHandoffs()` renders (`finish()`, `demo.mjs:748-750`, only runs after the queue/question-clearing path in the drain loop), so that formula is structurally always 0 here. Per `app-shell-nav.md` §5 ("Handoffs' badge is unresolved handoffs in `TEAMS`/`#handGrid`," `demo.mjs:746`), the Handoffs badge instead counts unresolved items across `TEAMS`/`#handGrid` for the current run — items not yet mailed or fixed. Once a run is fully handed off (every team's items are either mailed or fixed), its contribution to the badge count drops to zero even though it stays in history (§3). The badge is a live outstanding-work counter, not a lifetime handoff count. Exact wiring (which field marks an item mailed/fixed) is Ad hoc Dev's call, same as `app-shell-nav.md` §5/§133 leaves the Run badge's own wiring.

```
┌─ .top (sticky) ──────────────────────────────────────────────────────────┐
│ ⧉ Trace   ▦ Projects ▶ Run ⬤3 ◫ Map ⇥ Handoffs ⬤1 ◔ Insights ⚙  ☀ 👤     │  ← nav row (app-shell-nav.md)
├────────────────────────────────────────────────────────────────────────────┤
│  History ▸ [Run #214 ▾]                                    + New run      │  ← history strip, ONLY visible when Handoffs is active
├────────────────────────────────────────────────────────────────────────────┤
│  (today's #handHead + #handGrid content, for the selected run)            │
└────────────────────────────────────────────────────────────────────────────┘
```

- Reuses the existing `go()`/`hidden`-toggle mechanism (`app-shell-nav.md` §1) — no new routing, no page reload, SSE-safe.
- `toHandoffs()` (`demo.mjs:819`) still renders `#handHead`/`#handGrid` for *one* run at a time; the history strip (§3) is a new header row above it that picks which run's data populates those same elements. No change to `teamCard()`'s own markup.

## 3. History list (the net-new piece)

Today a run's handoff state lives only in the in-memory `run` object (`demo.mjs:416`'s per-run state shape) and is lost the moment `app.run` is replaced (new run started) or the tab closes — there is no persistence layer today. This spec specs the UI; it does not invent a storage mechanism, per the lane's "design, not build" boundary. Flagging the storage decision for Ad hoc Dev buildability input: either (a) persist completed runs' team/email summaries client-side (`localStorage`, capped list) as a first pass with no server change, or (b) a server-side run log if one already exists for another feature (Insights screen, [[LIN-101]], may need one too — worth checking before building two independent stores).

- **History strip**: a `<select>` or small dropdown, leftmost in the Handoffs section's own sub-header, labelled "History ▸", listing past runs most-recent-first by a short identifier (run id tail, or the scenario name + relative time — e.g. "Checkout flow · 2h ago"). Selecting an entry re-populates `#handHead`/`#handGrid` from that run's stored snapshot instead of the live `app.run`.
- **Current run** is always the first/default entry, labelled distinctly (e.g. "Current" instead of a timestamp) while it's still open (`!run.done`) or just completed.
- **"+ New run"**, rightmost in the same strip, is the entry point back to starting a fresh run — reuses whatever the Projects screen's ([[LIN-98]]) "New run" action already triggers; this spec does not duplicate that flow, only exposes a second doorway to it from Handoffs for the case where someone lands here first.
- **List cap**: no more than ~20 history entries surfaced in the dropdown by default (older ones still exist in storage, just not in this control) — avoids an unbounded UI, consistent with the lane's general small-and-closed-options bias.
- A past run's board renders read-only where its live-only actions don't make sense: "Open in mail app"/"Edit and rewrite with AI" stay available (mailing an old run's email is still a valid action), but the fix band (§1 row 3, "Backend team ships the fix" / Replay) only appears for the current run — replaying a stale historical run against today's contract is out of scope for this spec and should not be implied as available.

## 4. Ring summary carried forward

`screen-map.md` §3: "the ring appears as a per-item badge here, consistent with Run/Projects." Today's `teamCard()` already renders exactly this — each item's row shows its term icon (`demo.mjs:863`, `<span class="${term}">`, one of Fit/Wait/Gap/Tie/Stub) and, where the inspector has classified it, `badgeHtml()`'s fuller state badge (`issues.mjs`, imported `demo.mjs:11`). No change needed to carry this forward; this section just confirms the existing per-item badge *is* the "ring as per-item badge" convention the screen map asks for, so Design QA doesn't flag it as missing.

## 5. States

| State | Behavior |
|---|---|
| Default (current run, open items) | Today's `toHandoffs()` render, unchanged, under the new nav/history header |
| All fit, no handoffs needed | Today's "All N parts fit" header path (`demo.mjs:836`) — history strip still shows, "+ New run" still available |
| Loading (history list, before stored runs resolve) | History `<select>` shows a single disabled "Loading history…" option; current run's board still renders immediately since it's already in memory — history is additive, never blocks the live view |
| Empty history (first run ever, or storage cleared) | History control shows only "Current" — no error state, this is a normal/expected first-use case |
| Error (stored run snapshot missing or corrupt) | That history entry shows as unselectable with a tooltip ("No longer available") rather than disappearing silently — consistent with the lane's general not-color-only, not-silent-failure bias |
| Historical run selected | Read-only board per §3's last bullet; a small inline label ("Viewing: Checkout flow · 2h ago") replaces the live run's sub-header text so it's never ambiguous which run is on screen |
| Ask-count badge present/absent | Nav badge shows a number when `>0` outstanding across the *current* run only (§2); absent (no pill) at zero — shape/number, not color-only, consistent with `app-shell-nav.md` §5's badge convention |

## 6. Accessibility

- Keyboard path: nav → history strip (`<select>` or button-group, native tab stop) → team board → mail/edit actions, in that order, matching `app-shell-nav.md` §9's nav→header→content path generalized one level deeper for this section's own sub-header.
- `focus-visible` on the history control and "+ New run" button reuses the existing global `:focus-visible` rule (`app-shell-nav.md` §9) — no new rule needed.
- Historical-run read-only state is conveyed by the inline "Viewing: …" text label (§5), not by graying out controls alone — a screen reader gets the same information a sighted user gets from the label.
- Section-transition and any history-switch animation follow `demo.css:442-444`'s existing blanket `prefers-reduced-motion: reduce` rule — no per-element gating code needed, same inheritance `app-shell-nav.md` §1 row 5 already established for this file (that doc's own citation of this rule is also stale at :414-416, worth correcting there too).
- Contrast: the "Current" vs. timestamped history-entry labels and the disabled/unselectable error entry must each hit 3:1 against their surface. **Correction (Design QA, LIN-247):** `demo.html`/`demo.mjs` link `demo-tokens.css`, checked by the sibling `demo-tokens.test.mjs` — not `theme.test.mjs`, which tests the separate `/theme.css` system Studio/`index.html` use (`app-shell-nav.md` §8 item 4 made this same call for that spec's own chrome). Flag these two label pairings for `demo-tokens.test.mjs`. Note for whoever builds this: that file today only checks the five state colours (fit/wait/gap/tie/stub) against bg/surface/surface-2 as a flat 3:1 check — it doesn't yet have a general `--text`/`--muted`-on-surface pairing, so if these labels use `--text`/`--muted` rather than a state colour, this is a new coverage case to add, not an extension of an existing split.

## 7. Open questions for Ad hoc Dev buildability

1. Persistence mechanism for history (§3): client-side `localStorage` cap vs. a server-side run log — and whether Insights ([[LIN-101]]) already needs the latter, to avoid building two stores.
2. Whether "+ New run" should warn if the current run has unresolved Asks, or just navigate — no strong product opinion here, flagging rather than deciding.
