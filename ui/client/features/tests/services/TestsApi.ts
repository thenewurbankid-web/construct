// Reading ui/server's /api/tests. Thin wrappers: no policy here. The client sends only a feature name and a file
// NAME; the server validates both and derives every path.
import { getJson } from '@/lib/http';
import type { SourceResult, TestArea, TestsListing } from '../types';
import { testsBase } from './TestsPaths';

const DOWN = 'The Cockpit server could not be reached.';

/** Features that have workflows (the only ones with scenarios to cover). */
export async function fetchTestFeatures(): Promise<string[]> {
  try {
    const body = await getJson<{ features?: string[] }>('/api/workflows/features');
    return Array.isArray(body.features) ? body.features : [];
  } catch {
    return [];
  }
}

export async function fetchTests(feature: string): Promise<{ ok: true; data: TestsListing } | { ok: false; error: string }> {
  try {
    const body = await getJson<TestsListing | { ok?: false; error?: string }>(testsBase(feature));
    if ('generated' in body && body.ok) return { ok: true, data: body };
    return { ok: false, error: (body as { error?: string }).error ?? 'The tests could not be read.' };
  } catch {
    return { ok: false, error: DOWN };
  }
}

export async function fetchTestSource(feature: string, area: TestArea, name: string): Promise<SourceResult> {
  try {
    const body = await getJson<SourceResult>(`${testsBase(feature)}/source?area=${area}&name=${encodeURIComponent(name)}`);
    return body.ok ? body : { ok: false, error: (body as { error?: string }).error ?? 'The code could not be read.' };
  } catch {
    return { ok: false, error: DOWN };
  }
}
