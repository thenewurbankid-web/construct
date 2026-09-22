// Impact analysis (#288): given a set of seed units (or changed files), compute the blast radius —
// which features and layers a change touches, which files are implicated and WHY, what is shared and
// therefore risky, and what the project's own rules already say about those files.
//
// This is assembly, not new machinery: the layer graph (architecture-graph.mjs) classifies, the
// fact blocks (units/facts.mjs) parse and resolve imports, the unit registry resolves any ref, and
// the enforcers supply the rule findings. The only thing added here is a reverse import index and a
// bounded traversal over it.
//
// Pure: JSON in, JSON out, read-only (never writes anything, anywhere), no console output, never
// throws (errors are structured `{ok:false, error}`), no LLM — the whole computation runs offline.
// Same input on the same tree -> byte-identical output. Contract: schemas/impact-report.v1.json.
//
// PROVENANCE — the point of the ticket. Mapping a ticket written in English to code is judgement;
// everything downstream of "here are the candidate units" is not. So:
//   * a SEED carries `provenance: "explicit" | "inferred"` — explicit = the user named it, or it came
//     from a git diff; inferred = something guessed it from ticket text (`method: "text-match"`) or a
//     model proposed it (`method: "model"`).
//   * every ENTRY in the report carries `provenance: "derived" | "inferred"` — derived when it is
//     reachable from at least one explicit seed (pure graph computation), inferred only when every
//     path to it starts at an inferred seed. Judgement is visible per row, not per report.
//
// SHARED WITH #285 (PR health): same function, different seeds. A PR view passes the changed files
// from `git diff --name-only` as seeds (`method: "changed-files"`, explicit — git is deterministic,
// so every row of a PR-health report is `derived`); Research mode passes units the user named, or a
// model/text proposal. `impactFromChangedFiles` is a one-line convenience over the same core.
import fs from 'node:fs';
import path from 'node:path';
import { createContext, isTestFile, violationsFor } from './units/facts.mjs';
import { defaultUnitRegistry } from './units/registry.mjs';
import { resolveUnitIn } from './unitSummary.mjs';
import { featureNames } from './units/kinds/feature.mjs';
import { matchFrozen } from '../../src/frozen.mjs';

export const SCHEMA_VERSION = 1;
/** Default transitive depth on the importer (upstream) direction — see the module docs and #288. */
export const DEFAULT_DEPTH = 2;
/** maxSeeds is sized for a real PR diff (#285 passes one changed file per seed), not for hand-typed
 * refs; a bigger diff than this declines loudly rather than producing a report nobody can read. */
export const DEFAULT_LIMITS = { maxFiles: 200, maxSeeds: 100 };
export const SEED_PROVENANCE = ['explicit', 'inferred'];
export const ENTRY_PROVENANCE = ['derived', 'inferred'];
export const SEED_METHODS = ['user', 'changed-files', 'text-match', 'model'];
/** How many distinct other features must import a file before it is called shared. */
export const SHARED_BY_FEATURES = 2;

const fail = (code, message, extra = {}) => ({ schemaVersion: SCHEMA_VERSION, ok: false, error: { code, message, ...extra } });
const finalize = (o) => JSON.parse(JSON.stringify(o)); // drops undefined, keeps key order deterministic
const round2 = (n) => Number(n.toFixed(2));
const uniqSorted = (xs) => [...new Set(xs)].sort();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- seeds ------------------------------------------------------------------------------------

/** Normalize one caller-supplied seed (a string ref, or an object) into the internal shape. */
function normalizeSeed(raw, index) {
  const base = { index, method: 'user', provenance: 'explicit', confidence: 1 };
  if (typeof raw === 'string') return { ...base, ref: raw.trim() };
  if (!raw || typeof raw !== 'object') return { ...base, ref: '', error: { code: 'INVALID_ARGUMENT', message: 'A seed must be a string ref or an object with a `ref` (or `path`).' } };
  const ref = typeof raw.ref === 'string' && raw.ref.trim() ? raw.ref.trim() : typeof raw.path === 'string' ? raw.path.trim() : '';
  const method = SEED_METHODS.includes(raw.method) ? raw.method : 'user';
  const provenance = SEED_PROVENANCE.includes(raw.provenance)
    ? raw.provenance
    : method === 'text-match' || method === 'model' ? 'inferred' : 'explicit';
  const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
    ? round2(raw.confidence)
    : provenance === 'explicit' ? 1 : 0.5;
  return { index, ref, method, provenance, confidence, ...(raw.why ? { why: String(raw.why) } : {}), ...(raw.evidence ? { evidence: String(raw.evidence) } : {}) };
}

