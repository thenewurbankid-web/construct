# Persistent nav — generalizing the demo's step bar into six in-page sections

Status: **approved by the owner 2026-10-03** (revision 4, request_confirmation `app-shell-nav:v4` accepted — authorizes Ad hoc Dev to build). Revision 4 folded in Design QA's one required fix from [LIN-203](/LIN/issues/LIN-203): §4/§6 now call out that the active-item CSS selector is value-scoped to `[aria-current="step"]` and must be widened/updated alongside the `="page"` JS change, or the highlight silently breaks. LIN-203's two citation-line touch-ups are cosmetic and not reproduced here — Ad hoc Dev has the corrected lines on that issue. Revision 3 folded in the owner's 2026-10-01 decisions on revision 2 §8's two open items — account affordance and the contrast test gap. Revision 2 was the owner correction 2026-09-29 — the demo page IS the product UI; the demo IA is corrected 2026-09-29. Supersedes revision 1 below in full: revision 1 spec'd a server-rendered shared partial across six standalone HTML routes (`shell.mjs`, a fixed 220px left `<aside>`, full-page-reload navigation). That shape is wrong per the owner's correction and `screen-map.md` rev 3 — nothing in revision 1 should be built. LIN-103's Design QA pass on revision 1 covered semantics that carry forward (ring/Ask/badge conventions, contrast pattern) but not the shell's shape, which this revision replaces. Buildability input is on record at [LIN-143](/LIN/issues/LIN-143) (revision 2 content, done) and as a comment on [LIN-95](/LIN/issues/LIN-95) dated 2026-10-01 (the account-affordance/test-file additions in revision 3 — no buildability concern on either).
Part of: [[LIN-85]] (Design the Trace product UI), `docs/design/screen-map.md` §2/§3 (revision 3).
Base: `trace/src/ui/demo.html` + `demo.mjs` — **not** `index.html` (Studio). The demo already has a persistent top bar with a 3-item step list (`demo.html:20-36`, `.top`/`.steps`/`.top-actions`), switched client-side with no page reload (`demo.mjs:168-181`, `go()`/`STEP_ORDER`). This spec generalizes that exact mechanism from 3 sequential wizard steps to 6 persistent, independently-reachable sections. It does not port anything from Studio's `#bar` (`index.html:356`) — that's a floating top-right utility strip, a different pattern, and not part of the product page.

## 1. Correction from revision 1

Revision 1 assumed the six screens (`screen-map.md` §1) were six separate HTML documents needing a shared partial glued on top. They are not: the owner's correction and `screen-map.md` rev 3 make all six screens sections of the one page already running at `/` (`demo.html`). That page already has the nav mechanism this spec needs, mid-built for a 3-step wizard:

| Revision 1 assumption | What's actually in the repo |
|---|---|
| No persistent nav exists anywhere; build one from scratch as a shared partial | `demo.html`'s `.top` bar + `.steps` list is a persistent nav today, just scoped to 3 sequential steps instead of 6 independent destinations |
| Navigation is a full page reload; `aria-current` set server-side | `go(screen)` (`demo.mjs:169-181`) already switches sections client-side via `hidden`, no reload, `EventSource`/SSE-safe by construction — exactly the property the owner's correction called for |
| Typography/spacing are ungoverned; this spec introduces the first tokens | `demo.css` already defines spacing/radius custom properties (`--s1`…`--s5`, `--r1`, `--r2`, `--top`, `--keys`) and every existing font-size is a consistent rem scale; `demo-tokens.css` already defines demo's color tokens. `screen-map.md` §1/§3's "not tokenized" note is true of `index.html`/`about.html`/etc., not of `demo.html` — no new typography tokens are needed here |
| Reuse `/theme.css` (`src/tree/svg.mjs` `TOKENS`) for color | `demo.html` never links `/theme.css` — it links `demo-tokens.css`, a separate, smaller color system (`--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--accent`, `--on-accent`, plus `--fit`/`--wait`/`--gap`/`--tie`/`--stub`). This spec reuses `demo-tokens.css`, not `/theme.css` |
| Reuse `index.html`'s `.bd` badge pill and its ungated `.pulse` animation | `demo.html` has no `.bd` equivalent yet (§5 below designs one from demo's own `.badge`/`.ask-n` conventions) and, unlike `index.html`, `demo.css` already blankets **all** animations under `prefers-reduced-motion: reduce` (`demo.css:414-416`) — a new badge pulse here needs no per-element gating code, it inherits the existing global rule |

Net effect: this is a smaller change than revision 1 proposed — generalize an existing 3-item mechanism to 6 items, not invent a new shell.

## 2. Layout

