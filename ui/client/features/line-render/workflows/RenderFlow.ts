import { propsQuery } from '../domain/PropInput.ts';
import { stateFromResult } from '../domain/RenderState.ts';
import { fetchLineRender } from '../services/LineRenderApi';
import type { LineRenderState, PropValue } from '../types';

/** One render: the person's values over the samples, GET /api/line/render, then what the preview shows. Never
 * throws: a server that cannot be reached is a one-sentence refusal too. */
export async function renderComponent(file: string, edits: Record<string, PropValue>): Promise<LineRenderState> {
  try {
    return stateFromResult(await fetchLineRender(file, propsQuery(edits)));
  } catch {
    return stateFromResult(null);
  }
}