/** Every source file a resolved unit consists of. Meta kinds (rule/envelope/generator) have no files
 * of their own — a `rule:` seed instead implicates the files currently violating that rule, which is
 * still a pure graph/enforcer read. */
function filesOfUnit(ctx, kind, id) {
  const src = ctx.sourceFiles();
  const fr = ctx.featuresRoot();
  const under = (dir) => src.filter((p) => p.startsWith(dir.replace(/\/?$/, '/')));
  switch (kind) {
    case 'project': return { files: src, note: 'the whole project' };
    case 'feature': return { files: under(`${fr}/${id}`) };
    case 'package': return { files: under(id) };
    case 'layer': {
      const [a, b] = id.includes('/') ? id.split('/') : [null, id];
      return { files: src.filter((p) => ctx.layerOf(p) === b && (!a || p.startsWith(`${fr}/${a}/`))) };
    }
    case 'export': return { files: src.filter((p) => p === id.split('#')[0]) };
    case 'route': {
      const hit = src.find((p) => {
        const m = p.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/);
        return m && '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/') === id;
      });
      return { files: hit ? [hit] : [] };
    }
    case 'rule': {
      const files = uniqSorted(ctx.violations().filter((v) => v.rule === id && v.file).map((v) => v.file)).filter((p) => src.includes(p));
      return { files, note: `file(s) currently violating ${id}` };
    }
    case 'envelope': case 'generator': return { files: [], note: `${kind} "${id}" is a definition, not project source` };
    default: return { files: src.filter((p) => p === id) }; // file, component, hook, service, domain, page, controller, workflow
  }
}

// ---- the import graph -------------------------------------------------------------------------

/** Forward (what each file imports) and reverse (who imports each file) indexes over project source,
 * both restricted to files that actually exist in the tree. Deterministic: sorted everywhere. */
export function buildImportGraph(ctx) {
  const files = ctx.sourceFiles();
  const known = new Set(files);
  const deps = new Map();
  const importers = new Map();
  for (const p of files) {
    const targets = ctx.facts(p).resolvedImports.filter((t) => known.has(t) && t !== p).sort();
    deps.set(p, targets);
    for (const t of targets) {
      if (!importers.has(t)) importers.set(t, []);
      importers.get(t).push(p);
    }
  }
  for (const [, v] of importers) v.sort();
  return { files, deps, importers: (p) => importers.get(p) || [] };
}

/** Which other features actually consume a file — following its own feature's barrels (`index.ts`
 * re-exports) rather than only direct importers, because the sanctioned way to use another feature's
 * code is through its public index, which would otherwise hide every consumer behind one edge. */
function consumerFeatures(ctx, graph, file, ownScope) {
  const out = new Set();
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length) {
    for (const importer of graph.importers(queue.shift())) {
      const s = scopeOf(ctx, importer);
      if (s.name === ownScope) { if (!seen.has(importer)) { seen.add(importer); queue.push(importer); } continue; }
      if (s.kind === 'feature') out.add(s.name);
    }
  }
  return [...out].sort();
}

/** Which vertical slice a file belongs to: its feature, or (outside `features/`) its top-level dir. */
export function scopeOf(ctx, relPath) {
  const fr = ctx.featuresRoot() + '/';
  if (relPath.startsWith(fr)) {
    const name = relPath.slice(fr.length).split('/')[0];
    if (name && !name.includes('.')) return { name, kind: 'feature' };
  }
  const top = relPath.split('/')[0];
  return { name: relPath.includes('/') ? top : '.', kind: 'directory' };
}

// ---- the core ----------------------------------------------------------------------------------

/**
 * Compute the impact of changing a set of units.
 *
 * @param {string} root project root
 * @param {{seeds?: Array<string|object>, files?: string[], depth?: number, limits?: {maxFiles?: number}}} request
 *   `seeds`: string refs ("feature:login", "features/login/domain/Login.tsx", "/login", "PAGE-003"),
 *   or objects `{ref|path, provenance, method, confidence, why, evidence}`.
 *   `files`: shorthand for file-path seeds (PR health passes the diff here).
 *   `depth`: transitive importer hops, default 2. 0 = the seed units only; Infinity / -1 = unbounded.
 * @param {{registry?: object}} [opts]
 * @returns {object} impact report, or `{ok:false, error}`. Never throws, never writes.
 */
