import { getJson, postJson } from '@/lib/http';
import type { PageTree, PaletteData, SaveOutcome, WrapConfirmOutcome, WrapSuggestion } from '../types';

// #527 -- feature-scoped, not file-scoped (packages/engine/palette.mjs is the same for every page
// of a feature): see ui/server/src/index.mjs's GET /api/pages/palette.
export const getPalette = (feature: string) => getJson<PaletteData & { ok?: boolean; error?: string }>(`/api/pages/palette?feature=${encodeURIComponent(feature)}`);

// #532 (Slice 2 of #518's design) -- click a Component/Provider entry to insert its real usage at the
// currently open page. `kind`/`name`/`path` are only a lookup key: the server re-derives the real
// entry from a fresh palette read for this page's own feature, never trusting the client's copy of
// its description/via verbatim (see ui/server/src/index.mjs's POST /api/pages/palette/insert).
export const insertPaletteEntry = (body: { feature: string; file: string; kind: 'provider' | 'component'; name: string; path: string; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/palette/insert', body);

// #533 (Slice 3 of #518's design) -- "Wrap with...": what a JSX selection (`nodeId`, the same
// selection every other Pages editor tab already uses) suggests. `preview` (default false) keeps the
// automatic "you selected something" call (fired the instant a selection lands) from itself running
// and returning a full dry-run diff -- only the explicit "Wrap with..." click passes `preview: true`
// to ask for one. Read-only either way: never writes.
export const getWrapSuggestion = (params: { feature: string; file: string; nodeId: string; name?: string; preview?: boolean }) => {
  const q = new URLSearchParams({ feature: params.feature, file: params.file, nodeId: params.nodeId });
  if (params.name) q.set('name', params.name);
  if (params.preview) q.set('preview', '1');
  return getJson<WrapSuggestion>(`/api/pages/palette/wrap-suggest?${q.toString()}`);
};

// #533 -- "Approve": the real, non-dry-run extraction. `nodeId` is re-resolved to the same flagged
// hit server-side, never a client-sent range (see ui/server/src/index.mjs's POST /api/pages/palette/wrap).
export const confirmWrap = (body: { feature: string; file: string; nodeId: string; name: string; contentHash: string }) =>
  postJson<WrapConfirmOutcome>('/api/pages/palette/wrap', body);
