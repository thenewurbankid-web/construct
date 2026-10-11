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

/** Line mock mode has no plan on a server, so a change cannot be added as a step; it says so in one sentence. */
export async function mockAddStep(): Promise<{ ok: false; sentence: string; code: string }> {
  return { ok: false, sentence: 'Changes are not saved in mock mode; open the project on the server to add plan steps.', code: 'MOCK_MODE' };
}
