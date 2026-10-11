import { lineHttp } from '@/lib/lineHttp';
import { isLineMock } from '@/lib/lineMode';
import type { ImportApi } from '../types';

/** The API the Import screen talks to: the shared LINE_API mirror (lib/lineHttp.ts) on the server, or the contract's in-memory
 * mock (packages/engine/line/mockImport.mjs) in Line mock mode (?line=mock). The mock is loaded only when asked for. */
export async function loadImportApi(): Promise<ImportApi> {
  if (!isLineMock()) return lineHttp;
  const { mockImportApi } = await import('./ImportApi.mock');
  return mockImportApi;
}
