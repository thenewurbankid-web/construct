#!/usr/bin/env node
// Executable proof for the workflow-narrator demo: drive the REAL xstate
// machine through every scenario the narrator enumerated, and assert that
// each step lands where the English said it would and that the flow ends in
// the end state the scenario claims.
//
//   node docs/demos/workflow-flagship/run-scenarios.mjs <project-dir> <feature> <WorkflowFile.tsx>
//
// Demo material only, not a product change. Needs the repo's dependencies
// installed (root for `typescript`, ui/client for `xstate`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const [projectDir, feature, file] = process.argv.slice(2);
if (!projectDir || !feature || !file) {
  console.error('usage: run-scenarios.mjs <project-dir> <feature> <WorkflowFile.tsx>');
  process.exit(2);
}

const requireRoot = createRequire(path.join(repo, 'package.json'));
const requireUi = createRequire(path.join(repo, 'ui/client/package.json'));
const ts = requireRoot('typescript');
const { createActor } = requireUi('xstate');

// 1. What the narrator says (the same JSON the UI panels use).
const report = JSON.parse(
  execFileSync('node', [path.join(repo, 'bin/construct.mjs'), 'research', 'workflow', feature, file, '--format', 'json', '--dir', projectDir], { encoding: 'utf8' }),
);
const narrated = report.files[0].machines[0];

// 2. The real machine, loaded from the generated source file.
const source = fs.readFileSync(path.join(projectDir, 'features', feature, 'workflows', file), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', js)((id) => (id === 'xstate' ? requireUi('xstate') : requireRoot(id)), mod, mod.exports);
const machine = Object.values(mod.exports).find((v) => v && typeof v === 'object' && v.config);

// Guards are named in the source but implemented elsewhere, so the harness
// supplies them. For each step it tries every true/false setting of the named
// guards and keeps the one under which the real machine takes the step the
// English claims; it fails if none does.
// Every guard name the real machine mentions anywhere (found by walking its config).
function collectGuards(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => collectGuards(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'guard' && typeof v === 'string') out.add(v);
      else collectGuards(v, out);
    }
  }
  return out;
}
const guardNames = [...collectGuards(machine.config)];
const settings = [];
for (let i = 0; i < 2 ** guardNames.length; i++) settings.push(Object.fromEntries(guardNames.map((g, b) => [g, Boolean((i >> b) & 1)])));

function makeActor(state) {
  const box = { values: {} };
  const guards = Object.fromEntries(guardNames.map((g) => [g, () => box.values[g]]));
  const actor = createActor(machine.provide({ guards }), state ? { snapshot: state } : undefined);
  actor.start();
  return { actor, box };
}

let passed = 0;
const failures = [];
for (const sc of narrated.scenarios) {
  const { actor, box } = makeActor();
  let ok = true;
  const notes = [];
  for (const step of sc.steps) {
    const before = actor.getPersistedSnapshot();
    let matched = null;
    for (const s of settings) {
      const probe = makeActor(before);
      probe.box.values = s;
      probe.actor.send({ type: step.event });
      if (probe.actor.getSnapshot().value === step.to) { matched = s; break; }
    }
    if (!matched) { ok = false; notes.push(`no guard setting takes ${step.from} --${step.event}--> ${step.to}`); break; }
    box.values = matched;
    actor.send({ type: step.event });
    notes.push(`${step.event} -> ${actor.getSnapshot().value}${step.guard ? ` (${step.guard}=${matched[step.guard]})` : ''}`);
  }
  const snap = actor.getSnapshot();
  if (ok && (snap.value !== sc.end.state || snap.status !== 'done')) { ok = false; notes.push(`ended in ${snap.value} (${snap.status}), expected ${sc.end.state}`); }
  if (ok) passed++; else failures.push(sc.id);
  console.log(`${ok ? 'PASS' : 'FAIL'}  scenario ${sc.id} (${sc.title}): ${sc.route}\n      ${notes.join('  |  ')}\n      end state: ${snap.value}, status: ${snap.status}`);
}

// 3. Each loop the narrator flagged ("this part can repeat") really repeats:
// take the looping event several times and confirm the flow stays put, then
// take the way out.
let loopFailures = 0;
for (const loop of narrated.loops || []) {
  const { actor, box } = makeActor();
  // walk to the loop's state along the first scenario that passes through it
  const via = narrated.scenarios.find((s) => s.steps.some((st) => st.from === loop.from));
  for (const st of via.steps) {
    if (st.from === loop.from) break;
    box.values = settings.find((s) => { const p = makeActor(actor.getPersistedSnapshot()); p.box.values = s; p.actor.send({ type: st.event }); return p.actor.getSnapshot().value === st.to; });
    actor.send({ type: st.event });
  }
  box.values = { ...box.values, [loop.guard]: true };
  const seen = [];
  for (let i = 0; i < 3; i++) { actor.send({ type: loop.event }); seen.push(actor.getSnapshot().value); }
  const ok = seen.every((v) => v === loop.to);
  if (!ok) loopFailures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  loop: ${loop.event} x3 while ${loop.guard}=true stays in ${loop.to}: ${seen.join(', ')}`);
}
if (loopFailures) failures.push('loops');

console.log(`\n${passed} of ${narrated.scenarios.length} scenarios reproduced by the real machine` + (failures.length ? `; FAILED: ${failures.join(', ')}` : ''));
process.exit(failures.length ? 1 : 0);
