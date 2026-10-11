import { isLineMock } from '@/lib/lineMode';
import { lineHttp } from '@/lib/lineHttp';
import type { LineFeaturesApi } from '../types';

/** The API the screen talks to: the shared LINE_API mirror (lib/lineHttp.ts) on the server, or the contract's in-memory
 * mock when Line mock mode is on. The mock is loaded only when asked for, so it is never part of the normal screen's code. */
export async function loadLineFeaturesApi(): Promise<LineFeaturesApi> {
  if (!isLineMock()) return lineHttp;
  const { mockLineFeaturesApi } = await import('./LineFeaturesApi.mock');
  return mockLineFeaturesApi;
}
