// #348 -- locked, per-scenario Playwright specs generated from a feature's XState machines.
//
// `planFeatureTests` is PURE with respect to the output tree (reads sources, writes nothing) and
// `generateFeatureTests` writes the plan. Deterministic (no timestamps, sorted, byte-identical for
// the same source), no LLM, no `ui/` imports. Built on enumerateScenarios (workflowScenarios.mjs).
//
// Layout (owner decisions on #284):
//   features/<f>/tests/generated/<machine>--<slug>.spec.ts   LOCKED: `frozen:` refuses every other writer
//   features/<f>/tests/<anything>.spec.ts                    clones / authored tests: never touched here
// `tests/` is a `nonLayer:` path (nonLayer.mjs), so the layer enforcers skip it.
//
// Security: every output path is validated (file names are built only from [a-z0-9-], the directory
// is checked component-by-component for symlinks and for escaping the project root), an existing
// file is only overwritten when it carries this generator's marker, and every name that reaches a
// string literal or a comment is escaped, so a machine named with quotes, newlines or `..` cannot
// inject code or leave the directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../config.mjs';
import { matchFrozen } from '../frozen.mjs';
import { isNonLayerPath, GENERATED_TESTS_GLOB, TESTS_GLOB } from '../nonLayer.mjs';
import { ConstructError, EXIT_CODES } from '../diagnostics.mjs';
import { extractMachines } from './workflowExtractor.mjs';
import { enumerateScenarios, graphOf, branchOf, guardedSiblings } from './workflowScenarios.mjs';
export { branchOf };
import { humanize } from './workflowNarrator.mjs';
import { listWorkflowSourceFiles, readWorkflowSource } from './workflowSource.mjs';
import { assignTestIds, kebab } from './testAttributes.mjs';
import { createContext } from './units/facts.mjs';
import { lit, comment, HELPERS, startUrlLine, machineLine, testBlockLines } from './testSpecRender.mjs';
import { featureRoutes } from './units/route-adapters.mjs';

