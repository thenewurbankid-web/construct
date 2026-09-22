// PR health (#285 / #314 / #316): what a change between two commits MEANS, computed deterministically.
//
// GitHub shows a pull request as a pile of changed lines. Construct knows which feature and layer each
// line lives in, what the layer graph allows, and what the project's own rules say — so the review
// indicators are assembled from blocks that already exist, not from a model reading the description.
//
// This module is the engine only: JSON in, JSON out, no `ui/` import, no LLM, no network, no console
// output, and it never throws (failures are structured `{ok:false, error}`). Contract:
// schemas/pr-health.v1.json.
//
// INPUT   prHealth(root, { base, head, expected?, mergeBase? })
//   base / head   git refs (branches, tags, commits). LOCAL BRANCHES ARE FIRST-CLASS: nothing here
//                 needs a GitHub login. By default the comparison starts at the merge base of the two,
//                 which is what a pull request shows (the tip of `base` may have moved on).
//   expected      optional, and never required. A plan (`{steps}`), a plan's `planTouches()` output
//                 (`{features, files}`), or an array of feature names. Absent => blast radius is
//                 `measured:false` — a neutral state, never an error: most changes have no plan.
//
// OUTPUT  five indicators, each with `headline`, `evidence`, `source` ("where the number comes from")
//         and `deterministic:true`; every problem is a finding classified `mechanical` (a Construct
//         block can resolve it without a model) or `conversation` (a human must decide). The two are
//         never blurred. This module classifies; it does not fix anything.
//
// REUSE  Impact comes from ONE call to impactFromChangedFiles() (the same function Research mode
// uses), so barrel-aware transitive reach and the SHARED-COMPONENT / PUBLIC-API / CROSS-FEATURE /
// TRUNCATED warnings are not recomputed here. Rule constraints come from `rule:<ID>` seeds, the flow
// diff from the workflow narrator's own scenarios, expected scope from planTouches().
//
// READ-ONLY  see gitTrees.mjs: validated refs, argv-only git, temporary detached worktrees that are
// always removed. The caller's working tree, index, branches and stash are never written.
import fs from 'node:fs';
import path from 'node:path';
import { analyzeImpact, impactFromChangedFiles, buildImportGraph, scopeOf } from './impact.mjs';
import { createContext, SOURCE_EXT, isTestFile } from './units/facts.mjs';
import { explainSource } from './workflowExplain.mjs';
import { planTouches } from '../core/plan.mjs';
import { resolveCommit, mergeBase, changedFiles, withTrees } from './gitTrees.mjs';

export const SCHEMA_VERSION = 1;
/** Scenario cap per machine when diffing flows (the narrator's default of 25 would hide differences). */
export const FLOW_SCENARIO_MAX = 100;
export const MAX_LISTED = 200;

/** Rules whose violation a Construct block can resolve with no model. Everything else is a conversation.
 * `available:false` means the fix is mechanical in kind but no command performs it yet. */
export const MECHANICAL_RULES = Object.freeze({
  'READ-001': { via: 'construct refactor rename', available: true, when: (v) => /^Rename /.test(v.suggestedFix || '') && !/ and export /.test(v.suggestedFix || ''), why: 'The name does not match the convention but the export is right: renaming the file is a pure move.' },
  'SLICE-003': { via: 'construct sync', available: true, when: () => true, why: 'The feature public index is regenerated from what the feature actually exports.' },
  'SLICE-002': { via: 'construct refactor', available: false, when: () => true, why: 'Re-pointing a cross-feature import at the feature public index.ts is a pure path rewrite; no refactor command performs it yet.' },
});

const fail = (code, message, extra = {}) => ({ schemaVersion: SCHEMA_VERSION, ok: false, error: { code, message, ...extra } });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const uniqSorted = (a) => [...new Set(a)].sort();
const listOf = (a) => (a.length ? a.join(', ') : 'none');
const capList = (a) => ({ items: a.slice(0, MAX_LISTED), total: a.length, ...(a.length > MAX_LISTED ? { more: a.length - MAX_LISTED } : {}) });

const DET = { deterministic: true };

// ---- expected scope ----------------------------------------------------------------------------

