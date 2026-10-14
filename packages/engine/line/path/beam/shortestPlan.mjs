// #949 Trace beam: candidate paths per spec point with a deterministic prune, no model anywhere in it.
//   shortestPlan(root, point, o)   fork (AND-OR graph, always, cap 8 alive) -> prune structure -> types -> behaviour
//                                  -> cost (Knuth) -> take | compare | needs_you
//   resolveCompare(pkg, answers)   a closed-choice compare: at most 3 tries, then NEEDS_YOU
//   replan(plan, {stuckStub})      a stub failed 3 fills: the next surviving path without it, else NEEDS_YOU
//   steinerMerge(plans)            several points sharing nodes: greedy Steiner merge (a shared node is built once)
// Prune order is cheapest first: structure (out of scope, stub-first, nothing unused, typed contracts), types (the
// LSP probe of typeFit.mjs on every reused function), behaviour (runExamples.mjs on every finished one).
import { buildGraph, knuthCosts, solutionGraphs, STEP_COST, LAYER_DIR, tokens } from './graph.mjs';
import { beamFacts, inScopeOf } from './facts.mjs';
import { typeFit } from './typeFit.mjs';
import { runOnExamples } from './runExamples.mjs';

export const BEAM_CAP = 8;
export const COMPARE_TRIES = 3;
export const STAGES = Object.freeze(['structure', 'types', 'behaviour', 'cost']);
const REUSE = new Set(['reuse', 'add_to_scope']);
const NEW = new Set(['create', 'create_module']);
const leafKey = (n) => `${n.step} ${n.target}`;
const clock = () => { const t0 = performance.now(); return () => Math.round((performance.now() - t0) * 10) / 10; };

/** Structure rules per view-model kind: a kind whose part would stay unused, or that its typed contract forbids. */
function vmRule(kind, traits) {
  if (kind === 'provider' && !traits.shared) return { code: 'NOTHING_UNUSED', why: 'a provider shares state across pages; this point has no second consumer' };
  if (kind === 'controller' && !traits.action) return { code: 'NOTHING_UNUSED', why: 'a controller handles user actions; this point has none, so its handlers would be unused' };
  if (kind === 'hook' && !traits.state) return { code: 'NOTHING_UNUSED', why: 'a hook holds state; this point has none, so its state would be unused' };
  if (kind === 'computed' && (traits.state || traits.action)) return { code: 'TYPED_CONTRACT', why: 'a computed view-model is a pure defineExpression: it cannot hold state or handle actions' };
  return null;
}

/**
 * The beam for one spec point.
 * @param {string} root A Line project root.
 * @param {any} point See graph.mjs buildGraph.
 * @param {{facts?: any, cap?: number, sandbox?: 'vm'|'quickjs', types?: boolean, behaviour?: boolean}} [o]
 * @returns {any} {point, forked, candidates, pruned, survivors, fallbacks, proven, decision, knuthCost, ms}
 */
