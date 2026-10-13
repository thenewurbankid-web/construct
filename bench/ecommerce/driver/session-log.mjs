// #932 the layered session log: logs/session.jsonl, one event per line, append-only, in English, indexing what each
// Line layer did in a builder run. It does not replace turns.jsonl, calls.jsonl or turn-input/turn-output: it points
// at them (a coder event names its turn-input/<n>.json), so the model can ask what happened without the history in
// its context, through the read-only `session_log` tool. Deterministic, no model call.
//
// Event: {turn, at, layer, kind, english (one sentence), ref (file, step, point or log file), detail?}
// Layers: seed, open-work, coder, tool, gate, refusal, plan, context, ledger, scratch, research (once it lands).
//
//   createSessionLog({file})         {events, add(e)}: appends to the file and keeps the events in memory
//   toolEvents(turn, name, args, out) the tool, refusal, gate and plan events one tool call gives (pure)
//   sessionLogSlice(events, q)       the small English slice the tool answers: filters layer/turn/ref/query, newest
//                                    first, `limit` events (10), at most SLICE_CAP characters
//   SESSION_LOG_TOOL                 the tool schema; selectTurnTools(base, {refused}) offers it after a refusal
import fs from 'node:fs';
import path from 'node:path';

export const SLICE_CAP = 1500;
export const LAYERS = Object.freeze(['seed', 'open-work', 'coder', 'tool', 'gate', 'refusal', 'plan', 'context', 'ledger', 'scratch', 'research']);

/** @typedef {{turn: number, at?: string, layer: string, kind: string, english: string, ref?: string|null, detail?: any}} SessionEvent */

const one = (s, n = 240) => { const l = String(s ?? '').split('\n').find((x) => x.trim()) ?? ''; return l.length > n ? `${l.slice(0, n - 3)}...` : l; };

/**
 * An append-only session log backed by `file` (logs/session.jsonl).
 * @param {{file?: string|null}} [o]
 * @returns {{events: SessionEvent[], add: (e: SessionEvent) => SessionEvent}}
 */
export function createSessionLog({ file = null } = {}) {
  /** @type {SessionEvent[]} */
  const events = [];
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    events,
    add(e) {
      const ev = { turn: e.turn, at: e.at ?? new Date().toISOString(), layer: e.layer, kind: e.kind, english: one(e.english, 400), ref: e.ref ?? null, ...(e.detail !== undefined ? { detail: e.detail } : {}) };
      events.push(ev);
      if (file) fs.appendFileSync(file, `${JSON.stringify(ev)}\n`);
      return ev;
    },
  };
}

const fileOf = (args) => {
  const a = args?.args && typeof args.args === 'object' ? args.args : args ?? {};
  return [a.file, a.page, a.path].find((x) => typeof x === 'string' && x) ?? null;
};

/**
 * The events one tool call gives: the call and its result (tool), a refusal with its example fix (refusal), the type
 * errors and rule findings it reports (gate), and plan changes (plan). Pure.
 * @param {number} turn @param {string} name @param {any} args @param {any} out
 * @returns {SessionEvent[]}
 */
export function toolEvents(turn, name, args, out) {
  const tool = name === 'plan_add' ? String(args?.tool ?? 'plan_add') : name;
  const ref = fileOf(args) ?? (out?.stepId ? String(out.stepId) : null);
  const ok = out?.ok !== false;
  /** @type {SessionEvent[]} */
  const ev = [{ turn, layer: 'tool', kind: name, english: `${name}${tool !== name ? ` ${tool}` : ''}${ref ? ` on ${ref}` : ''}: ${ok ? 'ok' : `refused (${out?.code})`}; ${one(out?.sentence, 200)}`, ref }];
  if (!ok) {
    const said = String(out?.sentence ?? '');
    const fix = /Example fix for line \d+[^\n]*/.exec(said)?.[0] ?? null;
    ev.push({ turn, layer: 'refusal', kind: String(out?.code ?? 'REFUSED'), english: `${tool}${ref ? ` on ${ref}` : ''} was refused with ${out?.code}${fix ? `; ${fix}` : ''}.`, ref, ...(fix ? { detail: { exampleFix: fix } } : {}) });
  }
  for (const l of String(out?.detail ?? '').split('\n')) {
    const m = /^(\S+):(\d+) (TS\d+|ROUTE_PROPS) (.*)$/.exec(l);
    if (m) ev.push({ turn, layer: 'gate', kind: 'tsc', english: `tsc ${m[3]} at ${m[1]} line ${m[2]}: ${m[4]}`, ref: m[1] });
  }
  for (const f of Array.isArray(out?.findings) ? out.findings : []) ev.push({ turn, layer: 'gate', kind: 'rule', english: `${f.rule ?? 'rule'} (${f.severity ?? 'finding'}) at ${f.file ?? '-'}${f.line ? ` line ${f.line}` : ''}: ${one(f.sentence, 200)}`, ref: f.file ?? null });
  for (const c of Array.isArray(out?.checks) ? out.checks : []) if (c && typeof c === 'object') ev.push({ turn, layer: 'gate', kind: 'check', english: `Check ${c.name ?? c.id ?? '-'}: ${c.ok === false ? 'failed' : 'passed'}${c.sentence ? `; ${one(c.sentence, 160)}` : ''}`, ref });
  if (name === 'plan_validate' && out) ev.push({ turn, layer: 'gate', kind: 'validate', english: `construct validate: ${one(out.sentence, 200)}`, ref: null });
  if (name === 'plan_add' && ok && out?.stepId) ev.push({ turn, layer: 'plan', kind: 'added', english: `Step ${out.stepId} (${tool}${ref ? ` on ${ref}` : ''}) joined the plan${out.approvedBy ? `, approved by ${out.approvedBy}` : ''}.`, ref: String(out.stepId) });
  if (name === 'plan_run_next' && ok && out?.stepId) ev.push({ turn, layer: 'plan', kind: out.landed ? 'landed' : 'ran', english: `Step ${out.stepId} (${out.tool}) ran and ${out.landed ? `landed${(out.files ?? []).length ? `, writing ${out.files.join(', ')}` : ''}` : `did not land (${out.state})`}.`, ref: String(out.stepId) });
  return ev;
}

