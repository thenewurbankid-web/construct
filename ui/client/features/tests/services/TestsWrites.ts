// The two MUTATING calls of ui/server's /api/tests (POST, behind the session). Same rule as TestsApi: only names
// are sent; the server validates them, derives every path and never overwrites.
import { postJson } from '@/lib/http';
import type { CloneResult, GenerateResult, StoryCompareAiResult } from '../types';
import { testsBase } from './TestsPaths';

const DOWN = 'The Cockpit server could not be reached.';

/** Copy one generated test to features/<feature>/tests/<name>.spec.ts. */
export async function cloneTest(feature: string, source: string, name: string): Promise<CloneResult> {
  try {
    const body = await postJson<CloneResult>(`${testsBase(feature)}/clone`, { source, name });
    return body.ok ? body : { ...body, ok: false, error: (body as { error?: string }).error ?? 'The clone could not be made.' };
  } catch {
    return { ok: false, error: DOWN };
  }
}

/** `construct generate tests <feature>`: the generator refuses, with the YAML to add, when the lock is not declared. */
export async function generateTests(feature: string): Promise<GenerateResult> {
  try {
    const body = await postJson<GenerateResult>(`${testsBase(feature)}/generate`, {});
    return body.ok ? body : { ok: false, error: (body as { error?: string }).error ?? 'The tests could not be generated.' };
  } catch {
    return { ok: false, error: DOWN };
  }
}

/** AI compare (#388): asks the local model to cite which code unit(s) satisfy which acceptance line, then verifies
 * every citation mechanically server-side before returning it -- an unverifiable citation is dropped, never shown. */
export async function storyCompareAi(feature: string): Promise<StoryCompareAiResult> {
  try {
    const body = await postJson<StoryCompareAiResult>(`${testsBase(feature)}/story-compare-ai`, {});
    return body.ok ? body : { ok: false, error: (body as { error?: string }).error ?? 'AI compare failed.' };
  } catch {
    return { ok: false, error: DOWN };
  }
}
