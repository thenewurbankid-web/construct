// #583 (part of #574) -- locked, model-based unit test per workflow machine: every reachable state and
// every user-event transition, walked with @xstate/graph under node's test runner, no browser.
//
// The generated file bakes in the machine's transition table AS IT WAS WHEN GENERATED (read statically
// by workflowExtractor.mjs, nothing is executed here) and, when it runs, walks the real machine with
// `getShortestPaths` / `getAdjacencyMap` and compares. A transition removed, retargeted or added since
// then fails the test; regenerating refreshes the table once the change is intended. Same contract
// as the Playwright specs (testGenerator.mjs): deterministic, byte-identical for the same source,
// written only into the frozen `tests/generated/` region, only ever overwriting a marker-bearing file.
//
// What the table says, per resting state and user event: the states the flow may land on ("to"). One
// candidate is the ordinary case; a guarded group, a transient `always` state or a final child whose
// parent has `onDone` gives several, because the machine (not a fixture the unit test could choose)
// decides. `after`, `invoke` and `onDone` steps are not in the user-event table but the walk still
// follows them, so a state only they reach is still visited and its own transitions still checked.
//
// Layout: features/<f>/tests/generated/<machine>--every-path.test.ts (Playwright specs are *.spec.ts,
// so the Cockpit's test listing, clone and freshness code never see this file; a Playwright config that
// matches `**/*.spec.ts` never runs it).
import fs from 'node:fs';
import path from 'node:path';
import { ConstructError, EXIT_CODES } from '../core/diagnostics.mjs';
import { graphOf } from './workflowScenarios.mjs';
import { readWorkflowSource } from './workflowSource.mjs';
import { lit, comment } from './testSpecRender.mjs';
import { GENERATED_MARKER, projectPaths, assertLockDeclared, assertSafeDir, featureMachines, machineHash } from './testGenerator.mjs';

const FILE_RE = /^[a-z0-9][a-z0-9-]*--every-path\.test\.ts$/;
const SUFFIX = '--every-path.test.ts';
/** What the generated test needs in the target project: the walker, the machine runtime, a TS loader for node's test runner. */
export const UNIT_TEST_DEPENDENCIES = ['@xstate/graph', 'xstate', 'tsx'];

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const uniq = (xs) => [...new Set(xs)];

// ---- static model --------------------------------------------------------------------------------

/**
 * Why a machine cannot get an every-path test.
 *
 * @param {object} machine One machine from workflowExtractor.mjs.
 * @param {string} source The workflow file's text (to see whether the machine is exported).
 * @returns {string|null} The reason, or null when the machine is supported.
 */
export function unsupportedReason(machine, source) {
  if (!machine.exportName) return 'assign the machine to an exported const (export const X = setup(...).createMachine(...)) so the test can import it';
  const name = machine.exportName.replace(/\$/g, '\\$'); // an identifier is [A-Za-z0-9_$]; only `$` means something to RegExp
  const exported = new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${name}\\b|\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source);
  if (!exported) return `export the machine (export const ${machine.exportName}) so the test can import it`;
  const odd = machine.states.find((s) => s.type === 'parallel' || s.type === 'history');
  if (odd) return `${odd.type} state "${odd.path}" is not supported by the every-path test yet`;
  const bad = machine.transitions.find((t) => t.unresolved);
  if (bad) return `transition "${bad.event}" of state "${bad.from}" targets an unknown state "${bad.rawTarget}"`;
  return null;
}

/**
 * The table the generated test asserts: resting states, the states every run reaches without a
 * fixture, and per (resting state, user event) the candidate landing states. Pure.
 *
 * @param {object} machine One machine from workflowExtractor.mjs (with `initial`).
 * @returns {{initial: string[], states: string[], reachable: string[], transitions: {from: string, event: string, to: string[]}[]}}
 */
