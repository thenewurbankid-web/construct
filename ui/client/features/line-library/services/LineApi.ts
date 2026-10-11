import { getJson } from '@/lib/http';
import type { LineApi, LineProject, LineProjectResult } from '../types';

// GET /api/line/project (ui/server/src/lineApi.mjs, contract LINE_API). Answers the contract's LineProject, or
// `{ok: false, sentence}` when the server refused; a network failure is one sentence too.

/** The Line view of the open project. */
export async function getLineProject(): Promise<LineProjectResult> {
  try {
    const body = await getJson<LineProject | { ok: false; sentence?: string }>('/api/line/project');
    if (body && typeof body === 'object' && 'isLine' in body) return { ok: true, project: body };
    const sentence = body && 'sentence' in body && typeof body.sentence === 'string' ? body.sentence : 'Cockpit could not read this project as a Line project.';
    return { ok: false, sentence };
  } catch {
    return { ok: false, sentence: 'The Cockpit server did not answer.' };
  }
}

export const lineApi: LineApi = { getLineProject };