export function analyzeImpact(root, request = {}, opts = {}) {
  try {
    if (typeof root !== 'string' || !fs.existsSync(root)) return fail('ROOT_NOT_FOUND', `Project root not found: ${root}`);
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return fail('INVALID_ARGUMENT', 'The request must be an object: {seeds, files, depth, limits}.');
    const rawSeeds = [
      ...(Array.isArray(request.seeds) ? request.seeds : request.seeds === undefined ? [] : [request.seeds]),
      ...(Array.isArray(request.files) ? request.files.map((p) => ({ path: p, method: 'changed-files', provenance: 'explicit' })) : []),
    ];
    if (!rawSeeds.length) return fail('INVALID_ARGUMENT', 'At least one seed is required: {seeds: ["feature:login"]} or {files: ["features/login/domain/Login.tsx"]}.');
    const limits = { ...DEFAULT_LIMITS, ...(request.limits || {}) };
    if (rawSeeds.length > limits.maxSeeds) return fail('INVALID_ARGUMENT', `Too many seeds (${rawSeeds.length} > ${limits.maxSeeds}).`);
    const depthIn = request.depth === undefined ? DEFAULT_DEPTH : request.depth;
    if (typeof depthIn !== 'number' || Number.isNaN(depthIn)) return fail('INVALID_ARGUMENT', 'depth must be a number (0 = seeds only, 2 = default, Infinity or -1 = unbounded).');
    const depth = depthIn < 0 ? Infinity : depthIn;

    const registry = opts.registry || defaultUnitRegistry();
    const ctx = createContext(path.resolve(root));
    const graph = buildImportGraph(ctx);

    // 1. resolve seeds -> units -> files (deterministic once the refs are given)
    const seeds = rawSeeds.map((s, i) => normalizeSeed(s, i));
    const seedOut = [];
    const seedFiles = new Map(); // path -> Set(seed index)
    for (const s of seeds) {
      if (s.error) { seedOut.push({ ...s, resolved: false }); continue; }
      const r = s.ref ? resolveUnitIn(ctx, s.ref, { registry }) : { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Empty seed reference.' } };
      if (!r.ok) { seedOut.push({ ...s, resolved: false, error: r.error }); continue; }
      const { files, note } = filesOfUnit(ctx, r.kind, r.id);
      for (const p of files) {
        if (!seedFiles.has(p)) seedFiles.set(p, new Set());
        seedFiles.get(p).add(s.index);
      }
      seedOut.push({ ...s, resolved: true, kind: r.kind, id: r.id, unitRef: r.ref, files: files.length, ...(note ? { note } : {}) });
    }
    if (!seedOut.some((s) => s.resolved)) {
      return fail('NO_SEEDS_RESOLVED', `None of the ${seeds.length} seed(s) resolved to a unit in ${path.basename(root)}. Run \`construct summarize --list\` to see what exists.`, { seeds: finalize(seedOut) });
    }
    const seedByIndex = new Map(seedOut.map((s) => [s.index, s]));
    const seedScopes = new Set([...seedFiles.keys()].map((p) => scopeOf(ctx, p).name));

    // 2. traverse. Upstream (importers) is the blast radius and is expanded to `depth`; downstream
    //    (what the seeds import) is context, so it is included at distance 1 and never expanded.
    const entries = new Map(); // path -> {distance, direction, reasons[], seeds:Set}
    const addReason = (p, reason) => { const e = entries.get(p); if (!e.reasons.some((r) => r.code === reason.code && r.from === reason.from)) e.reasons.push(reason); };
    let truncated = false;
    const touch = (p, distance, direction, from, reason) => {
      if (!entries.has(p)) {
        if (entries.size >= limits.maxFiles) { truncated = true; return false; }
        entries.set(p, { path: p, distance, direction, reasons: [], seeds: new Set() });
      }
      const e = entries.get(p);
      if (distance < e.distance) { e.distance = distance; e.direction = direction; }
      for (const i of from) e.seeds.add(i);
      addReason(p, reason);
      return true;
    };
    for (const [p, from] of [...seedFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const refs = [...from].sort().map((i) => seedByIndex.get(i).unitRef).join(', ');
      touch(p, 0, 'seed', from, { code: 'seed', message: `Part of the seed unit(s) ${refs}.` });
    }
    let frontier = [...entries.keys()].sort();
    for (let d = 0; d < depth && frontier.length; d += 1) {
      const next = [];
      for (const p of frontier) {
        const from = entries.get(p).seeds;
        for (const importer of graph.importers(p)) {
          const fresh = !entries.has(importer);
          const ok = touch(importer, d + 1, 'up', from, { code: 'imports-changed-file', from: p, message: `Imports ${p}${d ? ` (${d + 1} hops from a seed)` : ''}.` });
          if (ok && fresh) next.push(importer);
        }
      }
      frontier = next.sort();
    }
    // downstream context: the seeds' own direct dependencies
    for (const p of [...seedFiles.keys()].sort()) {
      for (const dep of graph.deps.get(p) || []) {
        touch(dep, 1, 'down', seedFiles.get(p), { code: 'dependency-of-seed', from: p, message: `Imported by ${p}; read it to understand the change, it is not itself at risk.` });
      }
    }
    // 3. one hop past the limit, counted but not listed, so nothing is silently dropped
    const beyond = new Set();
    for (const [p, e] of entries) {
      if (e.direction === 'down') continue;
      if (e.distance < depth && !truncated) continue;
      for (const importer of graph.importers(p)) if (!entries.has(importer)) beyond.add(importer);
    }

    // 4. shape every entry, with its provenance
    const frozen = ctx.frozen();
    const fileRows = [...entries.values()].map((e) => {
      const scope = scopeOf(ctx, e.path);
      const contributing = [...e.seeds].sort().map((i) => seedByIndex.get(i)).filter(Boolean);
      const provenance = contributing.some((s) => s.provenance === 'explicit') ? 'derived' : 'inferred';
      const confidence = round2(Math.max(0, ...contributing.map((s) => s.confidence)));
      const crossScope = !seedScopes.has(scope.name);
      const test = isTestFile(e.path);
      const facts = ctx.facts(e.path);
      return {
        path: e.path,
        layer: ctx.layerOf(e.path),
        feature: scope.kind === 'feature' ? scope.name : null,
        scope: scope.name,
        scopeKind: scope.kind,
        distance: e.distance,
        direction: e.direction,
        score: round2((1 / (1 + e.distance)) * (crossScope ? 0.6 : 1) * (test ? 0.8 : 1)),
        provenance,
        confidence,
        purpose: facts.purpose,
        reasons: e.reasons
          .map((r) => ({ code: r.code, message: r.message, ...(r.from ? { from: r.from } : {}) }))
          .sort((a, b) => a.code.localeCompare(b.code) || String(a.from).localeCompare(String(b.from))),
        derivedFrom: uniqSorted(contributing.map((s) => s.unitRef || s.ref)),
        ...(test ? { test: true } : {}),
      };
    }).sort((a, b) => b.score - a.score || a.distance - b.distance || a.path.localeCompare(b.path));
    const included = new Set(fileRows.map((r) => r.path));

    // 5. roll up to features (and, outside features/, to directories)
    const beyondByScope = new Map();
    for (const p of beyond) { const n = scopeOf(ctx, p).name; beyondByScope.set(n, (beyondByScope.get(n) || 0) + 1); }
    const byScope = new Map();
    for (const r of fileRows) {
      if (!byScope.has(r.scope)) byScope.set(r.scope, []);
      byScope.get(r.scope).push(r);
    }
    const features = [...byScope.entries()].map(([name, rows]) => {
      const perLayer = new Map();
      for (const r of rows) {
        const l = r.layer || 'unclassified';
        if (!perLayer.has(l)) perLayer.set(l, []);
        perLayer.get(l).push(r);
      }
      const layers = [...perLayer.entries()]
        .map(([layer, ls]) => ({ layer, files: ls.length, minDistance: Math.min(...ls.map((r) => r.distance)), canImport: ctx.graph()[layer]?.canImport || [] }))
        .sort((a, b) => a.minDistance - b.minDistance || a.layer.localeCompare(b.layer));
      const minDistance = Math.min(...rows.map((r) => r.distance));
      const nearest = rows.find((r) => r.distance === minDistance);
      const kind = rows[0].scopeKind;
      return {
        name,
        kind,
        path: kind === 'feature' ? `${ctx.featuresRoot()}/${name}` : name,
        provenance: rows.some((r) => r.provenance === 'derived') ? 'derived' : 'inferred',
        confidence: round2(Math.max(...rows.map((r) => r.confidence))),
        files: rows.length,
        minDistance,
        seeded: rows.some((r) => r.distance === 0),
        layers,
        ...(beyondByScope.get(name) ? { beyondDepth: beyondByScope.get(name) } : {}),
        why: minDistance === 0
          ? 'Contains a seed unit.'
          : `Reached in ${minDistance} hop(s): ${nearest.path} ${nearest.direction === 'down' ? 'is imported by' : 'imports'} a changed file.`,
      };
    }).sort((a, b) => a.minDistance - b.minDistance || b.files - a.files || a.name.localeCompare(b.name));

    // 6. warnings — all from the same reverse index, no new machinery
    const warnings = [];
    for (const r of fileRows) {
      if (r.direction === 'down') continue;
      const others = consumerFeatures(ctx, graph, r.path, r.scope);
      if (others.length >= SHARED_BY_FEATURES) {
        warnings.push({ code: 'SHARED-COMPONENT', severity: 'warning', provenance: r.provenance, file: r.path, layer: r.layer, usedBy: others, message: `${r.path} is used by ${others.length} other feature(s): ${others.join(', ')}. A change here is not feature-local.` });
      }
    }
    const touchedFeatures = features.filter((f) => f.kind === 'feature').map((f) => f.name);
    const seededFeatures = features.filter((f) => f.kind === 'feature' && f.seeded).map((f) => f.name);
    if (seededFeatures.length && touchedFeatures.length > seededFeatures.length) {
      const extra = touchedFeatures.filter((n) => !seededFeatures.includes(n));
      warnings.push({ code: 'CROSS-FEATURE', severity: 'warning', provenance: 'derived', usedBy: extra, message: `The seeds live in ${seededFeatures.length} feature(s) (${seededFeatures.join(', ')}) but the impact reaches ${extra.length} more: ${extra.join(', ')}.` });
    }
    for (const f of touchedFeatures) {
      const index = `${ctx.featuresRoot()}/${f}/index.ts`;
      if (!graph.files.includes(index)) continue;
      const exported = new Set(ctx.facts(index).resolvedImports);
      const hits = fileRows.filter((r) => r.feature === f && r.direction !== 'down' && exported.has(r.path)).map((r) => r.path).sort();
      if (hits.length) warnings.push({ code: 'PUBLIC-API', severity: 'warning', provenance: 'derived', feature: f, files: hits, message: `${hits.length} implicated file(s) are re-exported from ${index}: changing them changes feature "${f}"'s public API.` });
    }
    for (const r of fileRows) {
      if (frozen.length && matchFrozen(ctx.root, path.join(ctx.root, r.path), frozen)) {
        warnings.push({ code: 'FROZEN-REGION', severity: 'error', provenance: r.provenance, file: r.path, message: `${r.path} is inside a frozen (externally authored) region; Construct does not own this file.` });
      }
    }
    if (truncated) warnings.push({ code: 'TRUNCATED', severity: 'info', provenance: 'derived', message: `The report was capped at ${limits.maxFiles} files; widen with limits.maxFiles, or narrow the seeds.` });

    // 7. what the project's own rules already say about these files
    const rules = violationsFor(ctx, (f) => included.has(f));
    const layersTouched = uniqSorted(fileRows.map((r) => r.layer).filter(Boolean));

    const resolvedRefs = seedOut.filter((s) => s.resolved).map((s) => s.unitRef);
    const seedSummary = resolvedRefs.slice(0, 3).join(', ') + (resolvedRefs.length > 3 ? ` and ${resolvedRefs.length - 3} more seed(s)` : '');
    const inferredRows = fileRows.filter((r) => r.provenance === 'inferred').length;
    const summary = `Impact of ${seedSummary || 'the given seed(s)'}: ${touchedFeatures.length} feature(s) (${touchedFeatures.join(', ') || 'none'}), `
      + `${fileRows.length} file(s) across ${layersTouched.length} layer(s), depth ${depth === Infinity ? 'unbounded' : depth}; `
      + `${warnings.length} warning(s); ${rules.counts.error} rule error(s), ${rules.counts.warning} rule warning(s)`
      + `${inferredRows ? `; ${inferredRows} entry/entries inferred rather than derived` : '; every entry derived deterministically'}.`;

    const report = {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      root: path.basename(path.resolve(root)),
      request: { depth: depth === Infinity ? null : depth, unbounded: depth === Infinity, limits },
      summary,
      seeds: seedOut,
      features,
      files: fileRows,
      warnings: warnings.sort((a, b) => a.code.localeCompare(b.code) || String(a.file || a.feature || '').localeCompare(String(b.file || b.feature || ''))),
      rules: {
        violations: rules.violations,
        exceptions: rules.exceptions,
        counts: rules.counts,
        layerConstraints: layersTouched.map((l) => ({ layer: l, canImport: ctx.graph()[l]?.canImport || [] })),
      },
      stats: {
        seedsResolved: seedOut.filter((s) => s.resolved).length,
        seedsUnresolved: seedOut.filter((s) => !s.resolved).length,
        filesConsidered: graph.files.length,
        filesImplicated: fileRows.length,
        derived: fileRows.length - inferredRows,
        inferred: inferredRows,
        byDistance: Object.fromEntries([...new Set(fileRows.map((r) => r.distance))].sort((a, b) => a - b).map((d) => [String(d), fileRows.filter((r) => r.distance === d).length])),
        layers: layersTouched,
        beyondDepth: { files: beyond.size, scopes: [...beyondByScope.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, files]) => ({ name, files })) },
        truncated,
      },
      next: nextSteps(features, rules, fileRows),
    };
    return finalize(report);
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

function nextSteps(features, rules, fileRows) {
  const out = [];
  for (const f of features.filter((x) => x.kind === 'feature').slice(0, 3)) {
    out.push({ ref: `feature:${f.name}`, why: f.seeded ? 'Seeded feature — read it in full before changing it' : `Reached in ${f.minDistance} hop(s)`, cli: `construct summarize feature:${f.name} --detail full` });
  }
  const wf = fileRows.find((r) => r.layer === 'workflow');
  if (wf && wf.feature) out.push({ ref: `file:${wf.path}`, why: 'A workflow state machine is implicated — check its scenarios', cli: `construct research workflow ${wf.feature}` });
  if (rules.counts.error) out.push({ ref: `rule:${rules.violations.find((v) => v.severity === 'error').rule}`, why: 'The implicated files already violate a rule', cli: 'construct validate' });
  return out.slice(0, 6);
}

/**
 * PR health (#285) entry point: the changed files of a diff are the seeds. Deterministic in, so
 * every row comes back `provenance: "derived"`. One implementation — this delegates to analyzeImpact.
 *
 * @param {string} root Project root.
 * @param {string|string[]} files The changed file(s), project-relative.
 * @param {object} [opts] `depth` and `limits`, plus any other `analyzeImpact` option.
 * @returns {object} The impact report (`{ok:true, ...}` or `{ok:false, error}`), every row `provenance: "derived"`.
 *
 * @example
 * impactFromChangedFiles(root, ['features/plan/services/planApi.ts'], { depth: 2 });
 */
export function impactFromChangedFiles(root, files, opts = {}) {
  const { depth, limits, ...rest } = opts;
  return analyzeImpact(root, { files: Array.isArray(files) ? files : [files], depth, limits }, rest);
}

// ---- the optional, still LLM-free, ticket-text layer --------------------------------------------

const COMMON_WORDS = new Set(['index', 'page', 'type', 'types', 'props', 'const', 'default', 'return', 'component', 'function', 'export', 'import', 'string', 'number', 'boolean', 'true', 'false', 'null', 'undefined', 'this', 'that', 'with', 'from', 'when', 'then', 'else', 'error', 'value', 'state']);

/**
 * Propose candidate seeds from a ticket written in English — keyword/path/route/identifier matching
 * against what the project actually contains. LLM-free and offline, but heuristic: every candidate
 * comes back `provenance: "inferred"`, `method: "text-match"`, with the matched evidence, so
 * analyzeImpact marks everything downstream of it inferred too.
 *
 * A model-assisted proposer is a drop-in alternative: emit the same seed objects with
 * `method: "model"`. Core itself never calls an LLM.
 *
 * @param {string} root Project root.
 * @param {string} text The ticket, in English.
 * @param {object} [opts]
 * @param {number} [opts.maxSeeds=10] Upper bound on candidates returned.
 * @returns {object} `{schemaVersion, ok:true, method:'text-match', count, seeds}` or `{ok:false, error}`: candidate seeds, each `provenance: 'inferred'` with its evidence; `{ok:false}` for a missing root or empty text.
 *
 * @example
 * proposeSeedsFromText(root, 'Add a retry button to the plan pane', { maxSeeds: 5 });
 */
export function proposeSeedsFromText(root, text, opts = {}) {
  try {
    if (typeof root !== 'string' || !fs.existsSync(root)) return fail('ROOT_NOT_FOUND', `Project root not found: ${root}`);
    if (typeof text !== 'string' || !text.trim()) return fail('INVALID_ARGUMENT', 'Ticket text is required.');
    const maxSeeds = opts.maxSeeds ?? 10;
    const ctx = createContext(path.resolve(root));
    const src = ctx.sourceFiles();
    const quoted = new Set([...text.matchAll(/[`'"]([^`'"\n]{2,80})[`'"]/g)].map((m) => m[1].trim()));
    const found = new Map(); // ref -> candidate
    const add = (ref, confidence, why, evidence, matchKind) => {
      const c = round2(Math.min(0.95, confidence + (quoted.has(evidence) ? 0.05 : 0)));
      const prev = found.get(ref);
      if (prev && prev.confidence >= c) return;
      found.set(ref, { ref, provenance: 'inferred', method: 'text-match', matchKind, confidence: c, why, evidence });
    };

    // paths: an exact project-relative path, else a unique basename
    for (const m of text.matchAll(/[\w@.\-/]*[\w@\-]\.(?:tsx?|jsx?|mjs)\b/g)) {
      const token = m[0].replace(/^\.\//, '');
      const exact = src.find((p) => p === token || p.endsWith('/' + token));
      if (exact) { add(`file:${exact}`, 0.9, 'The ticket names this file path.', token, 'path'); continue; }
      const base = token.split('/').pop();
      const hits = src.filter((p) => p.endsWith('/' + base));
      if (hits.length === 1 && base.length >= 5) add(`file:${hits[0]}`, 0.7, 'The ticket names this file by name (unique in the project).', token, 'basename');
    }
    // routes
    const routes = src.map((p) => p.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/)).filter(Boolean)
      .map((m) => '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/'));
    for (const r of uniqSorted(routes)) {
      if (r.length > 1 && new RegExp(`(^|[\\s"'\`(])${escapeRe(r)}([\\s"'\`),.]|$)`).test(text)) add(`route:${r}`, 0.8, 'The ticket names this route.', r, 'route');
    }
    // features
    for (const f of featureNames(ctx)) {
      if (f.length >= 3 && new RegExp(`\\b${escapeRe(f)}\\b`, 'i').test(text)) add(`feature:${f}`, 0.7, 'The ticket mentions this feature by name.', f, 'feature');
    }
    // rule ids
    const knownRules = new Set(Object.keys(ctx.config().rules || {}));
    for (const m of text.matchAll(/\b[A-Z]{3,}-\d{3}\b/g)) if (knownRules.has(m[0])) add(`rule:${m[0]}`, 0.85, 'The ticket names this rule.', m[0], 'rule');
    // exported identifiers, exact case, token for token
    const tokens = new Set(text.split(/[^A-Za-z0-9_]+/).filter((t) => t.length >= 4 && !COMMON_WORDS.has(t.toLowerCase())));
    const byName = new Map();
    for (const p of src) {
      if (isTestFile(p)) continue;
      for (const e of ctx.facts(p).exports) {
        if (!e.name || e.name.length < 4 || !tokens.has(e.name)) continue;
        if (!byName.has(e.name)) byName.set(e.name, []);
        byName.get(e.name).push(p);
      }
    }
    for (const [name, paths] of [...byName.entries()].sort()) {
      const owners = uniqSorted(paths);
      if (owners.length > 3) continue;
      for (const p of owners) {
        add(`file:${p}`, owners.length === 1 ? 0.6 : 0.45, `The ticket mentions "${name}", exported by this file${owners.length > 1 ? ` (and ${owners.length - 1} other)` : ''}.`, name, 'identifier');
      }
    }

    const seeds = [...found.values()].sort((a, b) => b.confidence - a.confidence || a.ref.localeCompare(b.ref)).slice(0, maxSeeds);
    return finalize({
      schemaVersion: SCHEMA_VERSION, ok: true, method: 'text-match', count: seeds.length, seeds,
      note: 'Heuristic, LLM-free mapping from English to units. Every candidate is inferred, not derived — confirm the list (or replace it with explicit seeds) before trusting the blast radius.',
    });
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

/** Ticket text -> candidate seeds -> impact report, in one call. The seeds are all inferred, so every
 * entry they reach is marked inferred too. */
export function impactFromTicketText(root, text, opts = {}) {
  const proposal = proposeSeedsFromText(root, text, opts);
  if (!proposal.ok) return proposal;
  if (!proposal.seeds.length) return fail('NO_SEEDS_RESOLVED', 'Nothing in the ticket text matched a unit in this project. Name the units explicitly, or let a model propose them (method: "model").', { proposal });
  const { depth, limits, ...rest } = opts;
  const report = analyzeImpact(root, { seeds: proposal.seeds, depth, limits }, rest);
  return report.ok ? { ...report, proposal: { method: proposal.method, note: proposal.note } } : report;
}

/**
 * Machine-readable usage note for agents (served by `construct research impact --usage`).
 *
 * @returns {object} The usage note: schema version, provenance meanings, depth semantics and the call signatures.
 */
export function impactApiManifest() {
  return {
    schemaVersion: SCHEMA_VERSION,
    schema: 'schemas/impact-report.v1.json',
    purpose: 'Deterministic, LLM-free blast radius: which features, layers and files a change touches, why each one is implicated, what is shared, and what the project rules already say. Read-only.',
    provenance: {
      seed: 'explicit (the user named it, or it came from a git diff) | inferred (guessed from ticket text, or proposed by a model)',
      entry: 'derived (reachable from at least one explicit seed — pure graph computation) | inferred (every path to it starts at an inferred seed)',
    },
    depth: `Default ${DEFAULT_DEPTH} importer hops; distance and a deterministic score rank the output, and one hop past the limit is counted in stats.beyondDepth rather than dropped. depth: 0 = seeds only, -1 = unbounded.`,
    calls: {
      analyzeImpact: '(root, {seeds?, files?, depth?, limits?}) -> impact report | {ok:false,error}',
      impactFromChangedFiles: '(root, files[], {depth?, limits?}) -> impact report (PR health; every row derived)',
      proposeSeedsFromText: '(root, text, {maxSeeds?}) -> {seeds[]} candidates, all inferred',
      impactFromTicketText: '(root, text, opts) -> impact report seeded from ticket text',
    },
    cli: [
      'construct research impact <ref...> [--files a,b] [--since <git-ref>] [--ticket <text>] [--ticket-file <path>] [--depth N] [--max-files N] [--format json|markdown] [--dir D]',
      'construct research impact --usage',
    ],
    errorCodes: ['INVALID_ARGUMENT', 'ROOT_NOT_FOUND', 'NO_SEEDS_RESOLVED', 'INTERNAL_ERROR'],
    reasonCodes: ['seed', 'imports-changed-file', 'dependency-of-seed'],
    warningCodes: ['SHARED-COMPONENT', 'CROSS-FEATURE', 'PUBLIC-API', 'FROZEN-REGION', 'TRUNCATED'],
  };
}

// ---- markdown rendering (for humans) ------------------------------------------------------------

/**
 * Render an impact report (or an error) as Markdown.
 *
 * @param {object} result An impact report or error from `analyzeImpact`.
 * @returns {string} Markdown: the seeds, features touched and files of the report, or an error heading.
 */
export function renderImpactMarkdown(result) {
  if (!result.ok) return `# Impact error: ${result.error.code}\n\n${result.error.message}\n`;
  const L = [`# Impact: ${result.root}`, '', result.summary, '', '## Seeds', ''];
  for (const s of result.seeds) {
    L.push(s.resolved
      ? `- \`${s.unitRef}\` — ${s.provenance} (${s.method}, confidence ${s.confidence}), ${s.files} file(s)${s.why ? ` — ${s.why}` : ''}`
      : `- \`${s.ref}\` — unresolved: ${s.error?.message || 'unknown'}`);
  }
  L.push('', '## Features touched', '');
  for (const f of result.features) {
    L.push(`- **${f.name}** (${f.kind}, ${f.provenance}) — ${f.files} file(s), ${f.layers.map((l) => `${l.layer}:${l.files}`).join(', ')}${f.beyondDepth ? `, +${f.beyondDepth} beyond depth` : ''} — ${f.why}`);
  }
  L.push('', '## Files', '', '| score | file | layer | feature | dist | provenance | why |', '|---|---|---|---|---|---|---|');
  for (const r of result.files) L.push(`| ${r.score} | \`${r.path}\` | ${r.layer || '-'} | ${r.feature || '-'} | ${r.distance} | ${r.provenance} | ${r.reasons[0]?.message || ''} |`);
  if (result.warnings.length) {
    L.push('', '## Warnings', '');
    for (const w of result.warnings) L.push(`- **${w.code}** (${w.severity}, ${w.provenance}): ${w.message}`);
  }
  if (result.rules.violations.length) {
    L.push('', '## Rule findings on these files', '');
    for (const v of result.rules.violations.slice(0, 20)) L.push(`- ${v.severity} ${v.rule} — ${v.file}: ${v.message}`);
  }
  if (result.stats.beyondDepth.files) L.push('', `_${result.stats.beyondDepth.files} more file(s) sit one hop beyond the depth limit (${result.stats.beyondDepth.scopes.map((s) => `${s.name}: ${s.files}`).join(', ')}); raise --depth to include them._`);
  if (result.next.length) { L.push('', '## Next', ''); for (const n of result.next) L.push(`- \`${n.cli}\` — ${n.why}`); }
  L.push('', `_schemaVersion ${result.schemaVersion}, ${result.stats.derived} derived / ${result.stats.inferred} inferred entries, ${result.stats.filesConsidered} file(s) considered_`);
  return L.join('\n') + '\n';
}
