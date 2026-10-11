import { getJson } from '@/lib/http';
import type { RenderResult } from '../types';

// The preview's mirror of LINE_API's GET /api/line/render (packages/engine/line/contract.mjs). A refusal arrives as
// 400 {ok: false, sentence, code}; getJson reads the body whatever the status, so it reaches the panel as its sentence.
export function fetchLineRender(file: string, props: string | undefined): Promise<RenderResult> {
  const q = new URLSearchParams({ file });
  if (props !== undefined) q.set('props', props);
  return getJson<RenderResult>(`/api/line/render?${q.toString()}`);
}
