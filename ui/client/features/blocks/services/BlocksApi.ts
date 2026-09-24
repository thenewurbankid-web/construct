// The Blocks catalogue and its per-project settings over ui/server's /api/blocks (#407). Every rule (which block can be
// set to AI, which provider, what a model name looks like, the rev) is the server's; this only asks and reports. A stale
// save (409) hands back the copy that won, so the tab adopts it instead of showing a setting the server did not keep.
import { sendJson } from '@/lib/http';
import type { BlockPatch, BlocksData, LoadResult, SaveResult } from '../domain/BlockTypes';

type Body = Partial<BlocksData> & { ok?: boolean; code?: string; error?: string; current?: BlocksData };
const UNREACHABLE = 'The Cockpit server could not be reached.';

const isData = (b: Body): b is BlocksData => Array.isArray(b.blocks) && typeof b.rev === 'number';

export async function loadBlocks(): Promise<LoadResult> {
  try {
    const { status, body } = await sendJson<Body>('GET', '/api/blocks');
    if (status === 200 && body.ok && isData(body)) return { ok: true, data: body };
    return { ok: false, error: body.error ?? 'The blocks could not be listed.' };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Save a change to one or more blocks against `rev` (sent as If-Match). An empty `blocks` resets a damaged settings file. */
export async function saveBlocks(rev: number, blocks: Record<string, BlockPatch>): Promise<SaveResult> {
  try {
    const { status, body } = await sendJson<Body>('PUT', '/api/blocks', { blocks }, { 'If-Match': String(rev) });
    if (status === 200 && body.ok && isData(body)) return { ok: true, data: body };
    return { ok: false, code: body.code ?? 'FAILED', error: body.error ?? 'The change could not be saved.', ...(body.current && isData(body.current) ? { current: body.current } : {}) };
  } catch {
    return { ok: false, code: 'UNREACHABLE', error: UNREACHABLE };
  }
}
