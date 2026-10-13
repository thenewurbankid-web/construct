// Mission Control's run tailer: follows one bench run dir (logs/calls.jsonl, logs/turns.jsonl, and every other
// plain-file log as raw console lines) and turns what is new into a client delta. Node core only.
//
// Readers are isolated (#922): a directory under logs/ (turn-input/, turn-output/ since #913) is never tailed, and a
// reader that throws is reported once through onError and skipped for that pass, so the others (and the call rows)
// still load.
import fs from 'node:fs';
import path from 'node:path';
import { jsonlSplitter, joinRun, detectLoop, counters, timeline } from './bench-log.mjs';
import { isRealRun, runBanner } from './runs.mjs';

/** One tailed file: offset-based, survives partial lines, truncation and replacement (inode change). Non-files read as absent. */
export function fileTail(file, kind) {
  let offset = 0; let ino = null; const split = jsonlSplitter();
  return {
    file, kind,
    /** @returns {{reset: boolean, chunk: string}|null} */
    read() {
      let st;
      try { st = fs.statSync(file); } catch { st = null; }
      if (!st || !st.isFile()) { if (ino !== null) { ino = null; offset = 0; split.reset(); return { reset: true, chunk: '' }; } return null; }
      let reset = false;
      if (ino !== null && (st.ino !== ino || st.size < offset)) { offset = 0; split.reset(); reset = true; }
      ino = st.ino;
      if (st.size === offset) return reset ? { reset, chunk: '' } : null;
      const len = Math.min(st.size - offset, 16 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buf, 0, len, offset); } finally { fs.closeSync(fd); }
      // Never split a UTF-8 sequence: stop at the last newline for JSONL; raw logs take everything.
      let take = len;
      if (kind === 'jsonl') { const nl = buf.lastIndexOf(10); take = nl < 0 ? 0 : nl + 1; }
      offset += take;
      return { reset, chunk: buf.subarray(0, take).toString('utf8') };
    },
    split,
  };
}

/** The plain files under logs/ tailed as raw console lines (not JSON, not the prompt, never a directory). */
export function rawLogNames(logs) {
  let ents = [];
  try { ents = fs.readdirSync(logs, { withFileTypes: true }); } catch { return []; }
  return ents.filter((e) => e.isFile() && !e.name.endsWith('.jsonl') && !e.name.endsWith('.json') && e.name !== 'prompt.md').map((e) => e.name);
}

/**
 * Tails one run dir.
 * @param {string} dir
 * @param {{onChange?: () => void, onError?: (msg: string) => void, extraRoots?: string[]}} [opts]
 *   onChange: fs.watch fired on logs/; onError: a reader failed (called once per distinct message until it recovers);
 *   extraRoots: MC_RUNS roots, whose runs count as fixtures.
 */
export function runTailer(dir, { onChange = () => {}, onError = () => {}, extraRoots = [] } = {}) {
  const logs = path.join(dir, 'logs');
  const calls = fileTail(path.join(logs, 'calls.jsonl'), 'jsonl');
  const turns = fileTail(path.join(logs, 'turns.jsonl'), 'jsonl');
  const raws = new Map();
  const state = { calls: [], turns: [], rows: [], sent: new Map(), evSeen: new Set(), console: [], stuckKey: null, refusalTotal: 0, landed: 0, lastTurn: 0, ended: false };
  const failing = new Map(); // reader file -> last reported message
  let watcher = null;
  // fs.watch makes a write show within ~300 ms; the 1 s poll covers filesystems where watch misses events.
  try { watcher = fs.watch(logs, () => onChange()); } catch { /* polled anyway */ }

  /** Run one reader; a throw is reported once (per message) and the reader is skipped for this pass. */
  function guarded(t) {
    try {
      const r = t.read();
      failing.delete(t.file);
      return r;
    } catch (e) {
      const msg = `${path.basename(t.file)}: ${e.message}`;
      if (failing.get(t.file) !== msg) { failing.set(t.file, msg); onError(msg); }
      return null;
    }
  }

  function refreshRaws() {
    for (const n of rawLogNames(logs)) if (!raws.has(n)) raws.set(n, fileTail(path.join(logs, n), 'raw'));
  }

  /** Read what is new; returns the client payload delta or null. */
  function poll() {
    refreshRaws();
    let changed = false; let reset = false;
    for (const [t, arr] of [[calls, 'calls'], [turns, 'turns']]) {
      const r = guarded(t);
      if (!r) continue;
      if (r.reset) { state[arr] = []; reset = true; }
      const { records, bad } = t.split.push(r.chunk);
      if (records.length) { state[arr].push(...records); changed = true; }
      for (const b of bad) state.console.push({ file: path.basename(t.file), line: `[unparsed] ${b}` });
      if (r.reset) changed = true;
    }
    const lines = [];
    for (const [n, t] of raws) {
      const r = guarded(t);
      if (!r) continue;
      if (r.reset) lines.push({ file: n, line: '--- file reset ---' });
      for (const l of r.chunk.split('\n')) if (l.length) lines.push({ file: n, line: l.slice(0, 2000) });
    }
    if (lines.length) { state.console.push(...lines); if (state.console.length > 3000) state.console.splice(0, state.console.length - 3000); }
    if (!changed && !reset) return lines.length ? { console: lines } : null;
    if (reset) state.sent.clear();
    state.rows = joinRun(state.calls, state.turns);
    const upserts = [];
    const ids = new Set();
    for (const r of state.rows) {
      ids.add(r.id);
      const j = JSON.stringify(r);
      if (state.sent.get(r.id) !== j) { state.sent.set(r.id, j); upserts.push(r); }
    }
    const removed = [...state.sent.keys()].filter((k) => !ids.has(k));
    for (const k of removed) state.sent.delete(k);
    return { reset, upserts, removed, console: lines };
  }

  function growMtime() {
    let m = null;
    for (const f of [calls.file, turns.file]) { try { m = Math.max(m ?? 0, fs.statSync(f).mtimeMs); } catch { /* absent */ } }
    return m;
  }

  function summary() {
    const end = state.turns.find((t) => t?.kind === 'end');
    // MC_RUNS extras count as fixtures even when they look like a run dir: only discovered bench runs are real.
    const real = isRealRun(dir) && !extraRoots.some((r) => dir.startsWith(path.resolve(r) + path.sep));
    const banner = runBanner({ real, growMtime: growMtime(), endAt: end?.at ?? null, stop: end?.stop ?? null, nowMs: Date.now() });
    return { counters: counters(state.rows, state.turns, Date.now()), loop: detectLoop(state.rows), timeline: timeline(state.rows), banner };
  }

  /** Full detail of one row: the raw call record, its approval, the turn record (model output). */
  function detail(id) {
    const row = state.rows.find((r) => r.id === id);
    if (!row) return null;
    const callRecs = state.calls.filter((c) => c?.kind === 'call');
    const call = row.idx != null ? callRecs[row.idx] : null;
    const turn = row.turn != null ? state.turns.find((t) => t?.kind === 'turn' && t.turn === row.turn) ?? state.turns.find((t) => t?.kind === 'error' && t.turn === row.turn) : null;
    const approval = call?.result?.stepId ? state.calls.find((c) => c?.kind === 'approval' && c.stepId === call.result.stepId) : null;
    const outcome = turn?.calls?.find((o) => o && o.name && (row.cmd ? true : o.name === row.tool));
    return { row, call, approval, turn, outcome };
  }

  return { dir, state, poll, summary, detail, close() { try { watcher?.close(); } catch { /* closed */ } } };
}
