# Settings/About section — promoting `/about` into the shell, merged with the theme toggle

Status: Design QA passed ([[LIN-241]], pass with required citation fixes — now applied below), owner approval requested. Part of: [[LIN-85]] (Design the Trace product UI), `screen-map.md` §2 Settings/About row, [[LIN-102]]. Base (`app-shell-nav.md` rev 4) is owner-approved.

Base: `trace/src/ui/about.html` + `about.mjs` (served today at `/about`, standalone, reachable from `/quality`, `/studio`, and `/changelog`). Per `screen-map.md` §2: "Kept changelog/build info, merged with any account/theme settings." The theme toggle already exists and works today — it lives in `demo.html`'s shared top bar (`demo.html:29`, `paintTheme`/`toggleTheme`, `demo.mjs:166-179`), not on `/about` itself. This spec's "merge" is making that existing control visible/documented from inside the Settings/About section, not building a second one.

## 1. What ports as-is vs. what this spec changes

| Piece | Today (`/about`, standalone) | Inside `/`, as the Settings/About section |
| --- | --- | --- |
| Rendering functions (`renderBuild`, `renderWhatsNew`, `renderReleases`, `renderChanges`, `renderHistory`, `renderPage`) | Pure, payload-in/HTML-out, unit-tested (`about.mjs:51-119`) | **Unchanged.** No rendering logic changes in this spec. |
| Data fetch + live ticker (`mountAbout`, `about.mjs:152-174`: fetches `/api/about` once, then a 30s `setInterval` to tick "x ago"/uptime text without a refetch) | Fetches once on mount; ticker keeps relative-time strings moving | **Unchanged mechanism.** See §4 for what changes about ticker lifecycle once the section can be hidden/shown without unmounting. |
| Changelog search (`#q` input, `renderWhatsNew`/`filterReleases`, `about.mjs:27-38,91-94`) | Live filter over releases, re-renders only `#rels` to preserve open/closed `<details>` state | **Unchanged** — same input, same partial-redraw approach. |
| Screenshot zoom (`installShotZoom`, `about.mjs:131-149`) | Click-to-enlarge figure overlay, installed once per mount | **Unchanged.** Idempotent via `root.__shotZoomInstalled` — safe to call again if the section remounts. |
| `<header class="top">` (`about.html:58-65`): "About Trace" `<h1>`, build-badge span, links to Changelog/Quality/"Back to the studio" | Its own standalone header | **Removed as a whole**, same reasoning as `pagemap-section.md` §3 / `insights-section.md` §3 — brand, theme and account already live in the shared `.top` bar. The build badge, Changelog link, and cross-page links each have a specific disposition — see §3. |
| `<footer>` doc links (README/DEPLOY-LOCAL/SECURITY/CHANGELOG raw files, `about.html:67-73`) | Below `#app`, standalone | **Kept, repositioned** — see §3; these are reference links with no shell equivalent, unlike the header's links. |
| Theme toggle | Lives in `demo.html`'s shared top bar only (`demo.html:29`); `/about` has no theme control of its own today | **New in this spec**: a visible, labeled theme control inside the Settings/About section body, in addition to (not replacing) the top-bar icon toggle — see §2. |

Net: like Insights, this is mostly a verbatim port. The two pieces of real design work are (1) where the theme toggle gets a second, more discoverable home (§2) and (2) confirming there is no account system to merge in, despite the issue's "merged with any account/theme settings" framing inviting that assumption (§2).

## 2. Theme toggle — what merges in, and what explicitly does not

**What exists today:** one icon-only button, `#bTheme` (`demo.html:29`), in `demo.html`'s shared top bar. `toggleTheme()` (`demo.mjs:174-179`) flips `document.documentElement.dataset.theme` between `"light"`/`"dark"`, persists to `localStorage` under the key `trace-theme`, and `paintTheme()` (`demo.mjs:167-172`) swaps the button's icon (`sun`/`moon`, `icons.mjs:10-11`) and `aria-label` to describe the *next* state. The two themes it switches between are governed by `demo-tokens.css` (`:root` for light, `:root[data-theme="dark"]` and the `@media (prefers-color-scheme: dark)` block for dark) and contrast-checked by `demo-tokens.test.mjs` — **confirmed by reading both test files**: `theme.test.mjs` (`src/tree/theme.test.mjs`) tests `TOKENS`/`THEME_CSS` from `src/tree/svg.mjs`, the separate `/theme.css` system Studio/`index.html` use; `demo-tokens.test.mjs` (`src/ui/demo-tokens.test.mjs`) reads `demo-tokens.css` directly and is the one that actually governs `demo.html`'s (and therefore this section's) two themes.

