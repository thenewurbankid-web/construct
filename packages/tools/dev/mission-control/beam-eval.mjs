// Mission Control's "Beam eval" panel (#902): the planner eval of epic #900 (fit the request into the Trace map by
// parallel runs) per requirement: the beam's run tree live (tailing <runs>/<setup>/<item>/events.jsonl), the arms'
// readings, the final question / answer, the Opus-Grader's score + justification, the owner's score + note, agreement,
// and the setup summary (mean per judge, agreement rate, items disagreeing by >= 2 first) plus the deterministic metrics.
//
// Self-contained so the hooks in server.mjs and index.html stay one line each:
//   server.mjs   attachBeamEval(server, { every, timers, self })   wraps the request listener, adds one poller
//   index.html   <section class="panel" aria-label="Beam eval"> ... <script type="module" src="/beam-eval/panel.mjs">
//
// Routes (127.0.0.1 only, like the rest of Mission Control):
//   GET /beam-eval/panel.mjs     the panel's client module (beam-eval-panel.mjs)
//   GET /beam-eval/ui/beam.mjs   Trace's renderers (trace/src/ui/beam.mjs), reused as they are
//   GET /beam-eval/events        SSE: beam-trees (snapshot), beam-tree {setup, item, tree}, beam-results {at}
//   /api/beam/*                  Trace's eval API (trace/src/beam-routes.mjs): setups, setup view, owner grade, re-run
//                                (replay unless the server runs with TRACE_BEAM_LIVE=1), job status
// Data: trace/eval/beam/{results,runs} of this checkout; TRACE_BEAM_RESULTS / TRACE_BEAM_RUNS move them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The panel's server side, without an http server (tests drive `handle` and `scan` directly).
 * @param {{self: string, env?: NodeJS.ProcessEnv}} o  self = the checkout whose trace/ is served
 */
export async function createBeamEval({ self, env = process.env }) {
  const trace = path.join(self, 'trace');
  const { createBeamRoutes } = await import(pathToFileURL(path.join(trace, 'src/beam-routes.mjs')).href);
  const { beamDirs } = await import(pathToFileURL(path.join(trace, 'eval/beam/store.mjs')).href);
  const { treeOf } = await import(pathToFileURL(path.join(trace, 'eval/beam/beam-tree.mjs')).href);
  const route = createBeamRoutes({ examplesDir: path.join(trace, 'examples'), env });
  const dirs = beamDirs(env);
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  /** "<setup>/<item>" -> {sig, tree} */
  const trees = new Map();
  let resultsSig = null;

  const send = (res, type, data) => { try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); } };
  const broadcast = (type, data) => { for (const c of clients) send(c, type, data); };
  const sigOf = (p) => { try { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return null; } };
  const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

  /** One poll: every events.jsonl under runs/<setup>/<item>/ whose size or mtime changed is re-folded and pushed. */
  function scan() {
    const changed = [];
    for (const setup of ls(dirs.runsDir)) {
      for (const item of ls(path.join(dirs.runsDir, setup))) {
        const file = path.join(dirs.runsDir, setup, item, 'events.jsonl');
        const sig = sigOf(file);
        const key = `${setup}/${item}`;
        if (!sig || trees.get(key)?.sig === sig) continue;
        const tree = treeOf(fs.readFileSync(file, 'utf8'));
        trees.set(key, { sig, tree });
        changed.push({ setup, item, tree });
        broadcast('beam-tree', { setup, item, tree });
      }
    }
    const rs = ls(dirs.resultsDir).map((s) => `${s}:${sigOf(path.join(dirs.resultsDir, s, 'items.json'))}:${sigOf(path.join(dirs.resultsDir, s, 'owner.json'))}`).join('|');
    if (resultsSig !== null && rs !== resultsSig) broadcast('beam-results', { at: Date.now() });
    resultsSig = rs;
    return changed;
  }

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const file = (res, p, type) => {
    let b = null;
    try { b = fs.readFileSync(p); } catch { /* missing */ }
    res.writeHead(b ? 200 : 404, { 'content-type': b ? type : 'text/plain', 'cache-control': 'no-store' });
    res.end(b ?? 'not found');
  };
  const readBody = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });

  /** @returns {Promise<boolean>} true when the request was a Beam eval one */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    if (p === '/beam-eval/panel.mjs') { file(res, path.join(here, 'beam-eval-panel.mjs'), 'text/javascript'); return true; }
    if (p === '/beam-eval/ui/beam.mjs') { file(res, path.join(trace, 'src/ui/beam.mjs'), 'text/javascript'); return true; }
    if (p === '/beam-eval/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      send(res, 'beam-trees', [...trees].map(([k, v]) => { const [setup, item] = k.split('/'); return { setup, item, tree: v.tree }; }));
      req.on('close', () => clients.delete(res));
      return true;
    }
    if (p.startsWith('/api/beam/')) return route(req, res, url, { readBody, json, file });
    return false;
  }

  return { handle, scan, dirs, clients, trees };
}

/**
 * Hook the panel into Mission Control's server: Beam eval requests first, everything else to the original listener;
 * one poller (1 s) for the live trees and the results files.
 * @param {import('node:http').Server} server
 * @param {{every: (ms: number, fn: () => any) => any, timers: any[], self: string, env?: NodeJS.ProcessEnv}} o
 */
export async function attachBeamEval(server, { every, timers, self, env = process.env }) {
  let beam;
  try { beam = await createBeamEval({ self, env }); } catch (e) { console.error(`Mission Control: Beam eval panel off (${e.message})`); return null; }
  const orig = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    beam.handle(req, res).then((done) => { if (!done) for (const l of orig) l.call(server, req, res); })
      .catch((e) => { try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } catch { /* gone */ } });
  });
  timers.push(every(1000, async () => beam.scan()));
  return beam;
}
