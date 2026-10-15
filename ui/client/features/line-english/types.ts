// The English panel's view models (t5-3). The route's shapes come from the one shared mirror (lib/lineContract.ts).
import type { LineEnglishView, LineHttp } from '@/lib/lineContract';

export type { LineEnglishFunction, LineEnglishView } from '@/lib/lineContract';

/** The panel's load state for one file. */
export type EnglishState =
  | { phase: 'none' }
  | { phase: 'loading'; file: string }
  | { phase: 'error'; file: string; sentence: string }
  | { phase: 'ready'; file: string; view: LineEnglishView };

/** The service surface (real: GET /api/line/english; tests pass a stub). */
export type LineEnglishApi = { getEnglish: LineHttp['getEnglish'] };
