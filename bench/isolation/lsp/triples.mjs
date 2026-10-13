// #943 -- training triples toward a native Line model: one line per fill that passed EVERY gate (tsc, the task check,
// and atomicGate including the Smith round trip). A fill that failed any gate is never logged (makeTriple throws).
//
//   {id, task, setup, trace_node, line_steps, scope_ops, rule_ids, smith, code, stable_id, model, sample_idx}
//
// `id` is deterministic: sha256 over task, setup, stable_id, sample_idx and the whitespace-normalized code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TRIPLE_KEYS = Object.freeze(['id', 'task', 'setup', 'trace_node', 'line_steps', 'scope_ops', 'rule_ids', 'smith', 'code', 'stable_id', 'model', 'sample_idx']);
export const LINE_STEPS = Object.freeze(['complete_stub', 'reuse', 'add_to_scope', 'create', 'create_module']);
const normCode = (c) => String(c).replace(/\s+/g, ' ').trim();

export const tripleId = (t) => crypto.createHash('sha256').update([t.task, t.setup, t.stable_id, String(t.sample_idx), normCode(t.code)].join('\n')).digest('hex').slice(0, 20);

/** Throws when a triple does not have the schema. */
export function assertTriple(t) {
  const keys = Object.keys(t);
  if (keys.length !== TRIPLE_KEYS.length || TRIPLE_KEYS.some((k) => !keys.includes(k))) throw new Error(`triple keys must be exactly ${TRIPLE_KEYS.join(', ')}`);
  for (const k of ['id', 'task', 'setup', 'trace_node', 'code', 'stable_id', 'model']) if (typeof t[k] !== 'string' || !t[k]) throw new Error(`triple.${k} must be a non-empty string`);
  for (const k of ['line_steps', 'scope_ops', 'rule_ids', 'smith']) if (!Array.isArray(t[k]) || t[k].some((x) => typeof x !== 'string')) throw new Error(`triple.${k} must be a string array`);
  if (!t.line_steps.every((s) => LINE_STEPS.includes(s))) throw new Error(`triple.line_steps must use ${LINE_STEPS.join(', ')}`);
  if (!t.smith.length) throw new Error('triple.smith must hold at least one sentence (the Smith round trip passed)');
  if (!Number.isInteger(t.sample_idx) || t.sample_idx < 0) throw new Error('triple.sample_idx must be a non-negative integer');
  if (t.id !== tripleId(t)) throw new Error('triple.id is not the deterministic id of its content');
  return t;
}

/**
 * Build a triple from a fill and its gate verdicts. Refuses (throws) unless tsc, the check and atomicGate all passed.
 * @param {{gates: {tsc: boolean, check: boolean, atomic: boolean}} & Record<string, any>} f
 */
export function makeTriple(f) {
  if (!f.gates || f.gates.tsc !== true || f.gates.check !== true || f.gates.atomic !== true) throw new Error('only a fill that passed every gate becomes a triple');
  const t = {
    id: '', task: f.task, setup: f.setup, trace_node: f.trace_node, line_steps: [...f.line_steps], scope_ops: [...f.scope_ops],
    rule_ids: [...f.rule_ids], smith: [...f.smith], code: f.code, stable_id: f.stable_id, model: f.model, sample_idx: f.sample_idx,
  };
  t.id = tripleId(t);
  return assertTriple(t);
}

/** Append triples to a JSONL file, skipping ids already in it (re-running a setup does not duplicate). -> appended count */
export function appendTriples(file, triples) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const seen = new Set();
  if (fs.existsSync(file)) for (const l of fs.readFileSync(file, 'utf8').split('\n')) if (l.trim()) { try { seen.add(JSON.parse(l).id); } catch { /* skip */ } }
  const fresh = triples.filter((t) => !seen.has(t.id) && seen.add(t.id));
  if (fresh.length) fs.appendFileSync(file, fresh.map((t) => JSON.stringify(t)).join('\n') + '\n');
  return fresh.length;
}
