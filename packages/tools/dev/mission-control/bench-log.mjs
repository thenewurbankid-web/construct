// Pure parsing for a bench run's logs (no I/O, no clock): the JSONL line splitter that survives partial lines, the
// join of calls.jsonl (one record per CLI call, written by plan-cli.mjs / plain-cli.mjs) with turns.jsonl (one record
// per model turn, written by qwen-agent.mjs), the counters, the timeline and the loop detector. server.mjs feeds it
// bytes; mission-control.test.mjs feeds it a fixture.
//
// calls.jsonl  {at, builder, kind: 'call', cmd, args, ms, bytes?, result: {ok, code, sentence, stepId, state, landed,
//              tool, rules}}  and  {at, builder, kind: 'approval', stepId, tool, approvedBy, mechanism}
// turns.jsonl  {kind: 'start', at, builder, model, arm, maxTurns, maxMinutes, numCtx}
//              {kind: 'turn', turn, in, out, ms, evalMs, promptMs, textCalls, calls: [{name, args, ok, code, sentence}], said}
//              {kind: 'error', turn, ms, error}   {kind: 'end', at, turns, wallMs, stop}

/** Model tool name (qwen-agent TOOLS) -> the CLI command it records in calls.jsonl. */
export const TOOL_TO_CMD = {
  plan_tools: 'tools', plan_status: 'status', plan_add: 'add', plan_run_next: 'run-next', plan_findings: 'findings',
  plan_validate: 'validate', read_file: 'read', list_dir: 'ls', tree: 'tree', write_file: 'write', run_script: 'run', plan_rules: 'rules',
};

/**
 * A line splitter over appended chunks: keeps the trailing partial line until its newline arrives.
 * @returns {{push: (chunk: string) => {records: any[], bad: string[]}, reset: () => void, pending: () => string}}
 */
export function jsonlSplitter() {
  let rest = '';
  return {
    push(chunk) {
      const text = rest + chunk;
      const lines = text.split('\n');
      rest = lines.pop() ?? '';
      const records = []; const bad = [];
      for (const l of lines) {
        const s = l.trim();
        if (!s) continue;
        try { records.push(JSON.parse(s)); } catch { bad.push(s.slice(0, 200)); }
      }
      return { records, bad };
    },
    reset() { rest = ''; },
    pending() { return rest; },
  };
}

const short = (v, n = 90) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** The tool label of one call record: "add line.setCode" for add, else the cmd. */
export function callTool(c) {
  return c.cmd === 'add' ? `add ${c.args?.tool ?? c.result?.tool ?? '?'}` : String(c.cmd ?? '?');
}

/** The short args of one call record. */
export function callArgs(c) {
  if (c.cmd === 'add') {
    const a = c.args?.args;
    if (a && typeof a === 'object') {
      // The identifying fields first (name, file, id, stepId, fixOf), then the rest.
      const keys = Object.keys(a);
      const first = ['fixOf', 'stepId', 'name', 'feature', 'file', 'path', 'id', 'item'].filter((k) => keys.includes(k));
      const order = [...first, ...keys.filter((k) => !first.includes(k))];
      return short(order.map((k) => `${k}=${short(a[k], 40)}`).join(' '));
    }
    return short(a);
  }
  if (Array.isArray(c.args)) return short(c.args.join(' '));
  return short(c.args);
}

/** Status of one call: landed | not-landed | refused | error | ok. */
export function callStatus(c) {
  const r = c.result ?? {};
  if (r.code === 'CRASH') return { status: 'error', code: 'CRASH' };
  if (r.ok === false) return { status: 'refused', code: r.code ?? 'REFUSED' };
  if (r.landed === true) return { status: 'landed', code: null };
  if (r.landed === false) return { status: 'not-landed', code: r.state ?? null };
  return { status: 'ok', code: null };
}

/**
 * Join calls.jsonl and turns.jsonl into one row per call (plus one row per turn without a call, per finish and per
 * model error). Calls are matched to turns in order: each turn's outcomes (except finish and unknown tools, which never
 * reach the CLI) consume the next call records. Calls past the last turn record belong to the turn in progress.
 * Runs without turns.jsonl (Claude builders) get one row per call with turn = null.
 * @param {any[]} calls records from calls.jsonl (any kind) @param {any[]} turns records from turns.jsonl
 */