export function shortestPlan(root, point, o = {}) {
  const total = clock();
  const facts = o.facts ?? beamFacts(root);
  const g = buildGraph(point, facts, { root, inScope: inScopeOf(root, point.feature) });
  const slotOf = (id) => point.slots.find((s) => s.id === id);
  /** @type {Map<string, {stage: string, code: string, why: string, example?: any}>} */
  const blocked = new Map();
  const ms = { structure: 0, types: 0, behaviour: 0, cost: 0 };

  // 1. structure
  let t = clock();
  for (const n of g.nodes.values()) {
    if (n.type === 'LEAF' && n.step === 'out_of_scope') blocked.set(n.id, { stage: 'structure', code: 'OUT_OF_SCOPE', why: `${n.target} is in another feature and its index does not export it` });
    if (n.type === 'AND' && n.vm) { const r = vmRule(n.vm, point.traits ?? {}); if (r) blocked.set(n.id, { stage: 'structure', ...r }); }
    if (n.type === 'OR' && n.slot) {
      const head = (k) => { const c = g.nodes.get(k); return c.type === 'LEAF' ? c : g.nodes.get(c.children[0]); };
      if (n.children.some((k) => head(k).step === 'complete_stub')) {
        for (const k of n.children) { const h = head(k); if (h.step !== 'complete_stub' && !blocked.has(h.id)) blocked.set(h.id, { stage: 'structure', code: 'STUB_FIRST', why: `an existing stub fills slot ${n.slot}; complete it before reusing or creating` }); }
      }
    }
  }
  ms.structure = t();

  // 2. types: every reused function against its slot (LSP probe)
  t = clock();
  const sigs = new Map();
  for (const n of g.nodes.values()) {
    if (n.type !== 'LEAF' || !REUSE.has(n.step) || !n.slot || blocked.has(n.id) || o.types === false) continue;
    const fn = facts.fns.get(n.target);
    if (!fn) continue;
    const r = typeFit(root, fn, slotOf(n.slot));
    if (r.signature) sigs.set(n.target, r.signature);
    if (!r.ok) blocked.set(n.id, { stage: 'types', code: 'TYPE_MISFIT', why: r.message });
  }
  ms.types = t();

  // 3. behaviour: every finished reused function on its slot's examples; a pass is proven reuse
  t = clock();
  const proven = new Set();
  const runs = new Map();
  for (const n of g.nodes.values()) {
    if (n.type !== 'LEAF' || !REUSE.has(n.step) || !n.slot || blocked.has(n.id) || o.behaviour === false) continue;
    const fn = facts.fns.get(n.target); const ex = slotOf(n.slot)?.examples ?? [];
    if (!fn || fn.problems.length || !ex.length) continue;
    const r = runOnExamples(root, fn, ex, { sandbox: o.sandbox });
    runs.set(n.id, r);
    if (r.ok) proven.add(n.id);
    else blocked.set(n.id, { stage: 'behaviour', code: 'WRONG_OUTPUT', why: `example ${r.failing.id}: expected ${JSON.stringify(r.failing.expect)?.slice(0, 120)}, got ${r.failing.error ?? JSON.stringify(r.failing.got)?.slice(0, 120)}`, example: r.failing });
  }
  ms.behaviour = t();

  // 4. fork + cost: Knuth orders the OR children; the beam keeps at most `cap` live candidates, cheapest first
  t = clock();
  const open = knuthCosts(g).cost;
  const knuth = knuthCosts(g, new Set(blocked.keys()));
  const all = solutionGraphs(g, open).map((s) => describe(g, s, facts, blocked, proven, point)).sort((a, b) => a.cost - b.cost || a.key.localeCompare(b.key));
  const cap = o.cap ?? BEAM_CAP;
  const pruned = { structure: 0, types: 0, behaviour: 0, cost: 0 };
  const forked = []; const alive = [];
  for (const c of all) {
    if (alive.length >= cap) break;
    forked.push(c);
    if (c.prunedAt) pruned[c.prunedAt.stage]++; else alive.push(c);
  }
  const min = alive.length ? alive[0].cost : Infinity;
  const survivors = alive.filter((c) => c.cost === min);
  const fallbacks = alive.filter((c) => c.cost !== min);
  for (const c of fallbacks) c.prunedAt = { stage: 'cost', code: 'DOMINATED', why: `costs ${c.cost}, the cheapest costs ${min}`, at: null };
  pruned.cost = fallbacks.length;
  ms.cost = t();

  const plan = { point: point.id, forked: forked.length, enumerated: all.length, candidates: forked, pruned, survivors, fallbacks,
    proven: forked.filter((c) => c.provenReuse).map((c) => c.key), provenSlots: [...proven].map((id) => g.nodes.get(id).target).sort(),
    knuthCost: knuth.cost.get(g.root), signatures: Object.fromEntries([...sigs].sort()), tried: [] };
  plan.decision = decide(plan, facts, point);
  plan.ms = { ...ms, total: total() };
  return plan;
}