/** Normalise `expected` to `{features, files}` or null (no plan). A caller error is `{error}`. */
function normalizeExpected(expected) {
  if (expected === undefined || expected === null) return null;
  let t;
  if (Array.isArray(expected)) {
    if (expected.some((x) => typeof x !== 'string')) return { error: 'expected, when an array, must be a list of feature names.' };
    t = { features: expected, files: [] };
  } else if (typeof expected === 'object') {
    t = Array.isArray(expected.steps) ? planTouches(expected) : { features: Array.isArray(expected.features) ? expected.features : [], files: Array.isArray(expected.files) ? expected.files : [] };
  } else return { error: 'expected must be a plan, a planTouches() result ({features, files}) or an array of feature names.' };
  const files = t.files.map((f) => (typeof f === 'string' ? f : f?.path)).filter((p) => typeof p === 'string' && p);
  const features = t.features.filter((f) => typeof f === 'string' && f);
  return { features: uniqSorted(features), files: uniqSorted(files) };
}

// ---- classification of the change --------------------------------------------------------------

function annotate(files, headCtx, baseCtx) {
  return files.map((f) => {
    const scope = scopeOf(headCtx, f.path);
    const ctx = f.status === 'D' && baseCtx ? baseCtx : headCtx;
    const src = SOURCE_EXT.has(path.extname(f.path));
    return {
      path: f.path,
      status: f.status,
      scope: scope.name,
      scopeKind: scope.kind,
      feature: scope.kind === 'feature' ? scope.name : null,
      layer: src ? ctx.layerOf(f.path) : null,
      source: src,
      test: isTestFile(f.path),
    };
  });
}

const featuresOf = (rows) => uniqSorted(rows.filter((r) => r.feature).map((r) => r.feature));

function finding(indicator, key, resolution, severity, title, message, extra = {}) {
  return { id: `${indicator}:${key}`, indicator, resolution, severity, title, message, ...extra };
}

// ---- 1. declared vs actual blast radius --------------------------------------------------------

function blastRadius(rows, expected, headCtx, impact) {
  const touched = featuresOf(rows);
  const directories = uniqSorted(rows.filter((r) => r.scopeKind === 'directory' && r.scope !== '.').map((r) => r.scope));
  const reached = impact?.ok ? uniqSorted(impact.features.filter((f) => f.kind === 'feature').map((f) => f.name).filter((n) => !touched.includes(n))) : [];
  const base = { id: 'blast-radius', title: 'Declared vs actual scope', ...DET };
  const source = 'Declared side: the plan\'s per-step `touches`, aggregated per feature (planTouches). Actual side: the changed files from `git diff`, each resolved to its feature by path. Neither side is read from prose.';
  if (!expected || (!expected.features.length && !expected.files.length)) {
    return {
      ...base,
      measured: false,
      status: 'not-measured',
      headline: 'Scope is not measured for this change.',
      reason: expected
        ? 'The linked plan declares no files or features, so there is nothing to compare against.'
        : 'No plan is linked. That is normal for hand-written work and outside contributions. Every other check still runs.',
      source,
      evidence: { touched: { features: touched, directories }, declared: null },
      findings: [],
    };
  }
  const declaredFromFiles = expected.files.map((p) => scopeOf(headCtx, p)).filter((s) => s.kind === 'feature').map((s) => s.name);
  const declared = uniqSorted([...expected.features, ...declaredFromFiles]);
  const extra = touched.filter((f) => !declared.includes(f));
  const notDone = declared.filter((f) => !touched.includes(f));
  const declaredFiles = new Set(expected.files);
  const changed = rows.map((r) => r.path);
  const extraFiles = expected.files.length ? changed.filter((p) => !declaredFiles.has(p)) : [];
  const missingFiles = expected.files.filter((p) => !changed.includes(p));
  const findings = extra.map((f) => finding('blast-radius', `extra-feature:${f}`, 'conversation', 'warning', `Feature "${f}" is outside the plan`,
    `The plan did not declare "${f}", but this change edits ${plural(rows.filter((r) => r.feature === f).length, 'file')} there.`,
    { files: rows.filter((r) => r.feature === f).map((r) => r.path) }));
  const headline = `The plan declared ${plural(declared.length, 'feature')} (${listOf(declared)}); this change touches ${touched.length} (${listOf(touched)}).`
    + (extra.length ? ` ${plural(extra.length, 'feature')} outside the plan: ${extra.join(', ')}.` : '')
    + (notDone.length ? ` ${plural(notDone.length, 'planned feature')} not touched yet: ${notDone.join(', ')}.` : '');
  return {
    ...base,
    measured: true,
    status: extra.length ? 'attention' : notDone.length ? 'info' : 'clear',
    headline,
    source,
    evidence: {
      declared: { features: declared, files: expected.files },
      touched: { features: touched, directories },
      extraFeatures: extra,
      unreachedFeatures: notDone,
      extraFiles: capList(extraFiles),
      missingFiles: capList(missingFiles),
      reachedFeatures: reached,
    },
    findings,
  };
}