/**
 * The slice the session_log tool answers: events matching every given filter, newest first, at most `limit` (10),
 * cut at SLICE_CAP characters.
 * @param {SessionEvent[]} events @param {{layer?: unknown, turn?: unknown, ref?: unknown, query?: unknown, limit?: unknown}} [q]
 * @returns {{ok: true, count: number, shown: number, sentence: string}}
 */
export function sessionLogSlice(events, q = {}) {
  const limit = Number.isInteger(q.limit) && Number(q.limit) > 0 ? Math.min(Number(q.limit), 50) : 10;
  const words = typeof q.query === 'string' && q.query.trim() ? q.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2) : [];
  const hit = events.filter((e) => (typeof q.layer !== 'string' || !q.layer || e.layer === q.layer)
    && (q.turn === undefined || q.turn === null || q.turn === '' || e.turn === Number(q.turn))
    && (typeof q.ref !== 'string' || !q.ref || String(e.ref ?? '').includes(q.ref) || e.english.includes(q.ref))
    && (!words.length || words.every((w) => `${e.english} ${e.ref ?? ''} ${e.layer}`.toLowerCase().includes(w))));
  const lines = [];
  let chars = 0;
  for (const e of [...hit].reverse().slice(0, limit)) {
    const l = `- turn ${e.turn}, ${e.layer}: ${e.english}${e.ref ? ` [${e.ref}]` : ''}`;
    if (chars + l.length + 1 > SLICE_CAP) break;
    lines.push(l); chars += l.length + 1;
  }
  const head = hit.length ? `Session log: ${hit.length} event${hit.length === 1 ? '' : 's'} match, newest first (${lines.length} shown):` : 'Session log: no event matches.';
  return { ok: true, count: hit.length, shown: lines.length, sentence: [head, ...lines].join('\n') };
}

const S = (description) => ({ type: 'string', description });
/** The read-only session_log tool (registered for the per-turn read-tool selection). */
export const SESSION_LOG_TOOL = Object.freeze({ type: 'function', function: { name: 'session_log', description: 'Read-only: what happened earlier in this run, in English, newest first (10 events by default). Filter by layer (seed, open-work, coder, tool, gate, refusal, plan, context, ledger, scratch), turn, ref (a file, step or point) or query words, e.g. {"layer": "gate", "ref": "PicksPage"} or {"turn": 9}.', parameters: { type: 'object', properties: { layer: { type: 'string', enum: [...LAYERS] }, turn: { type: 'integer', description: 'One turn number' }, ref: S('A file, step id or point id, or part of one'), query: S('Words the events must contain'), limit: { type: 'integer', description: 'How many events (default 10)' } }, required: [] } } });

/** Read tools a turn may be offered, by name (line/coder-read-tools' selectReadTools picks from these). */
export const READ_TOOL_REGISTRY = Object.freeze({ session_log: SESSION_LOG_TOOL });

/**
 * The tools of one turn: `base`, plus session_log after a refusal (the default selection until a read-tool selector
 * is plugged in).
 * @param {any[]} base @param {{refused?: boolean}} [o]
 * @returns {any[]}
 */
export function selectTurnTools(base, { refused = false } = {}) {
  return refused && !base.some((t) => t.function?.name === 'session_log') ? [...base, SESSION_LOG_TOOL] : base;
}
