import { getJson, postJson } from '@/lib/http';
import type { PageTree, PaletteData, SaveOutcome } from '../types';

// #527 -- feature-scoped, not file-scoped (packages/engine/palette.mjs is the same for every page
// of a feature): see ui/server/src/index.mjs's GET /api/pages/palette.
export const getPalette = (feature: string) => getJson<PaletteData & { ok?: boolean; error?: string }>(`/api/pages/palette?feature=${encodeURIComponent(feature)}`);

// #532 (Slice 2 of #518's design) -- click a Component/Provider entry to insert its real usage at the
// currently open page. `kind`/`name`/`path` are only a lookup key: the server re-derives the real
// entry from a fresh palette read for this page's own feature, never trusting the client's copy of
// its description/via verbatim (see ui/server/src/index.mjs's POST /api/pages/palette/insert).
export const insertPaletteEntry = (body: { feature: string; file: string; kind: 'provider' | 'component'; name: string; path: string; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/palette/insert', body);