Horizontal top bar, unchanged in structure from today's `.top` grid (`demo.html:20`, `brand | nav | top-actions`), matching `screen-map.md` §2's own horizontal ASCII mock (`Projects → Run → Page Map → Handoffs → Insights → ⚙`) — not the left-column layout revision 1 proposed, which matched neither the real markup nor the screen map's own diagram.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ⧉ Trace   ▦ Projects  ▶ Run ⬤3  ◫ Page Map  ⇥ Handoffs ⬤1  ◔ Insights  ⚙   ☀ 👤│  ← .top (var(--top), sticky)
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│                              (active section's content)                       │
│                                                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Brand** (`demo.html:21`, unchanged): stays the leftmost item, still links to the Projects section (today it reloads `/`; becomes an in-page `go("projects")` call).
- **Nav** (center column of the `.top` grid, was `#steps`): six items, same list markup pattern as today's three (`<ol>`/`<ul>` of `<li><a>`), icon + label each, in the order Projects → Run → Page Map → Handoffs → Insights → Settings/About. No divider needed between Insights and Settings — six items in a single row reads fine at the widths `demo.css` already targets (desktop-first; see §7 on narrow viewport), unlike revision 1's rationale for separating Settings in a left-nav column.
- **Top-actions** (`demo.html:27-35`, unchanged in kind, extended in content): Present toggle, theme toggle, and — new — the Settings/About destination replaces `#bDetails`'s link to `/studio` and folds `#bChangelog`'s standalone "Changelog" link into the Settings/About section rather than keeping it as a seventh top-bar item (`screen-map.md` §2's Settings/About row: "Kept changelog/build info, merged with any account/theme settings"). Build strip / build version / reset stay as-is; account affordance is new (screen-map.md §3 "theme + account right") — **owner decision 2026-10-01: a placeholder slot, not a real account control.** There is no login, session, or user model anywhere in the demo today, and designing a real control here would commit the product to an auth design by side effect. This spec specs the slot and its states (below); the control's actual behavior (what it opens, what it contains) is out of scope.

  | State | Behavior |
  |---|---|
  | Default | A single icon-only affordance, rightmost in top-actions, reusing the existing icon-button visual treatment (`demo.css`'s `.top-actions button` styling — same size/padding/hover as the theme toggle next to it, no new button variant) |
  | Focus-visible | Same global `:focus-visible` rule as every other top-actions control (§9) — no new rule |
  | Activated | Out of scope — no menu/dropdown/route is specified here; Ad hoc Dev should wire it to a visible no-op (e.g. a disabled state or a "coming soon" tooltip) rather than leave it silently inert, so it doesn't read as a bug |
  | Icon | Placeholder glyph, same 24px/1.75-stroke family as the four new nav icons (§8 item 1) — a generic "person"/"account" outline is sufficient; not a design decision worth blocking on |
- **Content**: `<main id="main">`, unchanged element, now hosting six `<section class="screen">` instead of three, only one `hidden`-toggled at a time exactly as today.

## 3. Nav items

| Item | Icon | `data-step` id | Badge | Section id (new/existing) |
|---|---|---|---|---|
| Projects | *(new — no icon yet, see §8)* | `projects` | — | `#s-projects` (new; generalizes today's `#s-drop` scenario-picker into a run list + "New run" entry point per `screen-map.md` §2) |
| Run | `fit` (already used for the ring's Fit state; distinct enough in context — flag for Design QA to confirm no confusion with the ring badge itself) | `run` | Ask count | `#s-fit` (kept, renamed section id when built) |
| Page Map | *(new)* | `pagemap` | — | `#s-pagemap` (new; ports `/pagemap`'s content in, per `screen-map.md` §2) |
| Handoffs | `handoff` (exists in `icons.mjs` already, unused today) | `hand` | Ask count | `#s-hand` (kept) |
| Insights | *(new)* | `insights` | — | `#s-insights` (new; ports `/quality`'s content in) |
| Settings/About | *(new — "gear")* | `settings` | — | `#s-settings` (new; ports `/about`'s content in) |

`data-step` keeps today's attribute name (`demo.mjs:172` reads `li.dataset.step`) rather than renaming it to `data-section` — pure rename churn with no behavior change; not worth a diff that touches every call site for no functional gain.

## 4. Generalizing `go()` and `STEP_ORDER`

Direct extension of the existing function, not a rewrite:

```js
// demo.mjs:168, today
const STEP_ORDER = ["drop", "fit", "hand"];
function go(screen) {
  app.screen = screen;
  for (const s of STEP_ORDER) $(`#s-${s}`).hidden = s !== screen;
  $$("#steps li").forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step), cur = STEP_ORDER.indexOf(screen);
    if (i === cur) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    li.classList.toggle("past", i < cur);
  });
  ...
}
```

Becomes, in shape (exact renames are Ad hoc Dev's call, not prescribed here):

```js
const NAV_ORDER = ["projects", "run", "pagemap", "hand", "insights", "settings"];
function go(section) {
  app.screen = section;
  for (const s of NAV_ORDER) $(`#s-${s}`).hidden = s !== section;
  $$("#steps li").forEach((li) => {
    if (li.dataset.step === section) li.setAttribute("aria-current", "page"); else li.removeAttribute("aria-current");
  });
  ...
}
```

Two things drop out, not just get renamed:
- **`i < cur` / `.past` styling** (`demo.mjs:175`, `.steps li.past .n`, `demo.css:40`) is wizard-specific — "steps already completed." Six independent destinations have no completion order, so `.past` and its "completed step" green-tinted number badge (`demo.css:40`) do not carry forward. Flag as removed, not ported.
- **`aria-current="step"` becomes `aria-current="page"`.** Per the WAI-ARIA spec, `step` means "a step within a process" (true of the 3-item wizard today) and `page` means "an item in a set of pages" — six persistent, independently-reachable nav destinations are the latter, not the former. This is a correctness fix while generalizing, not a cosmetic rename; flag it to Ad hoc Dev explicitly since it's easy to leave as `step` by pattern-matching the old code.
- **Required fix found in Design QA ([LIN-203](/LIN/issues/LIN-203)):** the active-item highlight's CSS selector is value-scoped — `.steps li[aria-current="step"]` (`demo.css:38-39`), not a bare `[aria-current]`. If `go()` starts setting `aria-current="page"` while the selector still only matches `="step"`, the highlight silently disappears (no error, just a dead style rule). Ad hoc Dev must update the selector to `[aria-current="page"]` (or widen it to the bare `[aria-current]` attribute) in the same change that updates the JS value.

`STEP_ORDER`/`NAV_ORDER` naming, and whether `go()` itself is renamed, is left to Ad hoc Dev — not a design decision.

## 5. Ask-count badge

No existing `.bd`-equivalent pill in `demo.css`; closest prior art in the same file is `.pv .badge` (`demo.css:176-177`: pill shape, bordered, `.err`/`.ok` color variants) and the Ask card's own `.ask-n` counter (`demo.mjs:641`, "`n` of `total`"). New `.nav-badge` class, same pill shape as `.pv .badge`, using `--wait` (demo's "needs an answer" amber, per `demo-tokens.css`'s own comment) for its fill rather than a new color:

```html
<li data-step="run">
  <a href="#" data-nav="run"><span class="ico">...</span>Run<span class="nav-badge" aria-label="3 open asks">3</span></a>
</li>
```

- **Shape/label, not color alone** (`screen-map.md` §5): always a visible count, never a bare dot; `aria-label` states what it counts, matching the pattern `screen-map.md` §5 requires for Fit/Wait/Gap/Tie everywhere else in the product.
- **Count source**: Run's badge is the remaining unanswered count in the current run — `run.queue.length` plus one if `run.question` is set (`demo.mjs:435,456`) is the closest existing state to read from; Handoffs' badge is unresolved handoffs in `TEAMS`/`#handGrid` (`demo.mjs:746`). Neither is exposed as a single number today — wiring the count is Ad hoc Dev's call, not specified further here.
- **Absent state**: no badge markup at all when the count is 0 (not a hidden pill) — matches the "no badge concept" vs. "hidden at 0" distinction the demo already draws elsewhere (`$("#bd-...")` patterns in Studio start `hidden`, but Projects/Page Map/Insights/Settings simply never render a `<span class="nav-badge">` at all, since they have no Ask concept).
- **Motion**: if the badge pulses on a new Ask arriving, that animation needs no explicit `prefers-reduced-motion` gate beyond what already exists — `demo.css:414-416`'s blanket rule zeroes every animation/transition duration site-wide the moment the OS preference is set, unlike `index.html`'s ungated `.bd.pulse` (a real gap on that page, out of scope here since this spec doesn't touch `index.html`).

## 6. States

| State | Behavior |
|---|---|
| Default | Nav renders all six items; content shows whichever section `go()` last activated (Projects on first load, replacing today's default-to-`drop`) |
| Active nav item | `aria-current="page"` (§4) — visual treatment carries forward `demo.css:38`'s existing `li[aria-current] { color: var(--text); background: var(--surface-2) }`, no new color needed, but the selector itself must be updated to match `="page"` (currently value-scoped to `="step"` — see §4's required fix) |
| Badge present / absent | §5 |
| Loading (before first `/api/*` response) | Nav item icons/labels render immediately from static markup — no data dependency. Only badge counts are data-dependent: they render absent until the first relevant response lands, same pattern as today's `.bd`-style badges elsewhere in the demo/Studio codebase (start absent, appear once data resolves) |
| Section transition | Client-side `hidden` toggle (§4), no page reload, no dropped `EventSource`/SSE — this is the exact property `screen-map.md` §3 calls the "single biggest gap" fix. No transition animation is required for this pass; if one is added later it's covered by the existing blanket reduced-motion rule (§5) with no extra work |

## 7. Narrow viewport

**Confirmed real regression, not a hypothetical one — flagging for Ad hoc Dev, not resolving here.** Today, `demo.css:408` (`@media (max-width: 1000px) { .steps { display: none; } }`) simply removes the 3-item step nav below 1000px with no replacement, on the reasoning that at that width the wizard's current step is visually obvious from which section is showing. That reasoning gets weaker at 6 independent destinations — a user below 1000px loses the *only* way to reach Page Map, Handoffs, Insights, or Settings/About, not just a "where am I" indicator for a screen they can already see. This spec does not design the narrow-viewport replacement (a collapsed menu/drawer is real follow-up work, matching revision 1's same deferral), but raises the severity from "nice to have" to "a real dead end below 1000px" now that the nav carries navigation, not just wizard status. Whoever builds this should treat closing that gap as part of the same piece of work, not a separate backlog item, since six items disappearing with zero replacement is worse than three.

## 8. Open items for Ad hoc Dev / Design QA

1. **Four new icons needed** (§3): Projects, Page Map, Insights, Settings/About have no glyph in `icons.mjs`'s existing set (`check`, `fit`/`wait`/`gap`/`tie`/`stub`, `handoff`, `ledger`, `plug`, `eye`/`eyeOff`, etc. — 27 keys today, none fit these four). Run and Handoffs can reuse `fit` and `handoff` respectively; the other four need new entries in the same 24px/1.75-stroke family (`icons.mjs:1`). Not designed here — a glyph choice, not a layout decision.
2. **Account affordance** (§2): resolved by owner decision 2026-10-01 — placeholder slot, not a real control. Spec in §2; nothing further needed here.
3. **Ask-count wiring** (§5): the exact state read (`run.queue.length`, `run.question`, the Handoffs/`TEAMS` equivalent) is Ad hoc Dev's call; this spec only fixes the badge's markup/shape/color/motion contract, not its data source.
4. **Contrast test gap, found while writing this spec:** `theme.test.mjs` (`src/tree/theme.test.mjs`) tests `TOKENS` from `src/tree/svg.mjs` — the `/theme.css` system Studio/`index.html` uses. It does **not** cover `demo-tokens.css`, the color file `demo.html` actually links. **Owner decision 2026-10-01: add a sibling test file, `demo-tokens.test.mjs`, rather than widening `theme.test.mjs`.** Same `TEXT=4.5`/`LARGE_OR_UI=3` thresholds and the same pair-checking approach as `theme.test.mjs`, new source (`demo-tokens.css`'s own token set) — conflating two token systems in one test file makes both harder to read. Covers this spec's one new pairing (`.nav-badge`: `--wait` text on `--wait`-tinted background) and the one existing pairing it reuses (`aria-current="page"`'s `--surface-2` on `--bg`, already live at `demo.css:38`, unchanged). File as its own issue if it grows beyond this small addition.
5. **Narrow viewport** (§7): confirmed a live regression at the current 6-item scope, not designed here.

## 9. Accessibility

- **Keyboard path**: `Tab` order is brand → nav items (Projects → Settings/About, list order) → top-actions (Present → theme → account) → screen content. This is already the DOM order in `demo.html` (`.top` markup precedes `<main>`) — no `tabindex` reordering needed, same as revision 1 concluded, still true here.
- **Focus-visible**: no new rule needed — `demo.css:28`'s existing page-wide `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` already applies to any new `<a>`/`<button>` the nav adds, same as every other interactive element in the demo.
- **`aria-current`**: `page`, not `step` — the correctness fix in §4, not a straight port from revision 1 or from `demo.mjs:93`'s current code (both used `step`, correctly for a 3-item wizard, incorrectly if copied unchanged onto six independent destinations).
- **`prefers-reduced-motion`**: no new gating code needed for anything CSS-animation-based (§5, §6) — `demo.css`'s existing blanket rule (`:414-416`) already covers it, unlike the `index.html`/Studio gap revision 1 flagged (that gap is real but lives on a page this spec doesn't touch).
- **Contrast**: see item 4 in §8 — this spec introduces one new visual pairing (`.nav-badge`: `--wait` text on a `--wait`-tinted background, mirroring `demo-tokens.css`'s `--wait` semantics) and reuses one existing pairing (`aria-current="page"`'s `--surface-2` on `--bg`, already used unchanged at `demo.css:38`). Both pairings are covered by the new `demo-tokens.test.mjs` sibling file (owner decision 2026-10-01, §8 item 4).
