// Reading ui/server's /api/tests/:feature/compare (#306). Thin wrapper: the verdict and every sentence come from core.
import { getJson } from '@/lib/http';
import type { Comparison } from '../types';
import { testsBase } from './TestsPaths';

/** One clone against the flow as it is now: stale or not, and what changed. Read-only. */
export async function fetchComparison(feature: string, name: string): Promise<{ ok: true; data: Comparison } | { ok: false; error: string }> {
  try {
    const body = await getJson<Comparison | { ok?: false; error?: string }>(`${testsBase(feature)}/compare?name=${encodeURIComponent(name)}`);
    return body.ok ? { ok: true, data: body as Comparison } : { ok: false, error: (body as { error?: string }).error ?? 'The comparison could not be read.' };
  } catch {
    return { ok: false, error: 'The Cockpit server could not be reached.' };
  }
}
