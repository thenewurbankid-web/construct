// Live preview v2 (#443): turns a `construct:preview:select` payload's `selection` into a project-relative
// source location, by calling the server's resolver (packages/engine/previewFiber.mjs's resolveFiberSelection,
// exposed at POST /api/dev-server/resolve-selection — design note docs/design/live-preview-v2.md §5-6). No
// resolution logic lives here: the server decides tiers, confidence and refusals; this only shapes the call.
import { sendJson } from '@/lib/http';
import type { FiberSelection } from './PreviewFiberSource';

export type FiberSourceAncestor = { componentName: string | null; file: string | null; line: number | null; column: number | null };

export type FiberSourceResolution = {
  ok: boolean;
  tier: 'debug-source' | 'stack' | 'component' | null;
  confidence: 'high' | 'low' | null;
  file: string | null;
  line: number | null;
  column: number | null;
  componentName: string | null;
  ancestors: FiberSourceAncestor[];
  reason: string | null;
};

/** `409` means the dev server was stopped or swapped between the click and this call (`t.refusal`): the
 * caller shows the ordinary "server not running" state instead of a resolution error. */
export async function resolveFiberSourceSelection(selection: FiberSelection): Promise<{ status: number; resolution: FiberSourceResolution | null }> {
  const { status, body } = await sendJson<FiberSourceResolution>('POST', '/api/dev-server/resolve-selection', { selection });
  return { status, resolution: status === 200 ? body : null };
}