export function joinRun(calls, turns) {
  const callRecs = []; const approvals = new Map();
  for (const c of calls) {
    if (c?.kind === 'call') callRecs.push(c);
    else if (c?.kind === 'approval' && c.stepId) approvals.set(c.stepId, c);
  }
  const rows = [];
  const mk = (c, i, turn, t, outcome) => {
    const st = callStatus(c);
    const add = c.cmd === 'add' && c.args?.args && typeof c.args.args === 'object' ? c.args.args : null;
    return {
      id: `c${i}`, idx: i, at: c.at ?? null, turn, tool: callTool(c), cmd: c.cmd, args: callArgs(c), status: st.status, code: st.code,
      stepId: c.result?.stepId ?? null, rules: c.result?.rules ?? [], sentence: short(c.result?.sentence ?? '', 240),
      callMs: c.ms ?? null, modelMs: t?.ms ?? null, tokIn: null, tokOut: null, textCalls: t?.textCalls ?? null,
      fix: Boolean((add && (add.fixOf || c.args?.tool === 'line.leaveAsIs')) || (c.cmd === 'add' && c.args?.fix)), approved: Boolean(c.result?.stepId && approvals.has(c.result.stepId)),
      mismatch: outcome && outcome.name && TOOL_TO_CMD[outcome.name] !== c.cmd ? outcome.name : null,
    };
  };
  let ci = 0;
  let lastTurn = 0;
  for (const t of turns) {
    if (t?.kind === 'error') {
      rows.push({ id: `e${t.turn}`, idx: null, at: null, turn: t.turn, tool: 'model', cmd: null, args: '', status: 'error', code: 'MODEL_ERROR', sentence: short(t.error ?? '', 240), callMs: null, modelMs: t.ms ?? null, tokIn: null, tokOut: null, rules: [] });
      continue;
    }
    if (t?.kind !== 'turn') continue;
    lastTurn = t.turn;
    const first = rows.length;
    for (const o of t.calls ?? []) {
      if (o.name === 'finish') { rows.push({ id: `f${t.turn}`, idx: null, at: null, turn: t.turn, tool: 'finish', cmd: null, args: '', status: 'finish', code: null, sentence: '', callMs: null, modelMs: t.ms, rules: [] }); continue; }
      if (!TOOL_TO_CMD[o.name]) { rows.push({ id: `u${t.turn}-${rows.length}`, idx: null, at: null, turn: t.turn, tool: String(o.name ?? '?'), cmd: null, args: short(o.args ?? ''), status: 'refused', code: o.code ?? 'UNKNOWN_TOOL', sentence: short(o.sentence ?? '', 240), callMs: null, modelMs: t.ms, rules: [] }); continue; }
      if (ci < callRecs.length) { rows.push(mk(callRecs[ci], ci, t.turn, t, o)); ci += 1; }
    }
    if (rows.length === first) rows.push({ id: `n${t.turn}`, idx: null, at: null, turn: t.turn, tool: '(no tool call)', cmd: null, args: short(t.said ?? '', 90), status: 'idle', code: null, sentence: '', callMs: null, modelMs: t.ms, rules: [] });
    // Turn tokens sit on the turn's first row (one model call per turn).
    rows[first].tokIn = t.in ?? null; rows[first].tokOut = t.out ?? null; rows[first].turnFirst = true;
  }
  const live = turns.some((t) => t?.kind === 'turn' || t?.kind === 'start');
  for (; ci < callRecs.length; ci += 1) rows.push(mk(callRecs[ci], ci, live ? lastTurn + 1 : null, null, null));
  // Runs without turns: number the calls as the turn axis so the timeline still works.
  if (!live) rows.forEach((r, i) => { r.seq = i + 1; });
  return rows;
}

/**
 * The repeating tail: the same tool and the same refusal code `min` or more times in a row. Returns the current run
 * (at the end of the rows) and the longest run seen.
 * @param {any[]} rows from joinRun @param {number} [min]
 */
export function detectLoop(rows, min = 5) {
  const key = (r) => (r.status === 'refused' || r.status === 'error' || r.status === 'not-landed' ? `${r.tool}|${r.code ?? r.status}` : null);
  let cur = { key: null, count: 0, from: -1 };
  let longest = { key: null, count: 0, from: -1 };
  const runs = [];
  rows.forEach((r, i) => {
    const k = key(r);
    if (k && k === cur.key) cur.count += 1; else cur = { key: k, count: k ? 1 : 0, from: i };
    if (cur.count > longest.count) longest = { ...cur };
    if (k && cur.count === min) runs.push({ ...cur });
  });
  const stuck = cur.key && cur.count >= min;
  const pick = (c) => (c.key ? { tool: c.key.split('|')[0], code: c.key.split('|')[1], count: c.count, fromRow: rows[c.from]?.id ?? null, lastRow: rows[c.from + c.count - 1]?.id ?? null, sample: rows[c.from + c.count - 1] ?? null } : null);
  return { stuck: Boolean(stuck), current: stuck ? pick(cur) : null, longest: longest.count >= 2 ? pick(longest) : null, loops: runs.length };
}