export function pathModel(machine) {
  const g = graphOf(machine);
  const parentOf = (p) => g.byPath.get(p)?.parent ?? null;
  const edges = (from, kind) => machine.transitions.filter((t) => t.from === from && t.kind === kind && !t.targetless && t.target);

  /** Resting states the flow can be in after entering `p`: through the initial child, then `always`
   * (any branch may fire; if all are guarded it may also rest here), then a final child's parent `onDone`. */
  const settle = (p, seen = new Set()) => {
    const leaf = g.enter(p);
    if (seen.has(leaf)) return [];
    const inner = new Set(seen).add(leaf);
    const always = edges(leaf, 'always');
    if (always.length) {
      const out = always.flatMap((t) => settle(t.target, inner));
      return uniq(always.every((t) => t.guard) ? [...out, leaf] : out);
    }
    const s = g.byPath.get(leaf);
    if (s?.final && s.parent) {
      const done = edges(s.parent, 'onDone');
      if (done.length) {
        const out = done.flatMap((t) => settle(t.target, inner));
        return uniq(done.every((t) => t.guard) ? [...out, leaf] : out);
      }
    }
    return [leaf];
  };

  const states = machine.states.filter((s) => s.type !== 'compound').map((s) => s.path);
  const transitions = [];
  for (const leaf of states) {
    // nearest state first: a child's handler for an event shadows its parent's
    const groups = new Map();
    for (let cur = leaf; cur; cur = parentOf(cur)) {
      for (const t of machine.transitions) {
        if (t.from !== cur || t.kind !== 'on') continue;
        if (!groups.has(t.event)) groups.set(t.event, { owner: cur, ts: [] });
        const grp = groups.get(t.event);
        if (grp.owner === cur) grp.ts.push(t);
      }
    }
    for (const [event, { ts }] of groups) {
      const to = [];
      for (const t of ts) {
        if (t.targetless) { if (t.actions.length) to.push(leaf); continue; } // a targetless transition without actions is not an event the machine reports
        to.push(...settle(t.target));
      }
      if (to.length && ts.every((t) => t.guard)) to.push(leaf);
      if (to.length) transitions.push({ from: leaf, event, to: uniq(to) });
    }
  }

  // reachable without a fixture: BFS over edges with exactly one unguarded landing
  const initial = settle(machine.initial);
  const reachable = [];
  const queue = [...initial];
  while (queue.length) {
    const p = queue.shift();
    if (reachable.includes(p)) continue;
    reachable.push(p);
    for (const r of transitions) if (r.from === p && r.to.length === 1 && !r.to.includes(p)) queue.push(r.to[0]);
    for (const anc of g.ancestorsOrSelf(p)) {
      for (const kind of ['after', 'invoke']) {
        for (const t of edges(anc, kind)) {
          if (t.guard) continue;
          const landing = settle(t.target);
          if (landing.length === 1) queue.push(landing[0]);
        }
      }
    }
  }
  return { initial, states, reachable, transitions };
}

// ---- rendering -----------------------------------------------------------------------------------

const strList = (xs) => `[${xs.map(lit).join(', ')}]`;

/** The import specifier for a workflow file, from tests/generated/: extensionless for what TS resolves, kept for .mjs. */
function importSpecifier(file) {
  const base = path.basename(file);
  const ext = path.extname(base);
  return `../../workflows/${ext === '.mjs' ? base : base.slice(0, -ext.length)}`;
}

/**
 * The full text of one every-path test.
 *
 * @param {{feature: string, machine: object, machineKey: string, machineFile: string, model: object, mHash: string, relPath: string}} info The feature, the extracted machine, its key and file, `pathModel`'s table, the machine hash and the file's project-relative path.
 * @returns {string} The TypeScript source of the test.
 */
