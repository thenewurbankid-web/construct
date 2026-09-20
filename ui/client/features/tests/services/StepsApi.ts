// The step document's three calls on ui/server's /api/tests (behind the session). The client sends a feature name,
// a file NAME, the content hash it opened and the step FIELDS; the server validates every one and derives every
// path. A refusal comes back as { ok:false, error, code } and is shown as it is.
import { getJson, postJson } from '@/lib/http';
import type { StepDocResult, StepFields, StepPreviewResult, StepSaveResult } from '../types';
import { testsBase } from './TestsPaths';

const DOWN = 'The Cockpit server could not be reached.';

export async function fetchSteps(feature: string, name: string): Promise<StepDocResult> {
  try {
    const body = await getJson<StepDocResult>(`${testsBase(feature)}/steps?name=${encodeURIComponent(name)}`);
    return body.ok ? body : { ok: false, error: (body as { error?: string }).error ?? 'The test could not be read.' };
  } catch {
    return { ok: false, error: DOWN };
  }
}

/** Validate an edit and get the diff of what would change. Writes nothing. */
export async function previewSteps(feature: string, name: string, baseHash: string, steps: StepFields[]): Promise<StepPreviewResult> {
  try {
    const body = await postJson<StepPreviewResult>(`${testsBase(feature)}/steps/preview`, { name, baseHash, steps });
    return body.ok ? body : { ok: false, error: (body as { error?: string }).error ?? 'The change could not be checked.', code: (body as { code?: string }).code };
  } catch {
    return { ok: false, error: DOWN };
  }
}

/** Write the previewed edit. `resultSha` is the hash of the diff the user reviewed. */
export async function saveSteps(feature: string, name: string, baseHash: string, resultSha: string, steps: StepFields[]): Promise<StepSaveResult> {
  try {
    const body = await postJson<StepSaveResult>(`${testsBase(feature)}/steps`, { name, baseHash, resultSha, steps });
    return body.ok ? body : { ok: false, error: (body as { error?: string }).error ?? 'The change could not be saved.', code: (body as { code?: string }).code };
  } catch {
    return { ok: false, error: DOWN };
  }
}