/**
 * Counters for the header: turns, elapsed, steps, refusals by code, typed-fix uses, validate/tsc, tokens.
 * @param {any[]} rows @param {any[]} turns @param {number} nowMs
 */
export function counters(rows, turns, nowMs) {
  const start = turns.find((t) => t?.kind === 'start');
  const end = turns.find((t) => t?.kind === 'end');
  const turnRecs = turns.filter((t) => t?.kind === 'turn');
  const refusals = {};
  let added = 0; let landed = 0; let notLanded = 0; let fixes = 0; let leaveAsIs = 0; let errors = 0; let tokIn = 0; let tokOut = 0;
  let validate = null; let tscRefusals = 0; let textCalls = 0;
  for (const r of rows) {
    if (r.status === 'refused' || r.status === 'error') { refusals[r.code ?? r.status] = (refusals[r.code ?? r.status] ?? 0) + 1; }
    if (r.status === 'error') errors += 1;
    if (r.cmd === 'add' && r.status !== 'refused' && r.status !== 'error') added += 1;
    if (r.status === 'landed') landed += 1;
    if (r.status === 'not-landed') notLanded += 1;
    if (r.fix) { if (/leaveAsIs/.test(r.tool)) leaveAsIs += 1; else fixes += 1; }
    if ((r.rules ?? []).some((x) => /tsc|^TS\d/i.test(x))) tscRefusals += 1;
    if (r.cmd === 'validate' && r.status === 'ok') { const m = /(\d+) errors?, (\d+) warnings?/.exec(r.sentence ?? ''); if (m) validate = { errors: Number(m[1]), warnings: Number(m[2]), at: r.at }; }
    if (r.cmd === 'run' && /tsc/.test(r.args ?? '')) { const m = /(\d+) errors?/.exec(r.sentence ?? ''); tscRefusals += r.status === 'refused' ? 1 : 0; if (m) validate = { errors: Number(m[1]), warnings: null, at: r.at, tsc: true }; }
  }
  for (const t of turnRecs) { tokIn += t.in ?? 0; tokOut += t.out ?? 0; if (t.textCalls) textCalls += 1; }
  const firstAt = start?.at ?? rows.find((r) => r.at)?.at ?? null;
  const lastAt = end?.at ?? null;
  const lastRowAt = [...rows].reverse().find((r) => r.at)?.at ?? null;
  const t0 = firstAt ? Date.parse(firstAt) : null;
  const elapsedMs = t0 == null ? null : (lastAt ? Date.parse(lastAt) : nowMs) - t0;
  return {
    builder: start?.builder ?? null, model: start?.model ?? null, arm: start?.arm ?? null,
    turn: turnRecs.length ? turnRecs[turnRecs.length - 1].turn : null, maxTurns: start?.maxTurns ?? 200,
    elapsedMs, maxMinutes: start?.maxMinutes ?? 90, finished: Boolean(end), stop: end?.stop ?? null,
    calls: rows.filter((r) => r.cmd).length, added, landed, notLanded, refusals, fixes, leaveAsIs, errors, validate, tscRefusals,
    tokIn, tokOut, textCalls, lastActivity: lastAt ?? lastRowAt,
  };
}

const RANK = { error: 5, 'not-landed': 4, refused: 3, landed: 2, finish: 2, ok: 1, idle: 0 };

/** One cell per turn (or per call when the run has no turns), the worst-or-best outcome: landed wins, then error. */
export function timeline(rows) {
  const byTurn = new Map();
  for (const r of rows) {
    const k = r.turn ?? r.seq;
    if (k == null) continue;
    const prev = byTurn.get(k);
    const s = r.status;
    // A landed step makes the turn green even if a read in the same turn was refused.
    const pick = !prev ? s : prev === 'landed' || s === 'landed' ? 'landed' : RANK[s] > RANK[prev] ? s : prev;
    byTurn.set(k, pick);
  }
  return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, status]) => ({ turn, status }));
}
