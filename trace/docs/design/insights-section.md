# Insights section — promoting `/quality` into the shell, renamed for a product audience

Status: draft, mocks + spec, Ad hoc Dev buildability pass complete ([[LIN-244]]), ready for Design QA review. Part of: [[LIN-85]] (Design the Trace product UI), `screen-map.md` §2 Insights row, [[LIN-101]]. Base (`app-shell-nav.md` rev 4) is owner-approved. One item remains for the owner, not Design QA: `/drift`'s disposition (§7.2).

Base: `trace/src/ui/quality.html` + `quality.mjs` (served today at `/quality`, standalone, reachable only from `/about` and `/studio` — `quality.html:40-43`). Per `screen-map.md` §2: "Kept dashboard, renamed to match a product audience rather than an internal eval-harness name." This is a promotion plus a relabeling pass, not a redesign of what the dashboard measures.

## 1. What ports as-is vs. what this spec changes

| Piece | Today (`/quality`, standalone) | Inside `/`, as the Insights section |
| --- | --- | --- |
| Rendering functions (`renderHeadline`, `renderDeterminism`, `renderTiming`, `renderPage`) | Pure, payload-in/HTML-out, unit-tested (`quality.mjs:15-42`) | **Unchanged.** No rendering logic changes in this spec — only the labels passed through `LABEL`/section headings (§2) and the mount point. |
| Data fetch (`mountQuality`, `quality.mjs:45-51`, reads `/api/quality`) | Fetches once on mount, no polling | **Unchanged** mechanism; see §4 for what changes about *when* it fetches now that the section can be revisited without a reload. |
| `<header class="top">` (`quality.html:38-44`): "Quality" `<h1>`, links to Drift/About/Changelog/"Back to the studio" | Its own standalone header | **Removed as a whole.** Brand, theme toggle and account placeholder already live in the shared `.top` bar (`app-shell-nav.md` §2); a second brand/theme row here would duplicate it. The Drift/About/Changelog/"Back to the studio" links are stray cross-links to other now-sectioned destinations — see §3 for where (if anywhere) they go. |
| Three `<section>` blocks (Headline, Determinism, Runtime) | Each `background:var(--card)` card, `quality.html:24` | **Unchanged markup**, now rendered inside `#s-insights` instead of `#app` on a standalone page. |
| Metric labels (`LABEL`, `quality.mjs:11`: "Precision", "Recall", "F1", "Wrong-accept rate", "Oracle accuracy", "Coupled-tie excess questions", "Library-gap misses"...) | Eval-harness jargon, written for whoever runs `npm run eval` | **Relabeled for a product audience, §2** — the underlying metric keys and values are untouched; only the strings a human reads change. |
| Section headings ("Headline (independent truth, all cases in parens)", "Determinism", "Runtime") | Internal framing (`quality.mjs:17,23,26`) | **Relabeled, §2** |

Net: almost all of this ports verbatim. The two real pieces of work are (1) the relabeling pass in §2, which touches strings, not logic, and (2) the states pass in §5, which the standalone page never fully specified (today's only non-happy-path case is `data.available === false`, `quality.mjs:35`).

## 2. Relabeling for a product audience

Trace's audience is "a human who observes and collaborates" (per the repo's own Vision), not an eval-harness operator. The dashboard's current labels assume the reader ran the eval and knows precision/recall/determinism terminology. Proposed renames — metric **keys and values are untouched**, only the label strings in `LABEL` and the section headings:

| Metric key | Today's label (`quality.mjs:11`) | Proposed product label | Why |
| --- | --- | --- | --- |
| `precision` | "Precision" | "Precision" (kept) | Already plain enough once paired with a one-line gloss (below) — renaming a term this standard risks confusing readers who do know it. |
| `recall` | "Recall" | "Recall" (kept) | Same reasoning. |
| `f1` | "F1" | "F1 (balance of precision and recall)" | "F1" alone is pure jargon; a parenthetical gloss, not a rename, keeps the number traceable to its definition elsewhere without inventing a new term for it. |
| `wrong_accept_rate` | "Wrong-accept rate" | "Wrongly accepted" | Drops "-rate," which reads as a statistics term; "wrongly accepted" names the thing that happened in plain language — matches the design ideology's "plain language over internals-jargon." |
| `coincidence_catch_rate` | "Coincidence catch" | "Coincidental matches caught" | "Catch" alone is ambiguous (caught *what*, by *whom*); spelling out the object makes the sentence stand on its own. |
| `questions_per_screen` | "Questions / screen" | "Questions asked per screen" | Removes the math-notation slash for a sentence a non-engineer reads naturally. |
| `unnecessary_question_rate` | "Unnecessary questions" | "Unnecessary questions" (kept) | Already plain. |
| `oracle_accuracy` | "Oracle accuracy" | "Accuracy against the known-correct answer" | "Oracle" is eval-harness jargon for "the pre-recorded correct answer" — meaningless to a product reader without that context. |
| `coupled_excess` | "Coupled-tie excess questions" | "Extra questions caused by coupled Ties" | "Coupled-tie" as a compound noun reads as jargon; restructured as a sentence and capitalizes "Tie" to tie it back to the product's own Fit/Wait/Gap/Tie/Stub vocabulary (`screen-map.md` §1) instead of leaving it as an unrelated term. |
| `library_miss_rate` | "Library-gap misses" | "Missed matches the library should have had" | Names the failure in plain language; "library-gap" assumes the reader knows what "the library" is in this system. |
| — | Section heading: "Headline (independent truth, all cases in parens)" | "Accuracy summary" with a `sub` line: "Measured against known-correct answers; parenthetical shows the number across every case, not just the independently verified ones." | "Independent truth" and "all cases in parens" are both eval-harness framing devices. Moving the methodology note into a `.sub` line keeps the heading itself plain while not deleting the caveat — it's load-bearing (it tells a careful reader the headline numbers exclude some cases), just not headline material. |
| — | Section heading: "Determinism" | "Consistency" with a `sub` line unchanged ("`n` case(s) checked twice, with endpoints and JSON keys reordered.") | "Determinism" is a correct but technical term for "does this give the same answer twice" — "Consistency" says the same thing in a word a stakeholder already has. |
| — | Section heading: "Runtime" | "Speed" | Shorter, plainer; "Runtime" is not wrong but reads as an engineering metric name rather than a product one. |

- **What does not change**: `pctS`/`numS` formatting (`quality.mjs:7-8`), the `HEADLINE_ORDER` array, the chip logic for clean/drift determinism (`renderDeterminism`, `quality.mjs:20-24`) — relabeling is a strings-only change, confirmed by reading the render functions: every label is a lookup against a `LABEL`/literal string, never computed from the metric key itself, so this is a safe, localized edit.
- **Not relabeled**: the `<code>` spans showing `data.variant`, `data.report_hash`, raw percentile numbers (`quality.mjs:37`) — these are identifiers and measurements, not jargon, and stay as-is per the design ideology's "show what the tool computed" (a stakeholder who wants to go verify a specific run needs the real hash, not a friendlier paraphrase of it).

## 3. Section header and stray cross-links

Like Page Map (`pagemap-section.md` §3), Insights loses its standalone `<header class="top">` (`quality.html:38-44`) entirely — brand, theme and account already live in the shared `.top` bar. Unlike Page Map, Insights has **no section-specific controls** (no picker, no undo/redo) — the dashboard is read-only. So, unlike `pagemap-section.md`, **no new sub-header row is needed here.** The section's content starts directly with the existing `<p class="sub">` variant/case-count line (`quality.mjs:37`), immediately below the shared `.top` bar.

The standalone header's four links (`quality.html:40-43`: Drift, About, Changelog, "Back to the studio") each pointed at a destination that either becomes a nav item itself or disappears:

| Link | Disposition |
| --- | --- |
| `/about` | Becomes the Settings/About nav item (`settings-about-section.md`) — redundant as an inline link once it's one click away in the persistent nav; **dropped**, not relocated. |
| `/changelog` | Already reachable from the shared top bar's `#bChangelog` (`demo.html:31`, kept per `app-shell-nav.md` §2) — **dropped** as a duplicate. |
| "Back to the studio" (`/studio`) | `/studio` is retired per `screen-map.md` §2 ("`/studio`... stop being destinations") — **dropped**, no replacement; there is no "studio" to go back to once this section lands. |
| `/drift` | **Not covered by this promotion.** `/drift` (`drift.html`/`drift.mjs`) is a fourth standalone page not named anywhere in `screen-map.md`'s six-section map or in [[LIN-101]]'s scope. Flagging as an open item (§7) rather than silently dropping or silently porting it — it's a real existing page this spec doesn't have a mandate to place. |