/** First line of every generated file: the ONLY thing that makes a file overwritable by this generator. */
export const GENERATED_MARKER = '// @construct-generated tests v1 - LOCKED, do not edit (#348)';
const FEATURE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FILE_RE = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*\.spec\.ts$/;
const MAX_SLUG = 80;
const LONG_WAIT_MS = 10_000;

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- escaping: `lit` and `comment` live with the shared renderer (testSpecRender.mjs, #302) ------
export { lit, comment };

// ---- scenario naming (#307) -------------------------------------------------------------------

function stepLabel(machine, step) {
  switch (step.kind) {
    case 'on': return step.guard ? `${kebab(step.event)}-if-${kebab(step.guard)}` : guardedSiblings(machine, step) ? `${kebab(step.event)}-otherwise` : kebab(step.event);
    case 'always': return step.guard ? `when-${kebab(step.guard)}` : 'otherwise';
    case 'after': return `after-${kebab(step.event.replace(/^after:/, ''))}`;
    case 'invoke': return step.event === 'invoke.onError' ? 'service-failed' : 'service-ok';
    case 'onDone': return 'done';
    default: return kebab(step.event) || 'step';
  }
}

/** Stable, distinguishing slug: the end state plus the labels of the DECISION steps (steps leaving a
 * state with more than one way out). Two different routes must diverge at a decision step. */
export function scenarioSlug(machine, scenario) {
  if (scenario.happy) return 'happy-path';
  const g = graphOf(machine);
  const decisions = scenario.steps.filter((s) => g.outgoing(s.from).length > 1).map((st) => stepLabel(machine, st));
  const full = `ends-${kebab(scenario.end.state) || 'end'}${decisions.length ? `-via-${decisions.join('-then-')}` : ''}`.replace(/-{2,}/g, '-');
  if (full.length <= MAX_SLUG) return full;
  return `${full.slice(0, MAX_SLUG - 9).replace(/-+$/, '')}-${sha(full).slice(0, 8)}`;
}

// ---- lineage hashes ---------------------------------------------------------------------------

const stripLines = ({ line, ...rest }) => rest;  
export const machineHash = (m) => sha(JSON.stringify({ id: m.id, initial: m.initial, states: m.states.map(stripLines), transitions: m.transitions.map(stripLines) }));
export const scenarioHash = (sc) => sha(JSON.stringify({ steps: sc.steps, end: sc.end }));

// ---- beats ------------------------------------------------------------------------------------

/** Group scenario steps into beats: a user event plus the instantaneous steps (always/onDone) that
 * follow it settle as one beat; `after`/`invoke` steps are waits with no user action. */
export function beatsOf(machine, scenario, testIds, ambiguous) {
  const beats = [];
  for (const step of scenario.steps) {
    const needs = [];
    if (step.guard) needs.push(`a fixture where the guard "${step.guard}" holds`);
    else if ((step.kind === 'always' || step.kind === 'on') && guardedSiblings(machine, step)) needs.push('a fixture where none of the earlier guarded branches apply');
    if (step.kind === 'on') {
      const testId = testIds.get(step.event);
      if (!testId || ambiguous.has(step.event)) needs.push(`an unambiguous data-testid for event ${step.event}`);
      beats.push({ action: { event: step.event, testId }, settle: step.to, needs, wait: null, note: `When "${humanize(step.event)}" happens` });
    } else if (step.kind === 'always' || step.kind === 'onDone') {
      const last = beats[beats.length - 1];
      if (last) { last.settle = step.to; last.needs.push(...needs); } else beats.push({ action: null, settle: step.to, needs, wait: null, note: 'The flow moves on by itself' });
    } else if (step.kind === 'after') {
      const ms = Number(step.event.replace(/^after:/, ''));
      if (!Number.isFinite(ms) || ms > LONG_WAIT_MS) needs.push(`a fake clock (the flow waits ${Number.isFinite(ms) ? `${ms} ms` : `on the "${step.event}" delay`})`);
      beats.push({ action: null, settle: step.to, needs, wait: Number.isFinite(ms) ? ms : null, note: `Then the "${step.event}" timeout passes` });
    } else if (step.kind === 'invoke') {
      if (step.event === 'invoke.onError') needs.push('the service to fail');
      beats.push({ action: null, settle: step.to, needs, wait: 0, note: step.event === 'invoke.onError' ? 'Then its service fails' : 'Then its service finishes' });
    } else beats.push({ action: null, settle: step.to, needs: [`support for a "${step.kind}" step`], wait: null, note: 'Then the flow moves on' });
  }
  return beats;
}

// ---- spec rendering ---------------------------------------------------------------------------

/** The steps of a spec's test body: what the step editor (testSteps.mjs) reads back and renders through the same block. */
export function stepsOf({ fixme, start, beats }) {
  const steps = fixme.map((text) => ({ kind: 'fixme', text }));
  steps.push({ kind: 'goto' }, { kind: 'state', state: start });
  for (const b of beats) {
    const timeout = b.wait ? b.wait + 5000 : undefined;
    if (b.action) steps.push({ kind: 'event', event: b.action.event, testId: b.action.testId ?? kebab(b.action.event), note: b.note }, { kind: 'state', state: b.settle, timeout });
    else steps.push({ kind: 'state', state: b.settle, timeout, note: b.note });
  }
  return steps;
}

/** The full text of one generated spec. `info` = { feature, machine, machineKey, machineFile, scenario, slug, startUrl, urlNote, testIds, beats, start, mHash, sHash }. */
export function renderSpec(info) {
  const { feature, machine, machineKey, machineFile, scenario, slug, startUrl, urlNote, beats, start, mHash, sHash } = info;
  const needs = [...new Set(beats.flatMap((b) => b.needs))];
  const url = startUrl === null ? 'TODO(construct): no route reaches this feature' : null;
  const fixme = [...(url ? [`${url} - set START_URL in a clone of this file`] : []), ...needs.map((n) => `needs ${n}`)];
  const L = [];
  L.push(GENERATED_MARKER);
  L.push('// Generated by `construct generate tests`. Regenerated whenever the workflow changes; edits are refused.');
  L.push(`// To change it: clone it to features/${comment(feature)}/tests/ (one level up), where nothing regenerates it.`);
  L.push(`// feature: ${lit(feature)}`);
  L.push(`// machine: ${lit(machine.id)} (${lit(machineFile)}), key ${lit(machineKey)}`);
  L.push(`// scenario: ${lit(slug)} - ${lit(scenario.title)}`);
  L.push(`// route: ${comment(scenario.route)}`);
  L.push(`// machine-hash: sha256:${mHash}`);
  L.push(`// scenario-hash: sha256:${sHash}`);
  L.push('');
  for (const t of scenario.text) L.push(`// ${comment(t)}`);
  L.push('');
  L.push("import { test, expect, type Page } from '@playwright/test';");
  L.push('');
  if (url) L.push(`// ${url}`);
  else if (urlNote) L.push(`// ${comment(urlNote)}`);
  L.push(startUrlLine(url ? null : startUrl));
  L.push(machineLine(machineKey));
  L.push('');
  L.push(HELPERS);
  L.push('');
  L.push(...testBlockLines(`${feature} / ${machine.id} / ${scenario.title}`, stepsOf({ fixme, start, beats })));
  return `${L.join('\n')}\n`;
}

// ---- planning ---------------------------------------------------------------------------------

export function projectPaths(root, feature) {
  if (typeof feature !== 'string' || !FEATURE_RE.test(feature)) throw usage(`Invalid feature name ${lit(feature ?? '')}: use letters, digits, "_" and "-" only.`);
  const featuresRoot = loadConfig(root).features?.root || 'features';
  if (path.isAbsolute(featuresRoot) || featuresRoot.split(/[\\/]/).includes('..')) throw usage(`features.root "${featuresRoot}" must be a relative path inside the project.`);
  const featureDir = path.join(root, featuresRoot, feature);
  if (!fs.existsSync(featureDir) || !fs.statSync(featureDir).isDirectory()) throw usage(`Feature "${feature}" not found (looked in ${featuresRoot}/${feature}).`);
  const genRel = `${featuresRoot}/${feature}/tests/generated`.split('/').filter(Boolean).join('/');
  return { featuresRoot, genRel, genDir: path.join(root, genRel) };
}

/** The lock must exist BEFORE a locked file is written: `frozen:` covers the generated dir and `nonLayer:` the tests dir. */
export function assertLockDeclared(root, genDir) {
  const probe = path.join(genDir, 'probe--x.spec.ts');
  const cfg = loadConfig(root);
  const problems = [];
  if (!matchFrozen(root, probe, cfg.frozen || [])) problems.push(`frozen: - ${GENERATED_TESTS_GLOB}`);
  if (!isNonLayerPath(root, probe, cfg.nonLayer || [])) problems.push(`nonLayer: - ${TESTS_GLOB}`);
  if (problems.length) {
    throw usage(`Refusing to generate tests: architecture.yml does not declare the test regions, so generated files would be neither locked nor outside the layer graph. Add to architecture.yml:\n\nfrozen:\n  - ${GENERATED_TESTS_GLOB}\nnonLayer:\n  - ${TESTS_GLOB}\n\n(missing: ${problems.map((p) => p.split(':')[0]).join(', ')})`);
  }
}

/** Plan every spec for a feature. Returns { files: [{ name, relPath, content, ...meta }], skipped, truncated, genRel }. Writes nothing. */
/** A feature's usable machines with their keys and event -> data-testid maps (#302: the editor's allowlist comes from here too). */
export function featureMachines(root, feature) {
  const sources = listWorkflowSourceFiles(root, feature);
  const found = [];
  const skipped = [];
  for (const file of sources) {
    const src = readWorkflowSource(root, feature, file);
    for (const m of extractMachines(src).machines) {
      const where = `workflows/${file}`;
      if (m.error || !m.initial) skipped.push({ file: where, machine: m.id, reason: m.error || 'no initial state' });
      else found.push({ machine: m, file: where });
    }
  }
  const { keys, testIds } = assignTestIds(found.map((f) => f.machine));
  return { found, skipped, keys, testIds };
}

export function planFeatureTests(root, feature, { max } = {}) {
  const { genRel, genDir } = projectPaths(root, feature);
  const { found, skipped, keys, testIds } = featureMachines(root, feature);

  // routes: the start URL comes from the route map, never from the scenario
  let routes = [];
  try { routes = featureRoutes(createContext(root), feature); } catch { routes = []; }
  const staticRoutes = routes.filter((r) => !/[[\]:*]/.test(r.route));
  const route = staticRoutes[0] || null;
  const urlNote = routes.length > 1 ? `Other routes reaching this feature: ${routes.slice(1).map((r) => r.route).join(', ')}` : null;

  const files = [];
  let truncated = false;
  found.forEach(({ machine, file }, i) => {
    const key = keys[i];
    const ids = testIds[i];
    const byId = new Map();
    for (const [event, id] of ids) byId.set(id, [...(byId.get(id) || []), event]);
    const ambiguous = new Set([...byId.values()].filter((evs) => evs.length > 1).flat());
    const result = enumerateScenarios(machine, max ? { max } : {});
    if (result.truncated) truncated = true;
    const used = new Set();
    for (const sc of result.scenarios) {
      const base = scenarioSlug(machine, sc);
      let slug = base;
      for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
      used.add(slug);
      const name = `${key}--${slug}.spec.ts`;
      if (!FILE_RE.test(name)) throw usage(`Refusing to generate ${lit(name)}: not a safe file name.`);
      const startState = sc.steps[0]?.from ?? sc.end.state;
      const beats = beatsOf(machine, sc, ids, ambiguous);
      const content = renderSpec({ feature, machine, machineKey: key, machineFile: file, scenario: sc, slug, startUrl: route ? route.route : null, urlNote, beats, start: startState, mHash: machineHash(machine), sHash: scenarioHash(sc) });
      files.push({ seq: files.length, name, relPath: `${genRel}/${name}`, content, machine: machine.id, machineKey: key, scenario: sc.title, slug, title: sc.title, happy: !!sc.happy, branch: branchOf(machine, sc), scenarioRoute: sc.route, text: sc.text, mHash: machineHash(machine), sHash: scenarioHash(sc), needs: [...new Set(beats.flatMap((b) => b.needs))], startUrl: route ? route.route : null });
    }
  });
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files, skipped, truncated, genRel, genDir, route: route ? route.route : null };
}

