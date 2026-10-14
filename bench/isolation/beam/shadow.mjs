// #949 -- the Trace beam in shadow, no model: every lending spec point (bench/lending/SPEC.md, planned in a copy of
// the lending-seed-r2 project; acceptance held out) and the 12 bench/isolation tasks (planned in their harness
// workspace). Per point: candidates forked, survivors, the decision and chosen path, pruned per stage (structure,
// types, behaviour, cost), proven-reuse slots, ms per stage, and whether the chosen path's layers below the page
// match the reference solution's (the isolation task's reference/ file; for lending, the task covering that point).
//
//   node bench/isolation/beam/shadow.mjs --lending <copy of lending-seed-r2/project> [--json out.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, TASKS, loadTask, makeWorkspace } from '../lib/workspace.mjs';
import { shortestPlan } from '../../../packages/engine/line/path/beam/shortestPlan.mjs';
import { specPoint, specPointsOf } from '../../../packages/engine/line/path/beam/specPoints.mjs';
import { beamFacts } from '../../../packages/engine/line/path/beam/facts.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const LENDING = arg('--lending');
const OUT = arg('--json');
const SPEC = fs.readFileSync(path.join(HERE, '..', 'lending', 'SPEC.md'), 'utf8');
const TASK_IDS = fs.readdirSync(TASKS).filter((d) => /^t\d\d-/.test(d)).sort();

/** The layers below the page a reference file uses (by its imports), and the stable ids it reuses. */
function refLayers(file) {
  const src = fs.readFileSync(file, 'utf8');
  const layers = new Set(); const ids = [];
  for (const m of src.matchAll(/^import\s+(.+?)\s+from\s+'([^']+)'/gm)) {
    const spec = m[2];
    const names = [...m[1].matchAll(/\b(\w+)\b/g)].map((x) => x[1]).filter((n) => !['type', 'import', 'from', 'Book'].includes(n));
    const feat = /features\/(\w+)\//.exec(spec)?.[1] ?? (spec.startsWith('../') && !spec.startsWith('../../') ? path.basename(path.dirname(path.dirname(file))) : /^\.\.\/\.\.\/(\w+)\//.exec(spec)?.[1]);
    if (/\/services\//.test(spec)) { layers.add('service'); ids.push(...names.map((n) => `${feat}/services/${n}`)); }
    if (/\/store\//.test(spec)) { layers.add('contract'); ids.push(...names.map((n) => `${feat}/store/${n}`)); }
  }
  return { layers: [...layers].sort(), ids: ids.sort(), state: /useState/.test(src) };
}
/** The chosen path: the taken one, else the first compare option. */
const chosenOf = (plan) => (plan.decision.kind === 'take' ? plan.decision.key : plan.decision.kind === 'compare' ? plan.decision.package.options[0] : null);
function row(kind, id, plan, ref) {
  const key = chosenOf(plan);
  const c = [...plan.survivors, ...plan.fallbacks].find((x) => x.key === key) ?? null;
  // the fixture file is the data source both sides read (a reference service imports it too), not a layer of its own
  const below = c ? [...new Set(c.nodes.filter((n) => (n.layer === 'service' || n.layer === 'contract') && !/^library\/fixtures\//.test(n.target)).map((n) => n.layer))].sort() : [];
  const reused = c ? c.nodes.filter((n) => n.step === 'reuse' || n.step === 'add_to_scope' || n.via).map((n) => n.via ?? n.target).sort() : [];
  return {
    kind, id, forked: plan.forked, enumerated: plan.enumerated, survivors: plan.survivors.length, decision: plan.decision.kind,
    chosen: c ? { vm: c.vm, layers: c.layers, steps: c.nodes.filter((n) => n.layer !== 'page').map((n) => `${n.step} ${n.target}`) } : null,
    pruned: plan.pruned, proven: plan.provenSlots, ms: plan.ms,
    ref: ref ? { layers: ref.layers, ids: ref.ids, stateInPage: ref.state } : null,
    match: ref && c ? { layersBelowPage: JSON.stringify(below) === JSON.stringify(ref.layers), reusedIds: ref.ids.every((x) => (ref.module ? c.nodes.map((n) => n.via ?? n.target) : reused).includes(x)), vm: ref.state ? 'ref keeps state in the page' : 'ref binds no view-model' } : null,
    needsYou: plan.decision.kind === 'needs_you' ? plan.decision.tried.slice(0, 3).map((t) => `${t.stage}: ${t.why}`) : undefined,
  };
}

const rows = [];
// 1. the isolation tasks, each in its own harness workspace
const refByPoint = {};
for (const tid of TASK_IDS) {
  const task = loadTask(tid);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-beam-iso-'));
  makeWorkspace(ws, task, null);
  const feature = task.target.split('/')[1];
  const refFile = path.join(task.dir, 'reference', task.target);
  const ref0 = fs.existsSync(refFile) ? refLayers(refFile) : null;
  // a module task's reference IS that layer (a store is the contract), with the functions it exports
  const ref = ref0 && !/\/pages\//.test(task.target) ? { layers: ['contract'], ids: [...fs.readFileSync(refFile, 'utf8').matchAll(/^export function (\w+)/gm)].map((m) => `${feature}/store/${m[1]}`).sort(), state: false, module: true } : ref0;
  const isPage = /\/pages\//.test(task.target);
  const point = specPoint(ws, { id: tid, text: task.spec, feature, page: isPage ? task.target : null, ...(isPage ? {} : { only: /\/store\//.test(task.target) ? 'contract' : 'service' }) });
  const plan = shortestPlan(ws, point, { facts: beamFacts(ws) });
  rows.push(row('isolation', tid, plan, ref));
  for (const m of task.spec.matchAll(/\b([A-Z]+-\d+):/g)) if (isPage) refByPoint[m[1]] ??= ref;
  fs.rmSync(ws, { recursive: true, force: true });
}
// 2. the lending spec points, in the r2 project copy
if (LENDING) {
  const facts = beamFacts(LENDING);
  for (const p of specPointsOf(SPEC)) {
    const plan = shortestPlan(LENDING, specPoint(LENDING, p), { facts });
    rows.push(row('lending', p.id, plan, refByPoint[p.id] ?? null));
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
const pr = (r) => `${r.pruned.structure}/${r.pruned.types}/${r.pruned.behaviour}/${r.pruned.cost}`;
const msS = (r) => `${r.ms.structure}/${r.ms.types}/${r.ms.behaviour}/${r.ms.cost} = ${r.ms.total}`;
console.log('| point | forked | survivors | decision | chosen vm, steps below page | pruned s/t/b/c | proven | layers match ref | ms s/t/b/c = total |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const ch = r.chosen ? `${r.chosen.vm ?? '-'}: ${r.chosen.steps.filter((s) => !/\/(hooks|controllers|providers|expressions)\//.test(s)).join(', ')}` : '-';
  const m = r.match ? `${r.match.layersBelowPage ? 'yes' : 'no'}${r.ref.ids.length ? `, ids ${r.match.reusedIds ? 'yes' : 'no'}` : ''}` : 'no ref';
  console.log(`| ${r.id} | ${r.forked} | ${r.survivors} | ${r.decision} | ${ch} | ${pr(r)} | ${r.proven.length} | ${m} | ${msS(r)} |`);
}