## 4. States

| State | Behavior |
| --- | --- |
| **Loading** (before `/api/quality` resolves) | `#app`'s placeholder `<p class="empty">Loading…</p>` (`quality.html:45`) — unchanged markup. New: because the shell keeps the section mounted after first visit (`app-shell-nav.md` §1's "state survives navigating away and back," same mechanism `pagemap-section.md` §1/§5 relies on), this loading state is only seen once per page load, not once per nav visit — re-entering the section after the first successful fetch shows the last-fetched data immediately, no refetch, no flash of "Loading…" |
| **No-data-yet** (`data.available === false`, `quality.mjs:35`) | "No eval report yet. Run `npm run eval:baseline` (or `npm run eval`) first." — **unchanged text, but this is engineering-operator instruction text inside a product UI.** Flagging, not silently rewriting: the instruction is accurate and actionable only for someone with shell access to the repo, which may not be every Insights reader. This spec keeps the string as-is (changing it to something a non-engineer could act on is a product decision about who else should be able to trigger an eval run, not a labeling decision) and lists it as an open question in §7. |
| **Error** (fetch throws — server not running, network failure) | "Could not load /api/quality. Is the server running?" (`quality.mjs:49`) — unchanged; same reasoning as above, this is accurate for a local dev deployment and the spec doesn't invent a different error surface for a hypothetical hosted deployment that doesn't exist yet. |
| **Loaded, clean determinism** | `renderDeterminism`'s "Clean" chip (`.k-feat`, green) — unchanged, relabeled heading only (§2). |
| **Loaded, determinism drift found** | `renderDeterminism`'s "`n` unexpected drift(s)" chip (`.k-fix`, amber) plus the `<ul>` of affected cases (`quality.mjs:21-22`) — unchanged. |
| **Section re-entered after navigating away** | New behavior enabled by the shell, same as `pagemap-section.md` §5's equivalent row: the last-fetched `data` object is still in memory (closure state inside `mountQuality`, `quality.mjs:45-51`); nothing to re-fetch unless the implementation is changed to also expose a manual refresh. No design work needed beyond *not* adding a reset-on-remount call — see §7 for whether a manual refresh affordance should exist at all (this spec doesn't add one; the eval report is produced by a manual CLI run, not a live process, so "stale until the page is reloaded" matches reality). |

## 5. Nav entry and badge

