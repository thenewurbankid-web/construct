import { lineHttp } from '@/lib/lineHttp';
import type { RenderResult } from '../types';

// The preview's use of the shared LINE_API mirror (lib/lineHttp.ts): GET /api/line/render. A refusal arrives as
// 400 {ok: false, sentence, code} and reaches the panel as its sentence.
export function fetchLineRender(file: string, props: string | undefined): Promise<RenderResult> {
  return lineHttp.render(file, props);
}
