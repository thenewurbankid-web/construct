import { lineHttp } from '@/lib/lineHttp';
import type { LineApi, LineProjectResult } from '../types';

// The Components screen's use of the shared LINE_API mirror (lib/lineContract.ts, lib/lineHttp.ts): the project, or one
// sentence saying why not. Base on and Promote are plan steps (hooks/useLineChanges.tsx), never direct writes.

/** The Line view of the open project. */
export async function getLineProject(): Promise<LineProjectResult> {
  try {
    const body = await lineHttp.getProject();
    if (body && typeof body === 'object' && 'isLine' in body) return { ok: true, project: body };
    const sentence = body && 'sentence' in body && typeof body.sentence === 'string' ? body.sentence : 'Cockpit could not read this project as a Line project.';
    return { ok: false, sentence };
  } catch {
    return { ok: false, sentence: 'The Cockpit server did not answer.' };
  }
}

export const lineApi: LineApi = { getLineProject };