export function renderUnitTest({ feature, machine, machineKey, machineFile, model, mHash, relPath }) {
  const title = `${feature} / ${machine.id}`;
  const L = [];
  L.push(GENERATED_MARKER);
  L.push('// Generated by `construct generate tests --unit`. Regenerated whenever the workflow changes; edits are refused.');
  L.push(`// To change it: clone it to features/${comment(feature)}/tests/ (one level up), where nothing regenerates it.`);
  L.push(`// feature: ${lit(feature)}`);
  L.push(`// machine: ${lit(machine.id)} (${lit(machineFile)}), key ${lit(machineKey)}`);
  L.push(`// machine-hash: sha256:${mHash}`);
  L.push(`// run: npx tsx --test ${comment(relPath)}`);
  L.push('//');
  L.push('// Walks every reachable state of the machine with @xstate/graph (no browser) and checks the user-event');
  L.push('// transition table against the machine as it was when this file was generated. A transition removed,');
  L.push(`// retargeted or added since then fails here; \`construct generate tests --unit ${comment(feature)}\` refreshes the`);
  L.push('// table once the change is intended.');
  L.push('');
  L.push("import { test } from 'node:test';");
  L.push("import assert from 'node:assert/strict';");
  L.push("import type { StateValue } from 'xstate';");
  L.push("import { getShortestPaths, getAdjacencyMap, adjacencyMapToArray } from '@xstate/graph';");
  L.push(`import { ${machine.exportName} } from ${lit(importSpecifier(machineFile))};`);
  L.push('');
  L.push(`const machine = ${machine.exportName};`);
  L.push('');
  L.push('/** Every state the machine declares (a nested state is written parent.child); the walk may not rest in a transient one. */');
  L.push(`const STATES: readonly string[] = ${strList(model.states)};`);
  L.push('/** States every run reaches without a fixture (no guard, no service outcome, no timer to choose). */');
  L.push(`const REACHABLE: readonly string[] = ${strList(model.reachable)};`);
  L.push('/** From a resting state, a user event lands on one of `to` (several when the machine, not a fixture, decides). */');
  L.push('const TRANSITIONS: readonly { from: string; event: string; to: readonly string[] }[] = [');
  for (const r of model.transitions) L.push(`  { from: ${lit(r.from)}, event: ${lit(r.event)}, to: ${strList(r.to)} },`);
  L.push('];');
  L.push('');
  L.push('const pathOf = (value: StateValue): string =>');
  L.push("  typeof value === 'string' ? value : Object.entries(value).map(([k, v]) => `${k}.${pathOf(v ?? '')}`).join('|');");
  L.push('const serializeState = (snapshot: { value: StateValue }) => pathOf(snapshot.value);');
  L.push("const isUserEvent = (type: string) => !type.startsWith('xstate.');");
  L.push('const arrow = (r: { from: string; event: string }) => `${r.from} --${r.event}-->`;');
  L.push('');
  L.push(`test(${lit(`${title}: every reachable state`)}, () => {`);
  L.push('  const reached = getShortestPaths(machine, { serializeState }).map((p) => serializeState(p.state));');
  L.push('  for (const s of reached) assert.ok(STATES.includes(s), `the flow reached a state this table does not know: ${s}`);');
  L.push("  for (const s of REACHABLE) assert.ok(reached.includes(s), `the flow can no longer reach ${s} (reached: ${reached.join(', ')})`);");
  L.push('});');
  L.push('');
  L.push(`test(${lit(`${title}: every transition`)}, () => {`);
  L.push('  const adjacency = getAdjacencyMap(machine, { serializeState });');
  L.push('  const reached = new Set(Object.keys(adjacency));');
  L.push('  const actual = adjacencyMapToArray(adjacency)');
  L.push('    .filter((r) => isUserEvent(r.event.type))');
  L.push('    .map((r) => ({ from: serializeState(r.state), event: r.event.type, to: serializeState(r.nextState) }));');
  L.push('  for (const expected of TRANSITIONS.filter((t) => reached.has(t.from))) {');
  L.push('    const got = actual.find((r) => r.from === expected.from && r.event === expected.event);');
  L.push("    assert.ok(got, `${arrow(expected)} is gone (it landed on ${expected.to.join(' or ')})`);");
  L.push("    assert.ok(expected.to.includes(got.to), `${arrow(expected)} lands on ${got.to}, expected ${expected.to.join(' or ')}`);");
  L.push('  }');
  L.push('  for (const r of actual) {');
  L.push('    assert.ok(TRANSITIONS.some((t) => t.from === r.from && t.event === r.event), `${arrow(r)} ${r.to} is new: not in the table`);');
  L.push('  }');
  L.push('});');
  return `${L.join('\n')}\n`;
}

// ---- planning and writing ------------------------------------------------------------------------

/**
 * Plan every every-path test for a feature. Writes nothing.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature whose machines get a test.
 * @returns {{files: object[], skipped: object[], genRel: string, genDir: string}} One entry per supported machine (`name`, `relPath`, `content`, counts), the machines skipped with a reason, and the output directory.
 */
export function planUnitTests(root, feature) {
  const { genRel, genDir } = projectPaths(root, feature);
  const { found, skipped, keys } = featureMachines(root, feature);
  const files = [];
  found.forEach(({ machine, file }, i) => {
    const source = readWorkflowSource(root, feature, path.basename(file));
    const reason = unsupportedReason(machine, source);
    if (reason) { skipped.push({ file, machine: machine.id, reason }); return; }
    const name = `${keys[i]}${SUFFIX}`;
    if (!FILE_RE.test(name)) throw usage(`Refusing to generate ${lit(name)}: not a safe file name.`);
    const relPath = `${genRel}/${name}`;
    const model = pathModel(machine);
    const mHash = machineHash(machine);
    const content = renderUnitTest({ feature, machine, machineKey: keys[i], machineFile: file, model, mHash, relPath });
    files.push({ name, relPath, content, machine: machine.id, machineKey: keys[i], mHash, states: model.states.length, reachable: model.reachable.length, transitions: model.transitions.length });
  });
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files, skipped, genRel, genDir };
}

