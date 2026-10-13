// Mission Control "Context / jev" view (#899): for each refusal of a bench run, every context line the model was
// shown or could have been shown, with its static score (packages/engine/line/context/contextScore.mjs, reused), jev's shadow
// score when calls.jsonl logged one (#890), the rank under each, and KEPT/DROPPED under the adaptive cap (5, or 15
// once the same code repeats). Lines where static and jev disagree on kept/dropped are flagged.
//
// Sources, per call record (calls.jsonl, written by plan-cli.mjs):
//   logged         result.context {via, cap, repeat, attempt, candidates[{text, kind, keys, ref, score}], kept[]}
//                  (#886), result.fixes[{ref, sentence, why, effect, context}], result.card, result.spec,
//                  result.shown, and `shadow` {lines[{text, static, jev}], keptStatic, keptJev} or {unreachable} (#890).
//   reconstructed  older runs without result.context: the candidates are rebuilt from the refusal's summary fields with
//                  trace/tools/jev/contextLines.mjs (as jev's training data was), scored by the same static scorer,
//                  and the cap comes from in-run repeats of the same code and tool (bounded by hint-state.json when
//                  it sits next to calls.jsonl). No jev scores: the shadow was not logged then.
//
// buildContextView is pure (the test feeds it a fixture); readContextView and handleContextRoute do the I/O for
// server.mjs (one route: /ctx/api?run= and /ctx/view.js, the client script).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankLines, scoreLine, capFor } from '../../../engine/line/context/contextScore.mjs';
import { candidateLines, attemptText } from '../../../../trace/tools/jev/contextLines.mjs';
import { jsonlSplitter, joinRun } from './bench-log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The call record as contextLines.mjs reads an action's call. */
const asCall = (c) => ({ cmd: String(c.cmd ?? ''), args: c.args, why: typeof c.args?.why === 'string' ? c.args.why : '', result: c.result ?? {} });

/**
 * Refusal counts per code from hint-state.json ({"<plan>|<code>|<target>": n}): the most any one target saw it.
 * @param {Record<string, number>|null|undefined} hs
 * @returns {Map<string, number>|null}
 */
export function hintTotals(hs) {
  if (!hs || typeof hs !== 'object') return null;
  const m = new Map();
  for (const [k, n] of Object.entries(hs)) {
    const code = k.split('|')[1];
    if (code && typeof n === 'number') m.set(code, Math.max(m.get(code) ?? 0, n));
  }
  return m;
}

/**
 * Rank a turn's candidate lines under static and (when every line has one) jev scores, and join the two.
 * @param {{text: string, kind: string, keys?: string[], ref?: string|null, score?: number}[]} candidates
 * @param {{attempt?: string, cap: number, jev?: (number|null)[] | null, shown?: string[] | null}} o
 */
export function joinScores(candidates, o) {
  const lines = candidates.map((l, i) => ({ ...l, _k: i }));
  const stat = rankLines(lines, { cap: o.cap, score: (l) => (typeof l.score === 'number' ? l.score : scoreLine(l, { attempt: o.attempt })) });
  const hasJev = Array.isArray(o.jev) && o.jev.length === lines.length && o.jev.every((x) => typeof x === 'number');
  const jv = hasJev ? rankLines(lines, { cap: o.cap, score: (l) => /** @type {number[]} */ (o.jev)[l._k] }) : null;
  const sRank = new Map(stat.ranked.map((l, r) => [l._k, r + 1]));
  const sScore = new Map(stat.ranked.map((l) => [l._k, l.score]));
  const sKept = new Set(stat.kept.map((l) => l._k));
  const jRank = jv ? new Map(jv.ranked.map((l, r) => [l._k, r + 1])) : null;
  const jKept = jv ? new Set(jv.kept.map((l) => l._k)) : null;
  const shown = o.shown ? new Set(o.shown) : null;
  return lines.map((l) => {
    const keptStatic = sKept.has(l._k);
    const keptJev = jKept ? jKept.has(l._k) : null;
    return {
      i: l._k, text: l.text, kind: l.kind, ref: l.ref ?? null,
      static: sScore.get(l._k), staticRank: sRank.get(l._k), keptStatic,
      jev: hasJev ? /** @type {number[]} */ (o.jev)[l._k] : null, jevRank: jRank ? jRank.get(l._k) : null, keptJev,
      disagree: keptJev !== null && keptJev !== keptStatic,
      // Logged runs say what was kept; a static keep that differs from it means the scorer changed since the run.
      shown: shown ? shown.has(l.text) : keptStatic,
    };
  }).sort((a, b) => a.staticRank - b.staticRank);
}

/**
 * The view of one run: an entry per refusal (logged context, or reconstructed for older runs) and a run summary.
 * @param {{calls: any[], turns?: any[], hintState?: Record<string, number>|null}} run
 */
