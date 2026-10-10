# Redesigned Portfolio Health — real Subframe render (LIN-194)

**Source.** The real page pulled from Subframe's MCP server,
`subframe-app/src/pages/RedesignedPortfolioHealth.tsx` (byte-identical, untouched). `page.tsx` in this folder is
a copy with `data-dyn`/`data-list`/`data-action` applied by `src/import`'s `suggestMarkers`/`applyMarkers` (every
*strong* suggestion accepted, the same rule the import wizard uses; regenerate with
`node scripts/mark-real-page-2.mjs subframe-app/src/pages/RedesignedPortfolioHealth.tsx examples/portfolio-redesigned-real`
if the source page changes) — self-contained like every other example, nothing lives outside this folder. For the
real-render preview, `src/subframe-preview.mjs` feeds this file's text to subframe-app's own Vite instance as a
virtual module (so `@/ui-v2/*` and Tailwind's class scan resolve exactly as they do for the real app) rather than
copying it into `subframe-app/src`.

**API.** Reuses `portfolio-redesigned`'s contract as-is (`openapi.json`, `GET /api/category-health/portfolio`):
the same envelope, `portfolio_at_a_glance` for header cards, `categories[]` for the table. The shapes line up
because this is the same redesign rebuilt with real Subframe components instead of hand-authored plain JSX.

**What's different from `portfolio-redesigned`.** That example renders through `src/page-preview.mjs`, a crude
JSX-to-HTML walker. This example instead renders through `src/subframe-preview.mjs` (`"render": "subframe"` in
`feature.json`): Vite's SSR module loader resolves the real `@/ui-v2/components/*` and `@subframe/core` icon
components, `react-dom/server` turns the tree into real HTML, and Tailwind supplies the real resolved classes.
The marker props become real `data-dyn`/`data-list`/`data-action`/`data-id` attributes because Subframe's
components pass unknown DOM props through to their root element.

Two structural differences fall out of the real markup rather than the hand-authored one:
- `portfolio-redesigned`'s two "Ask Anything" prompt buttons are plain `<button data-action="suggest">`s. The real
  source instead uses a Subframe `<Suggestion>` component with no `onClick`/`type=submit` prop in the JSX, which
  `suggestMarkers` only ever marks on `Button`/`IconButton`/`button`/`a` — so this real page extracts **0 page-level
  actions**, not 2. Row-level "open" actions on the six clickable `<Table.Row>`s still extract normally.
- Because the field names `suggestMarkers` derives come from each element's own nearby label text, several values
  land under different auto-generated names than the hand-authored page's (`baselineSpend5` vs `baselineSpend`,
  `maxYourPortfolioSummary2` vs no equivalent explicit value, etc.) — expected, the same kind of divergence
  `portfolio-figma-1-real`'s README documents for its own value names.

**Deviation from the sibling pattern.** `portfolio-redesigned` also ships `ai-cache.json`, `answers.json` and
`decisions.json` from a prior AI-assisted run — all keyed by the field names its hand-authored page produces
(`list.spendChange`, `value.baselineSpend`, `action.page.suggest`, …). Because the real page's `suggestMarkers`
names diverge (see above) and it has zero page-level actions, copying those files verbatim would leave stale,
non-matching keys that look wired but are not. They are intentionally omitted here rather than adapted by hand;
a real AI-assisted run against this example would regenerate its own cache/answers/decisions from scratch.

**Try it.** Press Auto (or Wire it, in the studio) same as any example; the highlighted tree shows the SAME
Fit/Waiting/Gap/Tie/Stub technique, over the real rendered page. Extraction finds 7 values, one 6-field list
(6 rows) and 0 page-level actions (only the per-row "open" action on the category table).