/**
 * The packages the generated test needs that the project's package.json does not list.
 *
 * @param {string} root Project root.
 * @returns {string[]} Package names to install (all of them when there is no readable package.json; empty when every one is declared).
 */
export function missingUnitTestDependencies(root) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return [...UNIT_TEST_DEPENDENCIES]; }
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return UNIT_TEST_DEPENDENCIES.filter((d) => !declared[d]);
}

const isGenerated = (text) => text.startsWith(`${GENERATED_MARKER}\n`);

function existingGenerated(genDir) {
  if (!fs.existsSync(genDir)) return [];
  return fs.readdirSync(genDir).filter((n) => FILE_RE.test(n)).filter((n) => {
    const st = fs.lstatSync(path.join(genDir, n));
    return st.isFile() && isGenerated(fs.readFileSync(path.join(genDir, n), 'utf8'));
  }).sort();
}

/**
 * Generate (or refresh) a feature's locked every-path unit tests, one per machine. Everything is
 * validated before anything is written; only marker-bearing files are ever overwritten.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature whose machines get a test.
 * @param {{dryRun?: boolean, prune?: boolean}} [options] `dryRun` writes nothing, `prune` deletes orphaned every-path tests.
 * @returns {object} `{written, unchanged, orphans, pruned, skipped, files, missingDependencies}` (paths are project-relative).
 *
 * @example
 * generateUnitTests(root, 'billing', { dryRun: true });
 */
export function generateUnitTests(root, feature, { dryRun = false, prune = false } = {}) {
  const plan = planUnitTests(root, feature);
  assertLockDeclared(root, plan.genDir);
  assertSafeDir(root, plan.genRel);
  const targets = plan.files.map((f) => ({ ...f, abs: path.join(plan.genDir, f.name) }));
  for (const t of targets) {
    if (path.dirname(t.abs) !== plan.genDir) throw usage(`Refusing output path ${lit(t.abs)}: outside ${plan.genRel}/.`);
    let st = null;
    try { st = fs.lstatSync(t.abs); } catch { /* new file */ }
    if (!st) continue;
    if (st.isSymbolicLink() || !st.isFile()) throw usage(`Refusing to overwrite ${plan.genRel}/${t.name}: it is not a regular file.`);
    if (!isGenerated(fs.readFileSync(t.abs, 'utf8'))) {
      throw usage(`Refusing to overwrite ${plan.genRel}/${t.name}: it is not a generated file (no ${JSON.stringify(GENERATED_MARKER)} marker). Authored and cloned tests belong one level up in tests/.`);
    }
  }
  const wanted = new Set(targets.map((t) => t.name));
  const orphans = existingGenerated(plan.genDir).filter((n) => !wanted.has(n));
  const written = [];
  const unchanged = [];
  const pruned = [];
  if (!dryRun) {
    if (targets.length || (prune && orphans.length)) fs.mkdirSync(plan.genDir, { recursive: true });
    assertSafeDir(root, plan.genRel);
    const realGen = fs.realpathSync(plan.genDir);
    if (!realGen.startsWith(fs.realpathSync(root) + path.sep)) throw usage('Refusing output directory: resolves outside the project.');
  }
  for (const t of targets) {
    const same = fs.existsSync(t.abs) && fs.readFileSync(t.abs, 'utf8') === t.content;
    if (same) { unchanged.push(t.relPath); continue; }
    if (!dryRun) fs.writeFileSync(t.abs, t.content);
    written.push(t.relPath);
  }
  if (prune) {
    for (const n of orphans) {
      if (!dryRun) fs.unlinkSync(path.join(plan.genDir, n));
      pruned.push(`${plan.genRel}/${n}`);
    }
  }
  return { written, unchanged, orphans: orphans.map((n) => `${plan.genRel}/${n}`), pruned, skipped: plan.skipped, files: plan.files, missingDependencies: missingUnitTestDependencies(root) };
}