/** One solution graph as a candidate path: its nodes, layers, cost, fit facts and the first prune that hits it. */
function describe(g, s, facts, blocked, proven, point) {
  const nodes = s.leaves.map((id) => g.nodes.get(id));
  const keys = [...new Set(nodes.map(leafKey))].sort();
  const cost = keys.reduce((sum, k) => sum + (STEP_COST[k.split(' ')[0]] ?? 9), 0);
  const vm = Object.values(s.choice).map((id) => g.nodes.get(id)).find((n) => n.vm)?.vm ?? null;
  const hit = [...Object.values(s.choice), ...s.leaves].map((id) => (blocked.has(id) ? { id, ...blocked.get(id) } : null)).filter(Boolean)
    .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.id.localeCompare(b.id))[0] ?? null;
  const layers = ['page', vm, 'service', 'contract', 'domain'].filter((l) => l && nodes.some((n) => n.layer === l));
  const own = new Set(point.slots.map((x) => `${x.feature ?? point.feature}/${x.dir ?? LAYER_DIR[x.layer]}/${x.name}`));
  const fit = {
    exists: nodes.filter((n) => REUSE.has(n.step) || n.step === 'bind').length,
    stub: nodes.filter((n) => n.step === 'complete_stub').length,
    new: nodes.filter((n) => NEW.has(n.step)).length,
    stableIdMatches: nodes.filter((n) => own.has(n.target) && !NEW.has(n.step)).length,
    unused: nodes.filter((n) => (facts.fns.get(n.target)?.problems ?? []).some((p) => p === 'UNUSED_INPUT' || p === 'NO_RETURN')).length,
  };
  const reuseLeaves = nodes.filter((n) => REUSE.has(n.step) && n.slot);
  return {
    key: `${vm ?? '-'}| ${keys.join(' + ')}`, cost, vm, layers,
    nodes: nodes.map((n) => ({ step: n.step, target: n.target, layer: n.layer, ...(n.slot ? { slot: n.slot } : {}) })).sort((a, b) => a.target.localeCompare(b.target) || a.step.localeCompare(b.step)),
    stubs: nodes.filter((n) => n.step === 'complete_stub' || NEW.has(n.step)).map((n) => n.target).sort(),
    fit, prunedAt: hit ? { stage: hit.stage, code: hit.code, why: hit.why, at: g.nodes.get(hit.id).target ?? hit.id, ...(hit.example ? { example: hit.example } : {}) } : null,
    provenReuse: !hit && nodes.every((n) => REUSE.has(n.step) || n.step === 'bind') && reuseLeaves.every((n) => proven.has(n.id)) && reuseLeaves.length > 0,
  };
}

/** take | compare | needs_you, from the survivors. */
function decide(plan, facts, point) {
  if (plan.survivors.length === 1) return { kind: 'take', key: plan.survivors[0].key, model: false };
  if (plan.survivors.length > 1) return { kind: 'compare', package: comparePackage(plan, facts, point) };
  return needsYou(plan.candidates.map((c) => ({ key: c.key, stuckStub: c.prunedAt?.at ?? null, stage: c.prunedAt?.stage ?? null, why: c.prunedAt?.why ?? null, failingExample: c.prunedAt?.example ?? null })));
}
const needsYou = (tried) => ({ kind: 'needs_you', code: 'NEEDS_YOU', tried });

/**
 * The closed-choice compare for several survivors: per candidate its fit facts, stable ids, the example I/O each new
 * or stub unit must satisfy, and the 1-3 nearby functions it would reuse.
 * @param {any} plan @param {any} facts @param {any} point
 * @returns {any}
 */
export function comparePackage(plan, facts, point) {
  const options = plan.survivors.map((c) => c.key);
  return {
    point: point.id, text: point.text ?? null, maxTries: COMPARE_TRIES, options,
    schema: { type: 'object', properties: { option: { type: 'string', enum: options } }, required: ['option'] },
    candidates: plan.survivors.map((c) => ({
      key: c.key, vm: c.vm, layers: c.layers, fit: c.fit, stableIds: c.nodes.map((n) => n.target),
      examples: point.slots.filter((sl) => c.nodes.some((n) => n.slot === sl.id && n.step !== 'reuse')).map((sl) => ({ slot: sl.id, examples: (sl.examples ?? []).map((e) => ({ id: e.id, input: e.input ?? e.args, expect: e.expect })) })),
      nearby: nearby(c, facts, point),
    })),
  };
}

