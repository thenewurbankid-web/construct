import { getJson, postJson } from '@/lib/http';
import { toApplyResult } from '../domain/ChangeText';
import type { ApplyResult, BaseOnRequest, LineApi, LineProject, LineProjectResult, PromoteRequest } from '../types';

// The Line API (ui/server/src/lineApi.mjs + lineOpsApi.mjs, contract LINE_API). Reads answer the contract's
// LineProject; changes answer an ApplyResult (written only through Construct's writer on the server). A refusal or a
// network failure is one sentence too.

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

async function send(path: string, body: unknown): Promise<ApplyResult> {
  try {
    return toApplyResult(await postJson(path, body));
  } catch {
    return toApplyResult({ ok: false, sentence: 'The Cockpit server did not answer; nothing was changed.' });
  }
}

/** A new feature item based on a library item (POST /api/line/base-on). */
const baseOn = (req: BaseOnRequest) => send('/api/line/base-on', req);

/** Moves a feature item into the library and re-points its users (POST /api/line/promote). */
const promote = (req: PromoteRequest) => send('/api/line/promote', req);

export const lineApi: LineApi = { getLineProject, baseOn, promote };