export function buildContextView({ calls, turns = [], hintState = null }) {
  const recs = calls.filter((c) => c?.kind === 'call');
  const rowOf = new Map(joinRun(calls, turns).filter((r) => r.idx != null).map((r) => [r.idx, r]));
  const totals = hintTotals(hintState);
  const seen = new Map();
  const entries = [];
  recs.forEach((c, idx) => {
    const r = c.result ?? {};
    const ctx = r.context;
    const row = rowOf.get(idx);
    const key = `${r.code}|${r.tool ?? c.cmd}`;
    const before = r.ok === false ? seen.get(key) ?? 0 : 0;
    if (r.ok === false) seen.set(key, before + 1);
    const base = {
      idx, rowId: row?.id ?? `c${idx}`, turn: row?.turn ?? null, at: c.at ?? null, cmd: c.cmd, tool: r.tool ?? null, code: r.code ?? null,
      shownText: r.shown ?? null,
      fixes: (r.fixes ?? []).map((f) => ({ ref: f.ref ?? null, sentence: f.sentence ?? '', recommended: f.recommended === true, why: f.why ?? null, effect: f.effect ?? null, context: f.context ?? null })),
      card: r.card ?? null, spec: r.spec ?? null,
    };
    if (ctx && Array.isArray(ctx.candidates)) {
      const sh = c.shadow;
      const jev = sh && !sh.unreachable && Array.isArray(sh.lines)
        ? ctx.candidates.map((l, i) => (sh.lines[i]?.text === l.text ? sh.lines[i].jev : sh.lines.find((x) => x.text === l.text)?.jev ?? null))
        : null;
      let cap = ctx.cap; let capSource = 'logged';
      if (typeof cap !== 'number') { cap = capFor(ctx.repeat ?? 0); capSource = 'repeat'; }
      const lines = joinScores(ctx.candidates, { attempt: ctx.attempt, cap, jev, shown: Array.isArray(ctx.kept) ? ctx.kept.map((k) => k.text) : null });
      entries.push({ ...base, source: 'logged', via: ctx.via ?? 'static', attempt: ctx.attempt ?? '', cap, capSource, repeat: ctx.repeat ?? null,
        jev: sh ? (sh.unreachable ? 'unreachable' : 'logged') : 'none', jevMs: sh?.ms ?? null, lines });
      return;
    }
    if (r.ok !== false) return;
    const action = { calls: [asCall(c)] };
    const cands = candidateLines(action, `r${idx}`);
    if (!cands.length) return;
    // Repeats: earlier refusals of the same code and tool in this run; hint-state.json (when present) bounds them by
    // what Line counted per target, so a code that never repeated for one target keeps the cap at 5.
    let repeat = before; let capSource = 'run';
    if (totals) { repeat = Math.min(before, Math.max(0, (totals.get(String(r.code)) ?? 0) - 1)); capSource = 'hint-state'; }
    const cap = capFor(repeat);
    const attempt = attemptText(action);
    entries.push({ ...base, source: 'reconstructed', via: 'static', attempt, cap, capSource, repeat, jev: 'none', jevMs: null,
      lines: joinScores(cands, { attempt, cap }) });
  });
  return { entries, summary: summarize(entries) };
}

/** Lines shown, kept %, static-vs-jev disagreement % (over lines jev scored), and the source mix. */
export function summarize(entries) {
  let candidates = 0; let shown = 0; let jevLines = 0; let disagree = 0; let drift = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      candidates += 1;
      if (l.shown) shown += 1;
      if (l.keptJev !== null) { jevLines += 1; if (l.disagree) disagree += 1; }
      if (e.source === 'logged' && l.shown !== l.keptStatic) drift += 1;
    }
  }
  const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null);
  return {
    refusals: entries.length,
    logged: entries.filter((e) => e.source === 'logged').length,
    reconstructed: entries.filter((e) => e.source === 'reconstructed').length,
    jevLogged: entries.filter((e) => e.jev === 'logged').length,
    jevUnreachable: entries.filter((e) => e.jev === 'unreachable').length,
    candidates, shown, keptPct: pct(shown, candidates), jevLines, disagree, disagreePct: pct(disagree, jevLines),
    // Logged kept lines the static scorer would not keep today (the scorer changed since the run): 0 normally.
    drift,
  };
}

const readJsonl = (f) => { try { return jsonlSplitter().push(`${fs.readFileSync(f, 'utf8')}\n`).records; } catch { return []; } };

/**
 * Read one run dir's logs and build its view.
 * @param {string} dir a run dir (with logs/calls.jsonl)
 */
export function readContextView(dir) {
  const logs = path.join(dir, 'logs');
  const calls = readJsonl(path.join(logs, 'calls.jsonl'));
  const turns = readJsonl(path.join(logs, 'turns.jsonl'));
  let hintState = null;
  try { hintState = JSON.parse(fs.readFileSync(path.join(logs, 'hint-state.json'), 'utf8')); } catch { /* older run, or no refusal yet */ }
  return { run: dir, hintState: Boolean(hintState), ...buildContextView({ calls, turns, hintState }) };
}

/**
 * server.mjs's one route: /ctx/view.js (the client script) and /ctx/api?run= (the view as JSON).
 * @param {URL} u @param {import('node:http').ServerResponse} res @param {(run: string|null) => string|null} resolveRun
 */
export function handleContextRoute(u, res, resolveRun) {
  if (u.pathname === '/ctx/view.js') {
    let b = null;
    try { b = fs.readFileSync(path.join(here, 'context-view.client.js')); } catch { /* missing */ }
    res.writeHead(b ? 200 : 404, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(b ?? '');
    return;
  }
  if (u.pathname === '/ctx/api') {
    const dir = resolveRun(u.searchParams.get('run'));
    let body;
    try { body = dir ? readContextView(dir) : null; } catch (e) { body = { error: /** @type {Error} */ (e).message }; }
    res.writeHead(body && !body.error ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body ?? { error: 'no such run' }));
    return;
  }
  res.writeHead(404); res.end('not found');
}