/** The 1-3 functions a candidate would reuse; when it reuses none, the closest by name in the point's feature. */
function nearby(c, facts, point) {
  const used = c.nodes.filter((n) => REUSE.has(n.step) && facts.fns.has(n.target)).map((n) => n.target);
  if (used.length) return used.slice(0, 3);
  const want = new Set(point.slots.flatMap((s) => tokens(s.entity ?? s.name)));
  return [...facts.fns.values()].map((f) => ({ id: f.id, score: tokens(f.name).filter((x) => want.has(x)).length + (f.feature === point.feature ? 0.5 : 0) }))
    .filter((x) => x.score >= 1).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3).map((x) => x.id);
}

/**
 * Resolve a compare from the model's closed-choice answers (in order): the first answer that is one of the options is
 * taken; after COMPARE_TRIES answers without one, NEEDS_YOU.
 * @param {any} pkg comparePackage().
 * @param {string[]} answers
 * @returns {{kind: 'take', key: string, tries: number, model: true} | {kind: 'needs_you', code: 'NEEDS_YOU', tried: any[]}}
 */
export function resolveCompare(pkg, answers) {
  const tried = [];
  for (const a of answers.slice(0, COMPARE_TRIES)) {
    if (pkg.options.includes(a)) return { kind: 'take', key: a, tries: tried.length + 1, model: true };
    tried.push({ answer: a, why: 'not one of the options' });
  }
  if (tried.length < COMPARE_TRIES) return /** @type {any} */ ({ kind: 'compare', package: pkg, tries: tried.length });
  return /** @type {any} */ (needsYou(pkg.options.map((key) => ({ key, stuckStub: null, why: `${COMPARE_TRIES} compare answers were not one of the options` }))));
}

/**
 * Re-plan after a stub failed its fills: the next live candidate (survivors, then fallbacks, cheapest first) that
 * neither was tried nor contains the stuck stub; none left -> NEEDS_YOU with each path tried, its stuck stub and its
 * failing example. Other points' paths are untouched (call it per point).
 * @param {any} plan shortestPlan().
 * @param {{current?: string, stuckStub: string, failure?: any}} stuck
 * @returns {any} The plan with its new decision (and `tried` grown).
 */
export function replan(plan, { current = null, stuckStub, failure = null }) {
  const now = current ?? (plan.decision.kind === 'take' ? plan.decision.key : plan.survivors[0]?.key ?? null);
  const tried = [...plan.tried, { key: now, stuckStub, failingExample: failure }];
  const done = new Set(tried.map((x) => x.key));
  const next = [...plan.survivors, ...plan.fallbacks].find((c) => !done.has(c.key) && !c.stubs.includes(stuckStub));
  return { ...plan, tried, decision: next ? { kind: 'take', key: next.key, model: false, replanned: true } : needsYou(tried) };
}

/**
 * Greedy Steiner merge across points: the most constrained point commits first (fewest live candidates, then the
 * dearest, then by id); each next point takes the live candidate that adds the least cost given the nodes already
 * chosen (a step on a stable id an earlier point already takes costs nothing again).
 * @param {any[]} plans shortestPlan() results.
 * @returns {{order: string[], chosen: Record<string, string>, shared: string[], total: number, separate: number}}
 */
export function steinerMerge(plans) {
  const live = (p) => [...p.survivors, ...p.fallbacks];
  const keysOf = (c) => [...new Set(c.nodes.map((n) => `${n.step} ${n.target}`))];
  const order = plans.filter((p) => live(p).length)
    .sort((a, b) => live(a).length - live(b).length || live(b)[0].cost - live(a)[0].cost || a.point.localeCompare(b.point));
  const built = new Map(); const chosen = /** @type {Record<string, string>} */ ({});
  let total = 0;
  for (const p of order) {
    let pick = null;
    for (const c of live(p)) {
      const e = keysOf(c).filter((k) => !built.has(k)).reduce((s, k) => s + (STEP_COST[k.split(' ')[0]] ?? 9), 0);
      if (!pick || e < pick.e) pick = { c, e };
    }
    chosen[p.point] = pick.c.key; total += pick.e;
    for (const k of keysOf(pick.c)) built.set(k, (built.get(k) ?? 0) + 1);
  }
  const separate = order.reduce((s, p) => s + live(p)[0].cost, 0);
  return { order: order.map((p) => p.point), chosen, shared: [...built].filter(([, n]) => n > 1).map(([k]) => k).sort(), total, separate };
}
