// Construct verification of drafted routes: each route runs in its own scratch copy of the project through the plan
// tools' runChange (planned, then written only by applyChange -> Construct's transactional writer, which blocks every
// new problem), its expected-output expressions are evaluated on the result, and the result's structure hash must equal
// the route's predicted hash. A refused route keeps Construct's sentence and the first typed fix; a hash mismatch is a
// miss ("wrong-shape"). The real project is never written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChange, REAL_PLAN_OPS } from '../planTools.mjs';
import { readLineProject } from '../model.mjs';
import { evaluate } from '../expr.mjs';
import { buildFacts, addedFindings } from '../facts.mjs';
import { structureGraph, readerOf, hashesOf, applyDelta } from '../structure.mjs';
import { bind, hasSlots } from './domainMap.mjs';

/**
 * A scratch copy of the project (no node_modules, no .git, no Line plans). The caller removes it.
 * @param {string} root
 * @returns {string}
 */
export function scratchCopy(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-drafter-'));
  fs.cpSync(root, dir, { recursive: true, filter: (src) => { const rel = path.relative(root, src); return !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(rel) && !/^line[\\/]plans([\\/]|$)/.test(rel); } });
  return dir;
}

/** The feature a route is about, bound (for the feature-level hash). */
function featureOf(route, bindings) {
  const f = route.scope.features.map((s) => bindings[s]).find((x) => typeof x === 'string');
  return f ?? null;
}

/**
 * Predicted structure hashes of a route (its bound delta applied in memory), or null when the delta is unknown.
 * @param {import('../structure.mjs').SGraph} graph
 * @param {import('./contract.mjs').Route} route
 * @param {Record<string, any>} bindings
 * @returns {{feature: string|null, project: string}|null}
 */
export function predictHashes(graph, route, bindings) {
  const delta = bind(route.delta, bindings);
  if (hasSlots(delta)) return null;
  const h = hashesOf(applyDelta(graph, delta), featureOf(route, bindings));
  return { feature: h.feature, project: h.project };
}

/**
 * Verify routes in scratch copies. Routes with unfilled slots (a value or code a model must propose) stay "needs-model".
 * @param {string} root
 * @param {import('./contract.mjs').Route[]} routes
 * @param {Record<string, any>} bindings
 * @param {{ops?: any, max?: number}} [o]  `max`: verify at most this many routes (the rest stay "unverified").
 * @returns {import('./contract.mjs').Route[]}
 */
export function verifyRoutes(root, routes, bindings, o = {}) {
  const ops = o.ops ?? REAL_PLAN_OPS;
  const max = o.max ?? 8;
  const graph = structureGraph(readLineProject(root), readerOf(root));
  const before = buildFacts(root);
  /** The sentences of what does not hold (one expression list, bound), [] when every one holds. */
  const failures = (facts, exprs) => exprs.flatMap((e) => evaluate(facts, e).failed.map((f) => f.sentence));
  let done = 0;
  return routes.map((r) => {
    const predicted = predictHashes(graph, r, bindings);
    const steps = bind(r.steps, bindings);
    if (r.status === 'needs-model' || hasSlots(steps)) return { ...r, predicted, status: 'needs-model' };
    if (done >= max) return { ...r, predicted };
    done++;
    const pre = failures(before, bind(r.pre, bindings));
    if (pre.length) return { ...r, predicted, status: 'refused', refusal: { sentence: pre[0], fix: null } };
    const dir = scratchCopy(root);
    try {
      const files = new Set();
      for (const s of steps) {
        let res;
        try { res = runChange(dir, s.tool, s.args, ops); } catch (e) { return { ...r, predicted, status: 'refused', refusal: { sentence: String(/** @type {any} */ (e)?.message ?? e), fix: null, code: /** @type {any} */ (e)?.code ?? null, rule: null } }; }
        if (!res.apply.ok) {
          const f = res.options.find((x) => x.id === 'fix' && x.step) ?? res.options.find((x) => x.id === 'fix') ?? null;
          const first = res.apply.findings.find((x) => x.severity === 'error') ?? res.apply.findings[0];
          return { ...r, predicted, status: 'refused', refusal: { sentence: res.apply.sentence, fix: f ? { id: f.fixId ?? 'fix', sentence: f.sentence, step: f.step ?? null } : null, code: res.apply.code ?? null, rule: first?.rule ?? null } };
        }
        for (const x of res.apply.files) files.add(x);
      }
      const project = readLineProject(dir);
      const after = buildFacts(dir, { project });
      const failed = failures(buildFacts(dir, { project, findingsNew: addedFindings(before.findings, after.findings) }), bind(r.expect, bindings));
      const h = hashesOf(structureGraph(project, readerOf(dir)), featureOf(r, bindings));
      const actual = { feature: h.feature, project: h.project };
      const shapeOk = !predicted || (predicted.feature === actual.feature && predicted.project === actual.project);
      const status = failed.length ? 'failed' : shapeOk ? 'ok' : 'wrong-shape';
      return { ...r, predicted, actual, status, failed, cost: { ...r.cost, files: files.size } };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