- Nav icon: placeholder glyph per `app-shell-nav.md` §3/§8.1 (new icon needed — Insights isn't `fit`, `handoff`, or any existing `icons.mjs` key; same open item already tracked there, not reopened here).
- No count badge. Unlike Run and Handoffs, Insights has no per-item queue a user acts on one at a time — it's a dashboard, read in full or not at all. Matches `pagemap-section.md` §4's identical reasoning for Page Map.
- Active-item highlight: same `[aria-current="page"]` mechanism as every other item (`app-shell-nav.md` §4).

## 6. Accessibility

- **Keyboard path**: shared nav → shared header (theme/account) → section content, top to bottom: accuracy-summary section → consistency section → speed section. No interactive controls inside the section beyond the existing `<code>`/plain text — no new keyboard path to design beyond what the shell already establishes (`app-shell-nav.md` §9).
- **Heading structure**: like Page Map (`pagemap-section.md` §6), removing the standalone `<h1>Quality</h1>` (`quality.html:39`) removes the page's only top-level heading. Add a visually-hidden `<h2>Insights</h2>` as the first child of `#s-insights`, matching the nav item's label and the same convention `pagemap-section.md` establishes for `#s-pagemap` — each section needs exactly one heading of its own so the six sections form a sane outline inside the one document. Existing `<h2>` elements inside the three cards (`renderHeadline`/`renderDeterminism`/`renderTiming`, each already a real `<h2>` with an `id` referenced by the card's `aria-labelledby`, `quality.mjs:17,23,26` and `renderPage`'s `<section aria-labelledby="...">` wrapper) become `<h3>`s once there's a section-level `<h2>` above them — a heading-level bump, not a markup rewrite.
- **Contrast**: the two chip color classes this section uses (`.k-feat` green, `.k-fix` amber, `quality.html:31`) are defined against `/theme.css` tokens (`var(--grn)`, `var(--amb)`), not `demo-tokens.css` — a real token-system mismatch once this section moves under `demo.html`, which links `demo-tokens.css`/`demo.css` and never `/theme.css` (`app-shell-nav.md`'s own base note). **Resolved by Ad hoc Dev's buildability pass ([[LIN-244]], full mapping in §7.1):** `.k-feat` re-points to `--fit` (green/clean), `.k-fix` re-points to `--wait` (amber/drift) — not `--gap`, which is the red "missing" family and would change color semantics, not just the token name. Both pairings need checking against `demo-tokens.test.mjs`'s existing 3:1 pattern (`app-shell-nav.md` §8.4) before shipping.
- **`prefers-reduced-motion`**: no animation in this section today or added by this spec; covered by `demo.css`'s existing blanket rule (`:414-416`) regardless.
- **Live regions**: none needed — the dashboard has no polling or streaming update in its current form (`mountQuality` fetches once); if a manual-refresh affordance is added later (§7), its result region should get `aria-live="polite"` — `about.mjs`'s own build/uptime ticker (`[data-uptime]`, `about.mjs:169`) has no precedent to follow here, it just overwrites `textContent` directly with no live region at all — but that's new scope, not this promotion.

## 7. Open items for Ad hoc Dev / Design QA

1. **CSS token mismatch — resolved, Ad hoc Dev buildability pass confirmed mechanical ([[LIN-244]]):** `quality.html`'s inline `<style>` block (`quality.html:13-34`) maps one-for-one onto `demo-tokens.css`:

   | `/theme.css` var | `demo-tokens.css` var | note |
   |---|---|---|
   | `--bg` | `--bg` | direct |
   | `--fg` | `--text` | direct |
   | `--card` (section bg) | `--surface` | matches `demo.css`'s own card convention |
   | `--acc` | `--accent` | direct |
   | `--mut` | `--muted` | direct |
   | `--bd` | `--border` | direct |
   | `--stat` (code bg) | `--surface-2` | `demo.css`'s own convention for inline code/inset backgrounds |
   | `--grn` (`.k-feat`) | `--fit` | green/Fit |
   | `--amb` (`.k-fix`) | `--wait`, **not** `--gap` | `--wait` is the amber "needs attention" family match for drift/wrong-accept; `--gap` is red/"missing" — using `--gap` would silently change color semantics, not just the token name |

   No work beyond this rename: every rule in the inline block is a straight `var()` substitution (`quality.mjs`'s render functions never compute a label/chip from the metric key). Ad hoc Dev's estimate: ~15 minutes, mechanical. Same mapping applies to `drift.html` if §7.2 below results in it shipping anywhere.

2. **`/drift` is not scoped by this spec (§3) — owner decision needed, Ad hoc Dev recommends against folding in ([[LIN-244]]):** `drift.mjs` is a thin read-only renderer over `/api/drift` (keyed by `?example=`) — a single example's stored contract-drift result (added/removed/changed endpoints), not an eval metric, and not a view over the same data Insights shows. Folding it in as an Insights tab would require Insights to carry a per-example selector it doesn't have today — new scope, not a rename. Options for the owner:
   - (a) a 7th section on `/` (reuses Run's existing per-example context);
   - (b) retire it (screen-map.md's six-section map doesn't need it if contract drift surfaces inline in Run instead);
   - (c) leave as a `/studio`-adjacent internal page, not promoted to the product UI.

   Not a call this spec or Ad hoc Dev's buildability pass makes unilaterally — escalate to the owner before or alongside this section's `request_confirmation`.
3. **No-data-yet instruction text (§4)** names a CLI command (`npm run eval:baseline`) that assumes shell access. Flagging whether the product audience this relabeling pass targets is expected to have that access, or whether this state needs a different message/action for a non-engineer reader — an owner call, not resolved here.
4. **Manual refresh affordance.** This spec does not add one (§4) on the reasoning that the eval report is produced out-of-band by a CLI run, so "stale until reload" already matches reality — flagging in case the owner wants a "Refresh" button once this is a persistent section someone might leave open rather than a page they reload.
5. **New nav icon** (shared open item, `app-shell-nav.md` §8.1) — not re-litigated here.
