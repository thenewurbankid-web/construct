import { lineHttp } from '@/lib/lineHttp';
import { toApplyResult } from '../domain/ChangeText';
import type { ApplyResult, BaseOnRequest, LineApi, LineProjectResult, PromoteRequest } from '../types';

// The Components screen's use of the shared LINE_API mirror (lib/lineContract.ts, lib/lineHttp.ts): the project, or one sentence saying why
// not; a change answers an ApplyResult (written only through Construct's writer on the server). A refusal or a network
// failure is one sentence too.

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

async function send(call: () => Promise<unknown>): Promise<ApplyResult> {
  try {
    return toApplyResult(await call());
  } catch {
    return toApplyResult({ ok: false, sentence: 'The Cockpit server did not answer; nothing was changed.' });
  }
}

/** A new feature item based on a library item (POST /api/line/base-on). */
const baseOn = (req: BaseOnRequest) => send(() => lineHttp.baseOn(req));

/** Moves a feature item into the library and re-points its users (POST /api/line/promote). */
const promote = (req: PromoteRequest) => send(() => lineHttp.promote(req));

export const lineApi: LineApi = { getLineProject, baseOn, promote };
