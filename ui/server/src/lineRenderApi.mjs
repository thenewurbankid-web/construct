// T7 of the Line Cockpit (packages/engine/line/contract.mjs, LINE_API): one library component rendered alone, with
// its props, for the Components Library and its preview route. A pure read; the work is the engine block
// packages/engine/line/renderComponent.mjs (Morpheus's isolated render through packages/line-links).
//
//   GET /render?file=<library>/components/X.tsx&props=<JSON object>   -> RenderResult
//
// A refusal (OUTSIDE_LIBRARY, NOT_SOURCE, NOT_FOUND, BAD_PROPS, UNKNOWN_PROP) is a 400 with one sentence; no
// renderer or a failed render is a 200 `{ok: false, sentence, detail, props}`, so the screen still lists the props.
import express from 'express';
import { renderLibraryComponent } from '../../../packages/engine/line/renderComponent.mjs';

const REFUSALS = new Set(['OUTSIDE_LIBRARY', 'NOT_SOURCE', 'NOT_FOUND', 'BAD_PROPS', 'UNKNOWN_PROP']);

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}),
 *   render?: typeof renderLibraryComponent, deps?: Parameters<typeof renderLibraryComponent>[2]}} options
 *   `render` and `deps` (for example a mocked Morpheus loader) are for tests.
 * @returns {import('express').Router}
 */
export function createLineRenderRouter({ getRoot, render = renderLibraryComponent, deps = {} }) {
  const router = express.Router();
  router.get('/render', async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    const file = typeof req.query.file === 'string' ? req.query.file : '';
    const props = typeof req.query.props === 'string' ? req.query.props : undefined;
    const result = await render(r.root, { file, props }, deps);
    res.set('Cache-Control', 'no-store');
    return res.status(!result.ok && REFUSALS.has(result.code) ? 400 : 200).json(result);
  });
  return router;
}
