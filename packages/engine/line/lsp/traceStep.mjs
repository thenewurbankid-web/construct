// #945 -- the Line LSP's nextSteps (packages/engine/lsp/rules.mjs) as Line's deterministic Trace-step block, no model:
// the first legal option in Line order (complete_stub, reuse, add_to_scope, create, create_module) is the step
// (lsp-r1 L-rules-det 8/8, against 3/8 for the 1.5b free choice).
//   traceStep(root, {need, from})   the step for one stable id, with every legal option and the Ollama enum
//   nextOpenStub(root, open, o)     path-first's next stub (path/fill.mjs): an open stub whose body is finished on
//                                   disk is a `reuse`, so it is passed over; under shadow the order is kept and logged
import fs from 'node:fs';
import path from 'node:path';
import { nextSteps, lineFacts } from '../../lsp/rules.mjs';
import { stubProblems } from '../path/stubs.mjs';
import { lspMode, shadowLog } from './profile.mjs';

/**
 * The Trace step for one node.
 * @param {string} root A Line project root.
 * @param {{need: string, from: string}} node `need` the stable id <feature>/<kind>/<name>; `from` the asking feature.
 * @param {{facts?: any}} [o]
 * @returns {{ok: true, need: string, from: string, step: {step: string, target: string, reason_id: string, why?: string}|null, options: any[], schema: any, via: 'nextSteps'} | {ok: false, reason: string}}
 */
export function traceStep(root, node, o = {}) {
  const n = nextSteps(root, node, o);
  if (n.ok === false) return n;
  return { ok: true, need: n.need, from: n.from, step: n.options[0] ?? null, options: n.options, schema: n.schema, via: 'nextSteps' };
}

/** The stable id Line's facts give a path unit (by its file), with that unit's own function as the stub check. */
function unitNode(root, facts, u) {
  for (const f of facts.fns.values()) {
    if (f.file !== u.file) continue;
    let problems;
    try { problems = stubProblems(fs.readFileSync(path.join(root, u.file), 'utf8'), u.fn).map((p) => p.code); } catch { problems = ['NO_STUB']; }
    f.problems = problems;
    return { need: f.id, from: f.feature };
  }
  return null;
}

/**
 * The next stub path-first works on, decided by the nextSteps block.
 * @param {string} root
 * @param {any[]} open The open stubs, bottom-up (path/fill.mjs openStubs).
 * @param {{lsp?: Record<string, unknown>|null}} [o]
 * @returns {{id: string|null, step: any|null, skipped: string[], mode: string}}
 */
export function nextOpenStub(root, open, o = {}) {
  const mode = lspMode(root, 'nextSteps', o.lsp ?? null);
  const first = open[0]?.id ?? null;
  if (mode === 'off' || !open.length) return { id: first, step: null, skipped: [], mode };
  let facts;
  try { facts = lineFacts(root); } catch { return { id: first, step: null, skipped: [], mode }; }
  const skipped = [];
  let chosen = null;
  for (const u of open) {
    const node = unitNode(root, facts, u);
    const t = node ? traceStep(root, node, { facts }) : null;
    const step = t && t.ok ? t.step : null;
    if (step?.step === 'reuse') { skipped.push(u.id); continue; } // finished on disk: nothing left to fill
    chosen = { id: u.id, step };
    break;
  }
  chosen ??= { id: null, step: null };
  if (mode === 'shadow') {
    shadowLog(root, 'nextSteps', { used: first, would: chosen.id, step: chosen.step, skipped });
    return { id: first, step: null, skipped: [], mode };
  }
  return { ...chosen, skipped, mode };
}
