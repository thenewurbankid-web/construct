# Portfolio Health rebuild 2 — real Subframe render (LIN-194)

**Source.** The real page pulled from Subframe's MCP server,
`subframe-app/src/pages/PortfolioHealthFigmaRebuild2.tsx` (byte-identical, untouched). `page.tsx` in this folder is
a copy with `data-dyn`/`data-list`/`data-action` applied by `src/import`'s `suggestMarkers`/`applyMarkers` (every
*strong* suggestion accepted, the same rule the import wizard uses; regenerate with
`node scripts/mark-real-page-2.mjs subframe-app/src/pages/PortfolioHealthFigmaRebuild2.tsx examples/portfolio-figma-2-real`
if the source page changes) — self-contained like every other example, nothing lives outside this folder. For the
real-render preview, `src/subframe-preview.mjs` feeds this file's text to subframe-app's own Vite instance as a
virtual module (so `@/ui-v2/*` and Tailwind's class scan resolve exactly as they do for the real app) rather than
copying it into `subframe-app/src`.

**API.** Reuses `portfolio-figma-2`'s contract as-is (`openapi.json`, `GET /api/category-health/portfolio`): the
same envelope, `portfolio_at_a_glance` for header cards, `categories[]` for the table. The shapes line up because
this is the same page rebuilt with real Subframe components instead of hand-authored plain JSX.

**What's different from `portfolio-figma-2`.** That example renders through `src/page-preview.mjs`, a crude
JSX-to-HTML walker; real Subframe components would show as unstyled generic tags. This example instead renders
through `src/subframe-preview.mjs` (`"render": "subframe"` in `feature.json`): Vite's SSR module loader resolves
the real `@/ui-v2/components/*` (including `PageLayoutTopBar`/`TopbarWithRightNav`, not used by rebuild 1) and
`@subframe/core` icon components, `react-dom/server` turns the tree into real HTML, and Tailwind supplies the
real resolved classes. The marker props become real `data-dyn`/`data-list`/`data-action`/`data-id` attributes
because Subframe's components pass unknown DOM props through to their root element. The "YoY" trend is a real
`FeatherTriangle` icon next to its own text span here (rather than a literal "▲" character as in rebuild 1), so
`suggestMarkers` marks only the text span (`spendYoy`, not a combined arrow+text value) — the same shape
`portfolio-figma-2`'s hand-authored page already has.

**Try it.** Press Auto (or Wire it, in the studio) same as any example; the highlighted tree shows the SAME
Fit/Waiting/Gap/Tie/Stub technique, over the real rendered page. Extraction finds 8 values, one 7-field list
(6 rows) and 2 actions (`promptSuggestion01/02`, weak matches to real `<Button>`s with empty `onClick`s — not a
row action, so this page has no row action like `portfolio-figma-1-real`'s "row → drill in").
