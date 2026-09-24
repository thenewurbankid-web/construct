// #407 -- the Blocks API: the catalogue of mechanical blocks with this project's settings and run counts, and the one
// write (turn a block off or on, pick its default engine and local model). Persistence and validation are
// `blockSettingsStore.mjs`; the words are `blockCatalogue.mjs`; enforcement is `planService.checkPlan`. No model is
// called anywhere on this path and the settings are never sent to one.
//
// Security and contract, in one place (the same shape as notesApi.mjs):
//   - mounted below the session gate AND the project-open gate (`requireProject`, index.mjs);
//   - the client never names a path: the settings live at `<stateDir>/block-settings/<projectKey>.json`, the key derived
//     on the server from the open project, and block ids are checked against the PLAN_FLOWS registry;
//   - a PUT from a foreign browser Origin is refused (403); the body must be JSON (415) and is capped at 16 KiB (413),
//     by this router's own parser (index.mjs steps the app-wide one aside for `/api/blocks`);
//   - `rev` (in `If-Match` or the body) is required: missing 400 REV_REQUIRED, stale 409 STALE_REV with the current copy;
//   - a refusal names its code (BLOCK_UNKNOWN, BLOCK_AI_UNSUPPORTED, ...) and writes nothing.
import express from 'express';
import { openProcessStore } from '../../../packages/engine/processStore.mjs';
import { openBlockSettingsStore, BlockSettingsError, ENGINES } from './blockSettingsStore.mjs';
import { blockCatalogue, runCounts } from './blockCatalogue.mjs';
import { LOCAL_PROVIDER } from './planService.mjs';

export const MAX_BLOCKS_REQUEST_BYTES = '16kb';

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** `If-Match: 3`, `"3"` or `W/"3"` -> 3; anything else -> undefined. */
export function revFromHeader(value) {
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(value);
  return m ? Number(m[1]) : undefined;
}

/**
 * @param {{getRoot: () => {ok:true, root:string} | {ok:false, status?:number, body?:object}, clientOrigin?: string, stateDir?: string, now?: () => string, getRuns?: (root: string) => object[]}} deps
 *   `getRoot` names the open project; `stateDir`, `now` and `getRuns` (the project's full process records) are test seams.
 */
export function createBlocksRouter({ getRoot, clientOrigin, stateDir, now, getRuns }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method !== 'GET') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    }
    return next();
  });
  router.use(express.json({ limit: MAX_BLOCKS_REQUEST_BYTES }));
  router.use((req, res, next) => {
    if (req.method === 'PUT' && !req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    return next();
  });

  const view = (root, store) => {
    const { record, unreadable } = store.read();
    let processes = [];
    try { processes = getRuns ? getRuns(root) : openProcessStore(root, stateDir ? { stateDir } : {}).all().processes; } catch { processes = []; }
    return {
      ok: true,
      rev: record.rev,
      updatedAt: record.updatedAt,
      unreadable,
      provider: LOCAL_PROVIDER,
      engines: [...ENGINES],
      blocks: blockCatalogue({ blocks: record.blocks, runs: runCounts(processes) }),
    };
  };

  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
    const store = openBlockSettingsStore(r.root, { ...(stateDir ? { stateDir } : {}), ...(now ? { now } : {}) });
    try {
      return res.status(200).json(fn(store, req, r.root));
    } catch (e) {
      if (e instanceof BlockSettingsError) {
        const extra = e.code === 'STALE_REV' ? { current: view(r.root, store) } : {};
        return res.status(e.status).json({ ok: false, code: e.code, error: e.message, ...(e.path ? { path: e.path } : {}), ...extra });
      }
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
      if (code === 'ENOSPC') return res.status(507).json({ ok: false, code: 'DISK_FULL', error: 'The disk is full, so the block settings could not be saved.' });
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') return res.status(500).json({ ok: false, code: 'NOT_WRITABLE', error: 'The block settings folder is not writable.' });
      return res.status(500).json({ ok: false, code: 'BLOCKS_FAILED', error: 'The block settings could not be read or saved.' });
    }
  };

  router.get('/', handle((store, req, root) => view(root, store)));

  router.put('/', handle((store, req, root) => {
    const b = isPlain(req.body) ? req.body : {};
    const rev = revFromHeader(req.get('if-match')) ?? (b.rev === undefined ? undefined : b.rev);
    store.update({ rev, blocks: b.blocks });
    return view(root, store);
  }));

  // A body the parser refused (bad JSON, over the request limit) gets a fixed answer that never echoes the body.
  router.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: err.type === 'entity.too.large' ? 'TOO_LARGE' : 'BAD_JSON', error: err.type === 'entity.too.large' ? 'That request is too large.' : 'The request body was not valid JSON.' });
    }
    return next(err);
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
