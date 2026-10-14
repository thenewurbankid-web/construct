// #950 -- one live Line LSP index per MCP server session (packages/engine/lsp/server.mjs createLineLsp): scoped, with
// the background indexer and the fs.watch watcher on. It starts on the session's first plan_* call, in the background
// (no call ever waits for its cold build), and run-next hands it the files a step saved. Only the plan tools start it:
// they already keep state under line/, while the line_* tools stay pure reads (the project byte-identical afterwards),
// and the index writes its cache to line/.index/. A project without a tsconfig.json has none. LINE_LSP_LIVE=off (or
// createConstructMcpServer({ liveIndex: false })) turns it off.
const indexes = new WeakMap(); // ctx -> { ready: Promise<lsp|null>, lsp: lsp|null }

/**
 * Whether the session keeps a live index.
 * @param {{liveIndex?: boolean}} ctx
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export const liveIndexOn = (ctx, env = process.env) => ctx.liveIndex !== false && String(env.LINE_LSP_LIVE ?? '').trim() !== 'off';

/**
 * Start (once) the session's live index; resolves to it, or null when the project cannot have one.
 * @param {{root: string, liveIndex?: boolean}} ctx The MCP server context.
 * @returns {Promise<any|null>}
 */
export function startLiveIndex(ctx) {
  if (!liveIndexOn(ctx)) return Promise.resolve(null);
  let slot = indexes.get(ctx);
  if (!slot) {
    slot = { ready: null, lsp: null };
    indexes.set(ctx, slot);
    const s = slot;
    s.ready = import('@line/construct-engine/lsp/server')
      .then(({ createLineLsp }) => createLineLsp(ctx.root, { background: true, watch: true }))
      .then((lsp) => { s.lsp = lsp; return lsp; })
      .catch(() => null);
  }
  return slot.ready;
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
