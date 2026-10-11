# line-import-clash

Fixture for Line Import (packages/engine/line/import.mjs), found on max-ai-ui's `src/subframe-pages/Opportunity`:

- `src/opp/pages/Detail.tsx` and `src/opp/pages/Detail-v2.tsx` both export `Detail`, so the plan must catch the name
  clash and propose `DetailV2`. `src/App.tsx` (outside the folder) and `src/opp/hooks/useNextDetail.ts` (inside) import both.
- `src/opp-frozen/` is the same folder with its own `architecture.yml` freezing `library/pages/**`: the import's early
  steps land, then a later step (a page into the library) is refused, so a refused apply must leave it byte-identical.
