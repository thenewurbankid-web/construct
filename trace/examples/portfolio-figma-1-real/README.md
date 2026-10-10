# Portfolio Health — real Subframe render (TR-23)

**Source.** The real page pulled from Subframe's MCP server, `subframe-app/src/pages/PortfolioHealthFigmaRebuild.tsx`
(byte-identical, untouched). `page.tsx` in this folder is a copy with `data-dyn`/`data-list`/`data-action` applied
by `src/import`'s `suggestMarkers`/`applyMarkers` (every *strong* suggestion accepted, the same rule the import
wizard uses; regenerate with `node scripts/mark-real-page.mjs` if the source page changes) — self-contained like
every other example, nothing lives outside this folder. For the real-render preview, `src/subframe-preview.mjs`
feeds this file's text to subframe-app's own Vite instance as a virtual module (so `@/ui-v2/*` and Tailwind's
class scan resolve exactly as they do for the real app) rather than copying it into `subframe-app/src`.

**API.** Reuses `portfolio-figma-1`'s contract as-is (`openapi.json`, `GET /api/category-health/portfolio`): the
same envelope, `portfolio_at_a_glance` for header cards, `categories[]` for the table. The shapes line up because
this is the same page rebuilt with real Subframe components instead of hand-authored plain JSX.

**What's different from `portfolio-figma-1`.** That example renders through `src/page-preview.mjs`, a crude
JSX-to-HTML walker that treats every tag literally — real Subframe components would show as unstyled generic tags.
This example instead renders through `src/subframe-preview.mjs` (`"render": "subframe"` in `feature.json`): Vite's
SSR module loader resolves the real `@/ui-v2/components/*` and `@subframe/core` icon components, `react-dom/server`
turns the tree into real HTML, and Tailwind (via PostCSS, the same `tailwind.config.js`/`index.css` the dev server
uses) supplies the real resolved classes. The marker props become real `data-dyn`/`data-list`/`data-action`/`data-id`
attributes because Subframe's components pass unknown DOM props through to their root element. `/api/preview`
detects `render: "subframe"` and calls the new renderer; `src/ui/demo.mjs`'s `loadPreview()`/`paintTree()` are
unchanged — they just inject whatever HTML comes back and colour by `data-id`, same as always.

**Try it.** Press Auto (or Wire it, in the studio) same as any example; the highlighted tree shows the SAME
Fit/Waiting/Gap/Tie/Stub technique, over the real rendered page. Extraction finds 9 values, one 7-field list
(6 rows) and 2 actions (`promptSuggestion01/02`, weak matches to real `<Button>`s with empty `onClick`s — not a
row action, so this page has no row action like `portfolio-figma-1`'s "row → drill in").