// ---- 2. unexplained changes --------------------------------------------------------------------

/** Directed "imports" edges among the impact report's rows, read from its own `reasons`. */
function importEdges(impact) {
  const edges = new Map();
  const add = (a, b) => { if (!edges.has(a)) edges.set(a, new Set()); edges.get(a).add(b); };
  for (const f of impact.files) {
    for (const r of f.reasons) {
      if (r.code === 'imports-changed-file' && r.from) add(f.path, r.from);
      if (r.code === 'dependency-of-seed' && r.from) add(r.from, f.path);
    }
  }
  return edges;
}

function connectedComponents(nodes, edges) {
  const set = new Set(nodes);
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const start of nodes) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const next of edges.get(queue.shift()) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
        if (set.has(next)) parent.set(find(next), find(start));
      }
    }
  }
  const groups = new Map();
  for (const n of nodes) { const r = find(n); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); }
  return [...groups.values()].map((g) => g.sort()).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function unexplained(rows, expected, headCtx, impact, touchedFeatures) {
  const base = { id: 'unexplained', title: 'Unexplained changes', ...DET };
  const source = 'A changed file is explained when the import graph (followed through public barrels, via the impact analysis) connects it to another changed file, or to what the plan declared. Files with no such path are listed with the layers that would normally connect them.';
  const own = rows.filter((r) => r.source && !r.test && r.layer && r.status !== 'D');
  if (!impact?.ok) {
    return { ...base, measured: false, status: 'not-measured', headline: 'No source files to relate.', reason: 'The change contains no source files the layer graph classifies (docs, config or deletions only).', source, evidence: {}, findings: [] };
  }
  if (impact.stats.truncated) {
    return { ...base, measured: false, status: 'not-measured', headline: 'Too large to relate file by file.', reason: 'The change is larger than the impact analysis will list, so it is summarised per feature instead. Narrow the comparison to see per-file connections.', source, evidence: { features: touchedFeatures }, findings: [] };
  }
  const findings = [];
  const edges = importEdges(impact);
  const ownPaths = own.map((r) => r.path);
  const comps = connectedComponents(ownPaths, edges);
  const declaredFiles = new Set(expected?.files || []);
  const declaredFeatures = new Set([...(expected?.features || []), ...(expected?.files || []).map((p) => scopeOf(headCtx, p)).filter((s) => s.kind === 'feature').map((s) => s.name)]);
  let anchor = null;
  let anchorKind = 'none';
  if (expected && (declaredFiles.size || declaredFeatures.size)) {
    anchorKind = 'plan';
    anchor = new Set(comps.filter((c) => c.some((p) => declaredFiles.has(p) || declaredFeatures.has(scopeOf(headCtx, p).name))).flat());
  } else if (comps.length && comps[0].length >= 2) {
    anchorKind = 'largest-cluster';
    anchor = new Set(comps[0]);
  }
  const layerGraph = headCtx.graph();
  const orphans = anchor ? own.filter((r) => !anchor.has(r.path)) : [];
  for (const r of orphans) {
    const consumers = Object.entries(layerGraph).filter(([, def]) => (def.canImport || []).includes(r.layer)).map(([l]) => l).sort();
    const sameFeature = own.filter((o) => o.feature && o.feature === r.feature && o.path !== r.path).map((o) => o.layer);
    const consumerChanged = consumers.some((l) => sameFeature.includes(l));
    const why = `${r.path} (${r.layer}) has no import path to ${anchorKind === 'plan' ? 'anything the plan declared' : 'the rest of this change'}`
      + (consumers.length && !consumerChanged ? `, and nothing in ${r.feature || 'its area'} that could use it (${consumers.join(', ')}) changed` : '') + '.';
    findings.push(finding('unexplained', `isolated:${r.path}`, 'conversation', 'warning', `${r.path} is not connected to the rest of the change`, why, { files: [r.path], layer: r.layer, feature: r.feature, expectedConsumers: consumers }));
  }
  // A shared component edited by a change that looks feature-local: its consumers are not otherwise touched.
  const changedSet = new Set(rows.map((r) => r.path));
  for (const w of impact.warnings.filter((x) => x.code === 'SHARED-COMPONENT' && changedSet.has(x.file))) {
    const untouched = w.usedBy.filter((f) => !touchedFeatures.includes(f));
    if (!untouched.length) continue;
    findings.push(finding('unexplained', `shared:${w.file}`, 'conversation', 'warning', `Shared component ${w.file} changes features nothing else here touches`,
      `${w.file} is used by ${w.usedBy.join(', ')}; ${untouched.join(', ')} ${untouched.length === 1 ? 'is' : 'are'} not otherwise part of this change but will render differently.`,
      { files: [w.file], layer: w.layer, usedBy: w.usedBy, untouchedConsumers: untouched }));
  }
  findings.sort((a, b) => a.id.localeCompare(b.id));
  const measuredAnchor = anchorKind !== 'none';
  return {
    ...base,
    measured: true,
    status: findings.length ? 'attention' : 'clear',
    headline: findings.length
      ? `${plural(findings.length, 'change')} the layer graph does not explain.`
      : (measuredAnchor ? 'Every changed file is connected to the rest of the change.' : 'Nothing to compare: the changed files form no connected group, so none can be singled out.'),
    source,
    evidence: {
      anchor: anchorKind,
      clusters: comps.map((c) => ({ files: c.length, sample: c.slice(0, 3) })),
      unexplainedFiles: uniqSorted(findings.filter((f) => f.id.startsWith('unexplained:isolated:')).flatMap((f) => f.files)),
    },
    findings,
  };
}

