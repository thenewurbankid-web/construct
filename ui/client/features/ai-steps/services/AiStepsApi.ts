import { isLineMock } from '@/lib/lineMode';
import { lineHttp } from '@/lib/lineHttp';
import type { AiStepsApi } from '../types';

/** The shared LINE_API mirror on the server, or a small in-memory sample when Line mock mode is on (loaded only then). */
export async function loadAiStepsApi(): Promise<AiStepsApi> {
  if (!isLineMock()) return lineHttp;
  const { mockAiStepsApi } = await import('./AiStepsApi.mock');
  return mockAiStepsApi;
}
