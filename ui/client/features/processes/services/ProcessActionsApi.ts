import { getJson, postJson } from '@/lib/http';
import type { ControlVerb, ProcessDetail } from '../types';

export type ControlResult = { ok: true; detail: ProcessDetail } | { ok: false; error: string };

/** POST a control. The server decides whether it is legal and says why not; the answer is shown, not second-guessed. */
export async function sendControl(id: string, verb: ControlVerb): Promise<ControlResult> {
  try {
    const body = await postJson<{ ok?: boolean; process?: ProcessDetail; error?: string }>(`/api/processes/${encodeURIComponent(id)}/${verb}`, {});
    if (body.ok && body.process) return { ok: true, detail: body.process };
    return { ok: false, error: body.error || 'The Construct server refused that.' };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/** The unified diff of one artifact from the bot's branch; `diff` is null (with a reason) when there is none to show. */
export async function fetchDiff(id: string, path: string): Promise<{ diff: string | null; reason?: string }> {
  try {
    const body = await getJson<{ ok?: boolean; diff?: string | null; reason?: string; error?: string }>(
      `/api/processes/${encodeURIComponent(id)}/diff?path=${encodeURIComponent(path)}`,
    );
    if (!body.ok) return { diff: null, reason: body.error || 'No diff available.' };
    return { diff: body.diff ?? null, reason: body.reason };
  } catch {
    return { diff: null, reason: 'Could not reach the Construct server.' };
  }
}