// ---- 3. rule regressions ----------------------------------------------------------------------

const violationKey = (v) => `${v.rule}|${v.file}|${v.message}`;

function classifyRule(v) {
  const m = MECHANICAL_RULES[v.rule];
  if (m && m.when(v)) return { resolution: 'mechanical', fix: { via: m.via, available: m.available, why: m.why } };
  return { resolution: 'conversation' };
}

function ruleRegressions(baseCtx, headCtx, headRoot) {
  const base = { id: 'rule-regressions', title: 'Rule regressions', ...DET };
  const source = '`construct validate` run on the base commit and on the head commit, then subtracted: only violations that are new on head are counted. Pre-existing ones are reported as a number and never counted against this change.';
  if (!baseCtx) return { ...base, measured: false, status: 'not-measured', headline: 'No rules to compare on the base commit.', reason: 'The project did not exist on the base commit, so there is nothing to subtract.', source, evidence: {}, findings: [] };
  const baseV = baseCtx.violations();
  const headV = headCtx.violations();
  const remaining = new Map();
  for (const v of baseV) remaining.set(violationKey(v), (remaining.get(violationKey(v)) || 0) + 1);
  const fresh = [];
  for (const v of headV) {
    const k = violationKey(v);
    if (remaining.get(k) > 0) remaining.set(k, remaining.get(k) - 1);
    else fresh.push(v);
  }
  const resolved = [...remaining.values()].reduce((a, b) => a + b, 0);
  const constraintByRule = new Map();
  for (const id of uniqSorted(fresh.map((v) => v.rule))) {
    const r = analyzeImpact(headRoot, { seeds: [`rule:${id}`] });
    constraintByRule.set(id, r.ok ? r.rules.layerConstraints : []);
  }
  const findings = fresh.map((v) => {
    const layer = v.file ? headCtx.layerOf(v.file) : null;
    const canImport = (constraintByRule.get(v.rule) || []).find((c) => c.layer === layer)?.canImport ?? (layer ? headCtx.graph()[layer]?.canImport : undefined) ?? null;
    const cls = classifyRule(v);
    return finding('rule-regressions', `${v.rule}:${v.file}:${v.line ?? 0}`, cls.resolution, v.severity === 'error' ? 'error' : 'warning', `${v.rule} is newly violated${v.file ? ` in ${v.file}` : ''}`, v.message,
      { rule: v.rule, files: v.file ? [v.file] : [], ...(v.line ? { line: v.line } : {}), layer, constraint: layer ? { layer, canImport } : null, ...(v.why ? { why: v.why } : {}), ...(v.suggestedFix ? { suggestedFix: v.suggestedFix } : {}), ...(cls.fix ? { fix: cls.fix } : {}) });
  }).sort((a, b) => a.id.localeCompare(b.id));
  const preExisting = headV.length - fresh.length;
  return {
    ...base,
    measured: true,
    status: findings.some((f) => f.severity === 'error') ? 'attention' : findings.length ? 'attention' : 'clear',
    headline: findings.length
      ? `${plural(findings.length, 'new rule violation')} on this change (${preExisting} already there, not counted).`
      : `No new rule violations (${preExisting} already there, not counted).`,
    source,
    evidence: { baseViolations: baseV.length, headViolations: headV.length, new: findings.length, preExisting, resolved },
    findings,
  };
}