**What this spec adds:** a second, explicit theme control inside the Settings/About section body — a labeled two-option toggle (`Light` / `Dark`), not a repeat of the icon-only button, so a reader who lands on Settings looking for "where do I change the theme" finds a self-explanatory control rather than having to already know the top-bar icon exists. Both controls read and write the same state (`document.documentElement.dataset.theme` + `localStorage["trace-theme"]`) — picking "Dark" here updates the top-bar icon too, and vice versa, the same two-way relationship `app-shell-nav.md` §9 already describes for shared chrome.

```
┌──────────────────────────────────────────────────────┐
│ Appearance                                            │
│  Theme    ( Light )  ( Dark )  ← .seg, aria-pressed   │
└──────────────────────────────────────────────────────┘
```

- New section, "Appearance," placed first in the Settings/About body — ahead of Build, per the design ideology's "stakeholders read the UI too": a theme choice is the one setting here a non-engineer reader is likely to want, and it costs nothing to put it before build/changelog detail aimed at a more technical reader.
- Markup: two `<button role="radio" aria-checked>`-or-equivalent segmented control (exact element left to Ad hoc Dev — a `<fieldset>`/radio pair is equally valid), **not** a bare checkbox, since "light vs. dark" is a mutually-exclusive pick between two named options, not an on/off toggle — matches the semantic reasoning `projects-screen.md` §6 uses for why its run rows are `role="list"` and not `role="radiogroup"` (the same scrutiny, opposite conclusion: this genuinely is a two-option exclusive choice).
- No new color tokens — reuses the same `.btn`/`.seg`-style treatment already in `demo.css` for other two-state controls (exact class is Ad hoc Dev's call; not a new visual language).

**What explicitly does not merge in: account settings.** The issue's framing ("merged with any account/theme settings") and `screen-map.md` §2's Settings/About row ("merged with any account/theme settings") both use "any," which could be read as inviting an account section here. **There is no account, login, or session model anywhere in the demo today** — confirmed by reading `demo.mjs`/`about.mjs`/`server.mjs`: the only related surface is `app-shell-nav.md` §2's "account affordance," itself explicitly scoped by the owner's 2026-10-01 decision as **"a placeholder slot, not a real account control... There is no login, session, or user model anywhere in the demo today, and designing a real control here would commit the product to an auth design by side effect."** That decision governs this section too: **account/login is out of scope for Settings/About, the same way it's out of scope for the top-bar slot.** This spec does not invent an account section, a "sign out" row, or a profile field. If an account system is added later, it gets its own design pass against real requirements, not a row backed into this port.

## 3. Section header, build badge, and the footer's doc links

Like Insights (`insights-section.md` §3), the standalone `<header class="top">` (`about.html:58-65`) is removed in full — brand, theme (icon form) and account already live in the shared `.top` bar.

| Piece | Disposition |
| --- | --- |
| `<h1>About Trace</h1>` (`about.html:60`) | Removed as visual chrome; replaced by a visually-hidden `<h2>` for the accessibility tree (§6), same pattern as Page Map/Insights. |
| Build badge (`#build`, `mountBuildBadge`, `about.html:61,78`) | **Kept, relocated** — not dropped. The shared top bar already has a build-strip/build-version slot (`#buildStrip`/`#bBuild`, `demo.html:32-33`, kept per `app-shell-nav.md` §2), but that slot shows *a* build indicator globally, not the richer badge `mountBuildBadge` renders with `{ href: "/about" }` (`about.html:78`). This spec keeps a `mountBuildBadge` instance inside the Settings/About section body too, re-pointed at `go("settings")` instead of `href: "/about"` (an in-page nav call instead of a link, matching `app-shell-nav.md` §4's `go(section)` convention) — two indicators, same convention Page Map uses for Undo/Redo being section-local even though global chrome exists (`pagemap-section.md` §3's reasoning: "Page-Map-specific chrome, not a shell primitive"). |
| `/changelog` link (`about.html:62`) | Already reachable from the shared top bar's `#bChangelog` (`demo.html:31`) — **dropped** as a duplicate, same reasoning as `insights-section.md` §3. The "What's new" body content (`renderWhatsNew`, unchanged) already shows changelog entries inline, so nothing is lost. |
| `/quality` link (`about.html:63`) | Becomes the Insights nav item — **dropped**, redundant once it's a nav click away. |
| "Back to the studio" (`about.html:64`) | `/studio` is retired per `screen-map.md` §2 — **dropped**, no replacement, same as `insights-section.md` §3's identical row. |
| Footer doc links (README/DEPLOY-LOCAL/SECURITY/CHANGELOG raw `.md` files, `about.html:67-73`) | **Kept, repositioned** as the last block inside `#s-settings`, after the "Deploy history" section — these are reference links to repo docs with no shell or nav equivalent, unlike the header's links, which all pointed at other now-sectioned destinations. |

## 4. States

| State | Behavior |
| --- | --- |
| **Loading** (before `/api/about` resolves) | `#app`'s placeholder `<p class="empty">Loading…</p>` (`about.html:66`) — unchanged markup. Same "only seen once per page load" behavior as `insights-section.md` §4 describes for Insights: the shell keeps the section mounted after first visit, so re-entering after a successful fetch shows cached data immediately. |
| **Error** (fetch throws) | "Could not load /api/about. Is the server running?" (`about.mjs:164`) — unchanged, same local-dev-appropriate reasoning as `insights-section.md` §4. |
| **Empty changelog** (`changelog.releases.length === 0`, `about.mjs:92`) | "No CHANGELOG.md entries yet." — unchanged; already a designed empty state in the source, nothing to add. |
| **Search, no matches** (`filterReleases` returns nothing, `about.mjs:88`) | `Nothing matches "<query>".` — unchanged; already designed. |
| **Deploy history, no deployed builds** (`data.history.length === 0`, `about.mjs:107`) | "No deployed builds recorded. Run `npm run deploy:local`." — unchanged. **Flagging, not changing** (same reasoning as `insights-section.md` §4's no-data-yet state): this is CLI-operator instruction text inside what's now a product-facing settings area; listed as an open item in §7 rather than silently rewritten, since deciding who else should be able to trigger a deploy is a product call, not a labeling one. |
| **Changes-since-previous, dev build** (`about.mjs:98`) | "Only available for deployed builds." — unchanged; already designed for the no-comparison case. |
| **Theme control, default** | Reflects current `document.documentElement.dataset.theme` (or system preference if unset, same fallback `paintTheme`/`toggleTheme` already use, `demo.mjs:167-168,175`) — whichever option matches is the pressed/checked one. |
| **Theme control, after toggling in either location** | Both the section's control and the top-bar icon update together (§2) — there is one source of truth (`dataset.theme` + `localStorage`), not two independent toggles that could disagree. |
| **Section re-entered after navigating away** | Same shell-provided state survival as Insights/Page Map — the live ticker (`setInterval`, `about.mjs:172`) and open/closed `<details>` state (search, release disclosure) are untouched by switching sections away and back, since the section is hidden via `hidden`, not unmounted. One thing to confirm, not resolved here: whether the `setInterval` from `mountAbout` should be cleared while the section is `hidden` (wasted ticks updating text nobody can see) or left running (cheaper to reason about, matches today's always-visible-page behavior) — flagged in §7, not a correctness issue either way since `about.mjs:173` already exposes a `stop()` the shell *could* call on hide if Ad hoc Dev wants the optimization. |

## 5. Nav entry and badge

- Nav icon: gear glyph, per `app-shell-nav.md` §3 ("Settings/About | *(new — "gear")*") — already named as the intended glyph in the nav spec, not reopened here; still a new `icons.mjs` entry (shared open item, `app-shell-nav.md` §8.1).
- No count badge. Settings/About has no queue concept at all — matches the identical reasoning in `pagemap-section.md` §4 and `insights-section.md` §5.
- Active-item highlight: same `[aria-current="page"]` mechanism as every other item (`app-shell-nav.md` §4).

## 6. Accessibility

- **Keyboard path**: shared nav → shared header (theme icon/account) → section content, top to bottom: Appearance (theme segmented control) → Build → What's new (search input → release disclosures) → Changes in this build → Deploy history (table) → footer doc links. Native tab order, no `tabindex` reordering — same reasoning as every other section spec in this set.
- **Heading structure**: removing the standalone `<h1>About Trace</h1>` (`about.html:60`) removes the page's only top-level heading, same gap `pagemap-section.md` §6 and `insights-section.md` §6 already flag for their sections. Add a visually-hidden `<h2>Settings/About</h2>` as the first child of `#s-settings`. The existing `<h2>`s inside each card (`renderBuild`/`renderWhatsNew`/`renderChanges`/`renderHistory`, each already real `<h2>`s with `id`s referenced by `aria-labelledby`, `about.mjs:65,93,98,107` and `renderPage`'s wrapping `<section aria-labelledby="...">`) become `<h3>`s, same heading-level bump as Insights, plus one new `<h2>Appearance</h2>` (or `<h3>`, consistent with the others) for the new theme control block (§2).
- **Theme control semantics**: two-option exclusive choice, `aria-checked`/`aria-pressed` reflecting current state on both buttons (not just the active one), label text "Light"/"Dark" visible, not icon-only — unlike the top-bar's icon-only `#bTheme`, this control is meant to be self-explanatory without a tooltip, per §2's own rationale for adding it.
- **Focus-visible**: reuses the existing global `:focus-visible` rule (`demo.css:28`), consistent with every other control in this spec set — no new rule for the theme buttons, search input, or `<details>` summaries (all already native/existing elements).
- **Live regions**: the existing "x ago"/uptime ticker (`about.mjs:167-169`) updates plain text nodes, not inside an `aria-live` region today in the standalone page — **not changed by this spec** (out of scope: fixing that would be a pre-existing accessibility gap on `/about` itself, not something introduced by the port). Flagging in §7 rather than silently fixing it, since it's real scope creep beyond "promote this section."
- **`prefers-reduced-motion`**: the shot-zoom overlay (`installShotZoom`, `about.mjs:131-149`) has no transition/animation in its current CSS (`SHOT_CSS`, `about.mjs:124-129`) — nothing to gate. Covered by `demo.css`'s blanket rule regardless if one is added later.
- **Contrast**: same confirmed token-system mismatch as `insights-section.md` §6 — `about.html`'s inline `<style>` (`about.html:13-54`) uses `/theme.css` tokens (`var(--bg)`, `var(--fg)`, `var(--card)`, `var(--grn)`, `var(--red)`, `var(--acc)`, `var(--mut)`, `var(--bd)`, `var(--bd2)`, `var(--stat)`), none of which exist in `demo-tokens.css`. Same mechanical remapping dependency flagged there — not resolved here, but called out so it isn't discovered twice. The one new pairing this spec introduces (the Appearance segmented control's pressed state) should reuse an existing `demo-tokens.css` pairing already covered by `demo-tokens.test.mjs` rather than inventing a new one — Ad hoc Dev's call on which existing `.btn`/`.seg` treatment to reuse (§2).

## 7. Open items for Ad hoc Dev / Design QA

1. **CSS token mismatch (§6), same category as `insights-section.md` §7.1:** `about.html`'s inline styles are written entirely against `/theme.css` tokens, none of which exist in `demo-tokens.css`. Every rule needs remapping before this section renders with correct color inside `demo.html` — budget for it, don't discover it mid-port.
2. **Account/login is out of scope (§2).** Explicit, not an oversight: no account system exists in the demo today, and the one related decision on record (`app-shell-nav.md` §2, owner 2026-10-01) is a placeholder slot, not a real control. If the owner wants a real account section here later, it needs its own requirements and design pass.
3. **Ticker lifecycle while hidden (§4).** Whether `mountAbout`'s 30s `setInterval` should pause while `#s-settings` is `hidden` is a minor efficiency question with an existing `stop()` hook (`about.mjs:173`) ready to use either way — not a correctness blocker, Ad hoc Dev's call.
4. **Deploy-history empty-state instruction text (§4)** and **no-deployed-builds CLI command** both assume shell access, same category of flag as `insights-section.md` §7.3 — owner call on whether Settings/About needs a different message for a non-engineer audience.
5. **Live-region gap on the ticker (§6)** is a pre-existing gap on `/about` today, not introduced by this promotion — flagging for Design QA to decide whether to fix it opportunistically during this port or file it separately.
6. **New nav icon** (shared open item, `app-shell-nav.md` §8.1 — gear, already named in that spec) — not re-litigated here.