// ---- writing ----------------------------------------------------------------------------------

const isGenerated = (text) => text.startsWith(`${GENERATED_MARKER}\n`);

/** Refuse a directory chain that is (or passes through) a symlink, a non-directory, or leaves the project root. */
export function assertSafeDir(root, dirRel) {
  const realRoot = fs.realpathSync(root);
  let cur = root;
  for (const part of dirRel.split('/')) {
    if (!part || part === '.' || part === '..') throw usage(`Refusing output directory "${dirRel}": unsafe path segment.`);
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return; } // the rest does not exist yet; it will be created below root
    if (st.isSymbolicLink()) throw usage(`Refusing to write through a symlink: ${path.relative(root, cur)}.`);
    if (!st.isDirectory()) throw usage(`Refusing output directory: ${path.relative(root, cur)} is not a directory.`);
    const real = fs.realpathSync(cur);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw usage(`Refusing output directory: ${path.relative(root, cur)} resolves outside the project.`);
  }
}

/** Generated files currently on disk (marker-bearing, in the generated dir), for orphan reporting/pruning. */
function existingGenerated(genDir) {
  if (!fs.existsSync(genDir)) return [];
  return fs.readdirSync(genDir).filter((n) => FILE_RE.test(n)).filter((n) => {
    const p = path.join(genDir, n);
    const st = fs.lstatSync(p);
    return st.isFile() && isGenerated(fs.readFileSync(p, 'utf8'));
  }).sort();
}

/**
 * Generate (or refresh) a feature's locked specs. Everything is validated before anything is written.
 * The generator is the ONLY writer allowed into the frozen `tests/generated/` region: it writes with
 * fs directly after its own checks (fs.mjs's write() refuses the frozen glob for everyone else).
 * Returns { written, unchanged, orphans, pruned, skipped, truncated }.
 */
export function generateFeatureTests(root, feature, { dryRun = false, prune = false, max } = {}) {
  const plan = planFeatureTests(root, feature, { max });
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
    assertSafeDir(root, plan.genRel); // re-check after mkdir
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
  return { written, unchanged, orphans: orphans.map((n) => `${plan.genRel}/${n}`), pruned, skipped: plan.skipped, truncated: plan.truncated, route: plan.route, files: plan.files };
}
