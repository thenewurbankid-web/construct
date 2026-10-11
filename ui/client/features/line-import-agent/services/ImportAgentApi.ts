import { lineHttp } from '@/lib/lineHttp';
import { isLineMock } from '@/lib/lineMode';
import type { ImportAgentApi } from '../types';

/** The API the Import agent screen talks to: the shared LINE_API mirror (lib/lineHttp.ts) on the server, or the contract's
 * mock (packages/engine/line/mockImportAgent.mjs) in Line mock mode (?line=mock). The mock is loaded only when asked for. */
export async function loadImportAgentApi(): Promise<ImportAgentApi> {
  if (!isLineMock()) return lineHttp;
  const { mockImportAgentApi } = await import('./ImportAgentApi.mock');
  return mockImportAgentApi;
}
