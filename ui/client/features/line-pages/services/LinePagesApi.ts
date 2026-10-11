import { lineHttp } from '@/lib/lineHttp';
import type { LinePagesApi } from '../types';
import { isLineMock } from '@/lib/lineMode';

/** The API the screen talks to: the shared LINE_API mirror (lib/lineContract.ts, lib/lineHttp.ts) on the server, or the contract's in-memory
 * mock when Line mock mode is on. The mock is loaded only when asked for, so it is never part of the normal screen's code. */
export async function loadLinePagesApi(): Promise<LinePagesApi> {
  if (!isLineMock()) return lineHttp;
  const { mockLinePagesApi } = await import('./LinePagesApi.mock');
  return mockLinePagesApi;
}