// ---- 4. public surface ------------------------------------------------------------------------

const exportNames = (ctx, p) => (fs.existsSync(path.join(ctx.root, p)) ? ctx.facts(p).exports.map((e) => e.name).filter(Boolean) : null);

function publicSurface(rows, baseCtx, headCtx, impact) {
  const base = { id: 'public-surface', title: 'Public surface', ...DET };
  const source = 'A feature\'s public API is what its `index.ts` re-exports. Changed exports come from the impact analysis\'s PUBLIC-API warning plus a before/after comparison of each re-exported file\'s exports on the base and head commits.';
  const fr = headCtx.featuresRoot();
  const features = uniqSorted(rows.map((r) => r.feature).filter(Boolean));
  const changedByPath = new Map(rows.map((r) => [r.path, r]));
  const surface = [];
  const findings = [];
  const baseGraph = baseCtx ? buildImportGraph(baseCtx) : null;
  for (const f of features) {
    const index = `${fr}/${f}/index.ts`;
    const headIndex = fs.existsSync(path.join(headCtx.root, index));
    const baseIndex = baseCtx && fs.existsSync(path.join(baseCtx.root, index));
    if (!headIndex && !baseIndex) continue;
    const publicFiles = uniqSorted([
      ...(headIndex ? headCtx.facts(index).resolvedImports : []),
      ...(baseIndex ? baseCtx.facts(index).resolvedImports : []),
    ]).filter((p) => changedByPath.has(p) || p === index);
    const changedPublic = uniqSorted([...publicFiles, ...(changedByPath.has(index) ? [index] : [])]);
    const removed = [];
    const added = [];
    for (const p of changedPublic) {
      const before = baseCtx ? exportNames(baseCtx, p) : null;
      const after = exportNames(headCtx, p);
      for (const n of (before || []).filter((x) => !(after || []).includes(x))) removed.push({ name: n, file: p });
      for (const n of (after || []).filter((x) => !(before || []).includes(x))) added.push({ name: n, file: p });
    }
    if (!removed.length && !added.length && !changedPublic.length) continue;
    const consumers = baseGraph && baseIndex ? uniqSorted(baseGraph.importers(index).map((p) => scopeOf(baseCtx, p)).filter((s) => s.kind === 'feature' && s.name !== f).map((s) => s.name)) : [];
    surface.push({ feature: f, index, changedFiles: changedPublic, removed, added, consumers });
    if (removed.length) {
      findings.push(finding('public-surface', `removed:${f}`, 'conversation', consumers.length ? 'error' : 'warning', `${plural(removed.length, 'export')} no longer public in "${f}"`,
        `${removed.map((r) => r.name).join(', ')} ${removed.length === 1 ? 'is' : 'are'} no longer exported from ${index}. ${consumers.length ? `Features that import ${f}'s public index: ${consumers.join(', ')}.` : `No other feature imports ${f}'s public index today.`}`,
        { files: uniqSorted(removed.map((r) => r.file)), feature: f, removed: removed.map((r) => r.name), consumers }));
    }
  }
  const apiWarnings = impact?.ok ? impact.warnings.filter((w) => w.code === 'PUBLIC-API') : [];
  const changedCount = surface.reduce((n, s) => n + s.changedFiles.length, 0);
  const removedCount = surface.reduce((n, s) => n + s.removed.length, 0);
  const addedCount = surface.reduce((n, s) => n + s.added.length, 0);
  return {
    ...base,
    measured: true,
    status: removedCount ? 'attention' : changedCount || apiWarnings.length ? 'info' : 'clear',
    headline: removedCount
      ? `${plural(removedCount, 'public export')} removed, ${addedCount} added.`
      : changedCount || apiWarnings.length ? `${plural(changedCount || apiWarnings.length, 'public file')} changed; no export was removed (${addedCount} added).` : 'No public exports changed.',
    source,
    evidence: { features: surface, impactWarnings: apiWarnings.map((w) => ({ feature: w.feature, files: w.files })), removed: removedCount, added: addedCount },
    findings: findings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ---- 5. flow diff -----------------------------------------------------------------------------

const scenarioSig = (sc) => sc.steps.map((s) => `${s.from}>${s.event}${s.guard ? `?${s.guard}` : ''}>${s.to}`).join('|');
const sentence = (verb, sc) => `${verb} the path ${sc.route}${sc.events.length ? ` (${sc.events.join(', ')})` : ''}`;
const readSource = (ctx, p) => { try { return ctx ? fs.readFileSync(path.join(ctx.root, p), 'utf8') : null; } catch { return null; } };

function machinesOf(source) {
  if (source === null) return new Map();
  const out = new Map();
  for (const [i, m] of explainSource(source, { max: FLOW_SCENARIO_MAX }).machines.entries()) out.set(m.exportName || m.machine || `machine-${i}`, m);
  return out;
}

function flowDiff(rows, baseCtx, headCtx) {
  const base = { id: 'flow-diff', title: 'What the flow now does', ...DET };
  const source = 'The workflow narrator\'s scenarios (every route from the start state to an end state) enumerated on the base and head commits and compared route by route, in the narrator\'s own vocabulary. This is exactly what the Workflows screen would say about each commit.';
  const fr = headCtx.featuresRoot();
  const wf = new RegExp(`^${fr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/workflows/.+`);
  const files = rows.filter((r) => r.source && !r.test && wf.test(r.path));
  const flows = [];
  const findings = [];
  for (const r of files) {
    const feature = r.path.match(wf)[1];
    const before = machinesOf(readSource(baseCtx, r.path));
    const after = machinesOf(readSource(headCtx, r.path));
    for (const name of uniqSorted([...before.keys(), ...after.keys()])) {
      const b = before.get(name);
      const a = after.get(name);
      const status = !b ? 'added' : !a ? 'removed' : 'changed';
      const bs = new Map((b?.scenarios || []).map((s) => [scenarioSig(s), s]));
      const as = new Map((a?.scenarios || []).map((s) => [scenarioSig(s), s]));
      const removedPaths = [...bs].filter(([k]) => !as.has(k)).map(([, s]) => s);
      const addedPaths = [...as].filter(([k]) => !bs.has(k)).map(([, s]) => s);
      const unchanged = [...as.keys()].filter((k) => bs.has(k)).length;
      const beforeIssues = new Set((b?.findings || []).map((x) => `${x.kind}|${x.message}`));
      const newIssues = (a?.findings || []).filter((x) => !beforeIssues.has(`${x.kind}|${x.message}`)).filter((x) => x.severity !== 'info');
      const incomplete = !!(b?.truncated || a?.truncated);
      const parseError = a?.error || b?.error || null;
      const sentences = [...removedPaths.map((s) => sentence('removes', s)), ...addedPaths.map((s) => sentence('adds', s))];
      const entry = {
        feature, file: r.path, machine: name, status,
        removed: removedPaths.map((s) => ({ route: s.route, events: s.events, sentence: sentence('This change removes', s), text: s.text })),
        added: addedPaths.map((s) => ({ route: s.route, events: s.events, sentence: sentence('This change adds', s), text: s.text })),
        unchanged,
        newHealthIssues: newIssues.map((x) => ({ kind: x.kind, severity: x.severity, message: x.message })),
        incomplete, ...(parseError ? { error: parseError } : {}),
        summary: status === 'added' ? `New flow "${name}" with ${plural(as.size, 'path')}.`
          : status === 'removed' ? `Flow "${name}" is deleted (${plural(bs.size, 'path')} gone).`
          : sentences.length ? `In "${name}", this change ${sentences.join('; and ')}.` : `"${name}" behaves the same: ${plural(unchanged, 'path')} unchanged.`,
      };
      if (status === 'changed' && !sentences.length && !newIssues.length && !parseError) { flows.push(entry); continue; }
      flows.push(entry);
      const label = `${feature}/${name}`;
      if (removedPaths.length || status === 'removed') findings.push(finding('flow-diff', `removed:${label}`, 'conversation', 'warning', `${label} no longer supports ${plural(status === 'removed' ? bs.size : removedPaths.length, 'path')}`, entry.summary, { files: [r.path], feature, removed: removedPaths.map((s) => s.route) }));
      if (addedPaths.length && status !== 'added') findings.push(finding('flow-diff', `added:${label}`, 'conversation', 'info', `${label} gains ${plural(addedPaths.length, 'path')}`, entry.summary, { files: [r.path], feature, added: addedPaths.map((s) => s.route) }));
      for (const x of newIssues) findings.push(finding('flow-diff', `health:${label}:${x.kind}:${x.state ?? ''}`, 'conversation', x.severity === 'warning' ? 'warning' : 'info', `${label}: ${x.kind}`, x.message, { files: [r.path], feature }));
    }
  }
  const changedFlows = flows.filter((f) => f.status !== 'changed' || f.removed.length || f.added.length || f.newHealthIssues.length);
  const removedN = flows.reduce((n, f) => n + f.removed.length, 0);
  const addedN = flows.reduce((n, f) => n + f.added.length, 0);
  return {
    ...base,
    measured: true,
    status: removedN || flows.some((f) => f.newHealthIssues.length) ? 'attention' : addedN || changedFlows.length ? 'info' : 'clear',
    headline: !files.length ? 'No workflow files changed, so the flows behave as before.'
      : changedFlows.length ? changedFlows.map((f) => f.summary).join(' ') : 'Workflow files changed, but every path is the same.',
    source,
    evidence: { workflowFiles: files.map((f) => f.path), flows: flows.sort((a, b) => a.file.localeCompare(b.file) || a.machine.localeCompare(b.machine)), removedPaths: removedN, addedPaths: addedN },
    findings: findings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ---- assembly ----------------------------------------------------------------------------------

function analyze({ root, prefix, baseTree, headTree, compareSha, headSha, rows0, expected, request, impactOpts }) {
  const headRoot = path.join(headTree, prefix);
  if (!fs.existsSync(headRoot)) return fail('PROJECT_NOT_AT_HEAD', `The project directory "${prefix || '.'}" does not exist on the head commit.`);
  const baseRootPath = path.join(baseTree, prefix);
  const baseCtx = fs.existsSync(baseRootPath) ? createContext(baseRootPath) : null;
  const headCtx = createContext(headRoot);
  const rows = annotate(rows0, headCtx, baseCtx);
  const existingSource = rows.filter((r) => r.source && r.status !== 'D').map((r) => r.path);
  let impact = null;
  let impactError = null;
  if (existingSource.length) {
    impact = impactFromChangedFiles(headRoot, existingSource, { ...impactOpts, limits: { maxSeeds: Math.max(100, existingSource.length), ...(impactOpts.limits || {}) } });
    if (!impact.ok) { impactError = impact.error; impact = null; }
  }
  const touchedFeatures = featuresOf(rows);
  const indicators = [
    blastRadius(rows, expected, headCtx, impact),
    unexplained(rows, expected, headCtx, impact, touchedFeatures),
    ruleRegressions(baseCtx, headCtx, headRoot),
    publicSurface(rows, baseCtx, headCtx, impact),
    flowDiff(rows, baseCtx, headCtx),
  ];
  const findings = indicators.flatMap((i) => i.findings);
  const counts = { mechanical: findings.filter((f) => f.resolution === 'mechanical').length, conversation: findings.filter((f) => f.resolution === 'conversation').length };
  const truncated = !!impact?.stats?.truncated;
  const featureRows = touchedFeatures.map((f) => ({ name: f, files: rows.filter((r) => r.feature === f).length }));
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    kind: 'pr-health',
    root: path.basename(path.resolve(root)),
    request,
    summary: `${plural(rows.length, 'file')} changed across ${plural(touchedFeatures.length, 'feature')} (${listOf(touchedFeatures)}): ${plural(findings.length, 'finding')} (${counts.mechanical} mechanical, ${counts.conversation} for a conversation).`,
    change: {
      files: rows.map((r) => ({ path: r.path, status: r.status, feature: r.feature, layer: r.layer, scope: r.scope })),
      features: featureRows,
      counts: { files: rows.length, added: rows.filter((r) => r.status === 'A').length, modified: rows.filter((r) => r.status !== 'A' && r.status !== 'D').length, deleted: rows.filter((r) => r.status === 'D').length },
    },
    indicators,
    findings,
    counts,
    degraded: truncated || impactError ? {
      ...(truncated ? { truncated: true, level: 'feature', message: `The change is larger than the ${impact.request.limits.maxFiles}-file impact cap, so it is summarised per feature (TRUNCATED); per-file connections are not shown.` } : {}),
      ...(impactError ? { impactError: impactError.code, message: `Impact analysis could not run (${impactError.code}); indicators that need it say so.` } : {}),
    } : null,
    impact: impact ? { summary: impact.summary, warnings: impact.warnings.map((w) => ({ code: w.code, severity: w.severity, ...(w.file ? { file: w.file } : {}), ...(w.feature ? { feature: w.feature } : {}) })), stats: { filesImplicated: impact.stats.filesImplicated, truncated: impact.stats.truncated, layers: impact.stats.layers } } : null,
  };
}

/**
 * Compute the PR-health indicators for the change from `base` to `head`.
 *
 * @param {string} root project root (inside a git repository)
 * @param {{base: string, head: string, expected?: object|string[]|null, mergeBase?: boolean}} request
 * @param {{depth?: number, limits?: object}} [opts] forwarded to the impact analysis
 * @returns {object} `pr-health` v1 report, or `{ok:false, error}`. Never throws, never writes.
 */
export function prHealth(root, request = {}, opts = {}) {
  try {
    if (typeof root !== 'string' || !fs.existsSync(root)) return fail('ROOT_NOT_FOUND', `Project root not found: ${root}`);
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return fail('INVALID_ARGUMENT', 'The request must be an object: {base, head, expected?}.');
    const abs = fs.realpathSync(path.resolve(root));
    const b = resolveCommit(abs, 'base', request.base);
    if (!b.ok) return fail(b.error.code, b.error.message);
    const h = resolveCommit(abs, 'head', request.head);
    if (!h.ok) return fail(h.error.code, h.error.message);
    const expected = normalizeExpected(request.expected);
    if (expected?.error) return fail('INVALID_ARGUMENT', expected.error);
    const useMergeBase = request.mergeBase !== false;
    const mb = useMergeBase ? mergeBase(abs, b.sha, h.sha) : null;
    const compareSha = mb || b.sha;
    const diff = changedFiles(abs, compareSha, h.sha);
    if (!diff.ok) return fail(diff.error.code, diff.error.message);
    const req = {
      base: request.base, head: request.head, baseSha: b.sha, headSha: h.sha, compareSha,
      comparedFrom: mb && mb !== b.sha ? 'merge-base' : mb ? 'base' : useMergeBase ? 'base (no common ancestor)' : 'base',
      expected: !expected ? 'none' : Array.isArray(request.expected) ? 'features' : Array.isArray(request.expected?.steps) ? 'plan' : 'touches',
    };
    return withTrees(abs, [compareSha, h.sha], ([baseTree, headTree], info) => analyze({
      root: abs, prefix: info.prefix, baseTree, headTree, compareSha, headSha: h.sha, rows0: diff.files, expected, request: req, impactOpts: { depth: opts.depth, limits: opts.limits },
    }));
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

// ---- rendering ---------------------------------------------------------------------------------

/**
 * A short markdown rendering for the CLI. The JSON is the contract; this is a convenience.
 *
 * @param {object} report A `prHealth()` result.
 * @returns {string} Markdown with one section per indicator, or a one-line failure.
 */
export function renderPrHealthMarkdown(report) {
  if (!report.ok) return `PR health failed (${report.error.code}): ${report.error.message}\n`;
  const out = [`# PR health`, '', report.summary, ''];
  for (const i of report.indicators) {
    out.push(`## ${i.title}${i.measured ? '' : ' (not measured)'}`, '', i.headline);
    if (!i.measured && i.reason) out.push('', i.reason);
    out.push('', `_Where this comes from: ${i.source}_`, '');
    for (const f of i.findings) out.push(`- **${f.resolution}** [${f.severity}] ${f.title} — ${f.message}`);
    if (i.findings.length) out.push('');
  }
  if (report.degraded?.message) out.push(`> ${report.degraded.message}`, '');
  return `${out.join('\n')}`;
}

/**
 * Machine-readable description of the API, mirroring `impactApiManifest`.
 *
 * @returns {object} The usage note for `prHealth`: signature, CLI, indicators, resolutions and schema.
 */
export function prHealthApiManifest() {
  return {
    schemaVersion: SCHEMA_VERSION,
    function: 'prHealth(root, {base, head, expected?, mergeBase?}, {depth?, limits?})',
    cli: 'construct review <base> <head> [--plan <file>] [--features a,b] [--no-merge-base] [--format json|markdown] [--dir <path>]',
    indicators: ['blast-radius', 'unexplained', 'rule-regressions', 'public-surface', 'flow-diff'],
    resolutions: ['mechanical', 'conversation'],
    readOnly: true,
    llm: false,
    schema: 'schemas/pr-health.v1.json',
  };
}
