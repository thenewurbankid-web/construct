// Bench run discovery: every <root>/<name>/logs/ run dir, where a root is bench/ecommerce/runs/ in the main checkout or
// in a worktree. Only those are real runs. Anything else (MC_RUNS extras, mission-control's own fixtures) is listed
// as a replay so it can be picked by hand, and is never chosen as the auto (newest) run.
import fs from 'node:fs';
import path from 'node:path';

export const RUNS_REL = 'bench/ecommerce/runs';
const posix = (p) => p.split(path.sep).join('/');

/** True for a path that is a test fixture, never a benchmark run. */
export function isFixturePath(p) {
  return /\/(fixtures|__fixtures__)\//.test(`${posix(path.resolve(p))}/`) || /\/mission-control\//.test(posix(path.resolve(p)));
}

/** True for a run dir directly under a bench/ecommerce/runs/ folder and not a fixture. */
export function isRealRun(p) {
  const abs = posix(path.resolve(p));
  return !isFixturePath(abs) && posix(path.dirname(abs)).endsWith(`/${RUNS_REL}`);
}

/**
 * Every run dir, newest first: {path, name, where, mtime, real}. `extraRoots` are listed as replays.
 * @param {string} repo the main checkout @param {string[]} [extraRoots]
 */
export function discoverRuns(repo, extraRoots = []) {
  const roots = [path.join(repo, RUNS_REL)];
  const wtDir = path.join(repo, '.claude/worktrees');
  try { for (const w of fs.readdirSync(wtDir)) roots.push(path.join(wtDir, w, RUNS_REL)); } catch { /* no worktrees */ }
  const extra = new Set(extraRoots.filter(Boolean).map((r) => path.resolve(r)));
  roots.push(...extra);
  const out = []; const seen = new Set();
  for (const r of roots) {
    let names = [];
    try { names = fs.readdirSync(r); } catch { continue; }
    for (const n of names) {
      const dir = path.join(r, n);
      if (seen.has(dir)) continue;
      const logs = path.join(dir, 'logs');
      let mtime = 0; let growMtime = 0;
      try {
        for (const f of fs.readdirSync(logs)) {
          const s = fs.statSync(path.join(logs, f));
          if (!s.isFile()) continue;
          if (s.mtimeMs > mtime) mtime = s.mtimeMs;
          if ((f === 'calls.jsonl' || f === 'turns.jsonl') && s.mtimeMs > growMtime) growMtime = s.mtimeMs;
        }
      } catch { continue; }
      seen.add(dir);
      const rel = posix(path.relative(repo, r));
      const where = rel.startsWith('.claude/worktrees/') ? rel.split('/')[2] : rel.startsWith('..') ? path.basename(path.dirname(r)) : 'main';
      out.push({ path: dir, name: n, where, mtime, growMtime: growMtime || mtime, real: isRealRun(dir) && !extra.has(r) });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export const LIVE_WINDOW_MS = 2 * 60_000;

/**
 * The bench panel's status banner. FIXTURE when the run is not a real bench run (a mission-control fixture, an MC_RUNS
 * extra); LIVE when calls.jsonl/turns.jsonl grew in the last 2 minutes and there is no end record; otherwise REPLAY of
 * a finished (or abandoned) run, with when it ended: the turns.jsonl end record, else the last log growth.
 * @param {{real: boolean, growMtime: number|null, endAt?: string|null, stop?: string|null, nowMs: number}} s
 * @returns {{kind: 'live'|'replay'|'fixture'|'none', text: string}}
 */
export function runBanner(s) {
  if (s.growMtime == null && !s.endAt) return { kind: s.real ? 'none' : 'fixture', text: s.real ? 'NO DATA YET' : 'FIXTURE — not real data' };
  const endMs = s.endAt ? Date.parse(s.endAt) : s.growMtime;
  const when = `${new Date(endMs).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  if (!s.real) return { kind: 'fixture', text: `FIXTURE — not real data (logs last written ${when})` };
  if (!s.endAt && s.growMtime != null && s.nowMs - s.growMtime <= LIVE_WINDOW_MS) return { kind: 'live', text: 'LIVE — logs growing' };
  if (s.endAt) return { kind: 'replay', text: `REPLAY — finished run (ended ${when}${s.stop ? `: ${s.stop}` : ''})` };
  return { kind: 'replay', text: `REPLAY — finished run (ended ${when}; no end record, logs stopped growing)` };
}

/** The auto run: the newest real run (by its calls/turns log growth). Never a fixture or an extra root. */
export function pickAutoRun(runs) {
  return [...runs].filter((r) => r.real).sort((a, b) => b.growMtime - a.growMtime)[0] ?? null;
}
