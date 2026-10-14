// #950 -- one live Line LSP index per MCP server session (packages/engine/lsp/server.mjs createLineLsp), scoped. It
// starts on the session's first line_* or plan_* call, in the background (no call ever waits for its cold build).
//   line_* (mode 'read')   READ-ONLY: stored entries are read, misses computed in memory, NOTHING is written (no store
//                          entry, no background indexer, no watcher), so the project stays byte-identical.
//   plan_* (mode 'write')  read-write: the first plan_* call switches the session's index (makeWritable: the in-memory
//                          misses are flushed to line/.index/, then the background indexer and the watcher start);
//                          run-next hands it the files a step saved.
// A project without a tsconfig.json has none. LINE_LSP_LIVE=off (or createConstructMcpServer({ liveIndex: false })) turns it off.
const indexes = new WeakMap(); // ctx -> { ready: Promise<lsp|null>, lsp: lsp|null, writable: Promise|null }

/**
 * Whether the session keeps a live index.
 * @param {{liveIndex?: boolean}} ctx
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export const liveIndexOn = (ctx, env = process.env) => ctx.liveIndex !== false && String(env.LINE_LSP_LIVE ?? '').trim() !== 'off';

/**
 * Start (once) the session's live index; resolves to it, or null when the project cannot have one. `mode` 'read'
 * builds it read-only; 'write' builds it read-write, or switches a read-only one (flush, then background + watcher).
 * @param {{root: string, liveIndex?: boolean}} ctx The MCP server context.
 * @param {'read'|'write'} [mode]
 * @returns {Promise<any|null>}
 */
export function startLiveIndex(ctx, mode = 'write') {
  if (!liveIndexOn(ctx)) return Promise.resolve(null);
  let slot = indexes.get(ctx);
  if (!slot) {
    slot = { ready: null, lsp: null, writable: null };
    indexes.set(ctx, slot);
    const s = slot;
    const write = mode === 'write';
    s.ready = import('@line/construct-engine/lsp/server')
      .then(({ createLineLsp }) => createLineLsp(ctx.root, write ? { background: true, watch: true } : { readOnly: true, background: true, watch: true }))
      .then((lsp) => { s.lsp = lsp; return lsp; })
      .catch(() => null);
    if (write) s.writable = s.ready;
    return s.ready;
  }
  if (mode === 'write' && !slot.writable) {
    const s = slot;
    s.writable = s.ready.then(async (lsp) => { if (lsp?.readOnly) { try { await lsp.makeWritable(); } catch { /* stays read-only */ } } return lsp; });
    return s.writable;
  }
  return mode === 'write' ? slot.writable : slot.ready;
}

/**
 * The session's live index when it is built, else null (never waits for a cold build).
 * @param {{root: string}} ctx
 * @returns {any|null}
 */
export const liveIndexNow = (ctx) => indexes.get(ctx)?.lsp ?? null;

/**
 * Stop the session's background indexer and watcher.
 * @param {{root: string}} ctx
 */
export function stopLiveIndex(ctx) { indexes.get(ctx)?.lsp?.close?.(); indexes.delete(ctx); }
