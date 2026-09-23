import { getJson } from '@/lib/http';
import type { PaletteData } from '../types';

// #527 -- feature-scoped, not file-scoped (packages/engine/palette.mjs is the same for every page
// of a feature): see ui/server/src/index.mjs's GET /api/pages/palette.
export const getPalette = (feature: string) => getJson<PaletteData & { ok?: boolean; error?: string }>(`/api/pages/palette?feature=${encodeURIComponent(feature)}`);
