// Unit kinds: project, feature, layer. Composes the shared fact blocks (facts.mjs, machines.mjs).
import path from 'node:path';
import { fileEntry, testsFor, violationsFor, healthFrom } from '../facts.mjs';
import { machinesOf } from '../machines.mjs';

export const CORE_LAYERS = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'];
const isTest = (p) => /\.(test|spec)\./.test(p);
export const refOf = (kind, id) => `${kind}:${id}`;
const nextItem = (kind, id, why) => ({ ref: refOf(kind, id), why, cli: `construct summarize ${refOf(kind, id)}` });
const LEVEL = { brief: 0, standard: 1, full: 2 };

export function featureNames(ctx) {
  const fr = ctx.featuresRoot() + '/';
  return [...new Set(ctx.allFiles().filter((p) => p.startsWith(fr)).map((p) => p.slice(fr.length).split('/')[0]).filter((n) => n && !n.includes('.')))].sort();
}

const featureFiles = (ctx, name) => ctx.sourceFiles().filter((p) => p.startsWith(`${ctx.featuresRoot()}/${name}/`) && !isTest(p));

/** Raw, detail-independent facts for one feature (also the base for its layers). */
function featureData(ctx, name, files = featureFiles(ctx, name)) {
  const facts = files.map((p) => ctx.facts(p));
  const byLayer = {};
  for (const f of facts) (byLayer[f.layer || 'unclassified'] ||= []).push(f);
  const dir = `${ctx.featuresRoot()}/${name}`;
  const inFeature = (p) => p.startsWith(dir + '/');
  const edges = new Map();
  const fileEdges = [];
  for (const f of facts) {
    for (const t of f.resolvedImports) {
      if (!inFeature(t) || t === f.path) continue;
      const tl = ctx.layerOf(t) || 'unclassified';
      if (tl === (f.layer || 'unclassified')) continue;
      const k = `${f.layer || 'unclassified'}>${tl}`;
      edges.set(k, (edges.get(k) || 0) + 1);
      fileEdges.push({ from: f.path, to: t });
    }
  }
  const dataFlow = [...edges].map(([k, n]) => ({ from: k.split('>')[0], to: k.split('>')[1], imports: n })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  // dependencies in: other source files importing into this feature
  const inbound = new Map();
  const routes = [];
  for (const p of ctx.sourceFiles()) {
    if (inFeature(p) || isTest(p)) continue;
    const f = ctx.facts(p);
    if (!f.resolvedImports.some(inFeature)) continue;
    const owner = p.startsWith(ctx.featuresRoot() + '/') ? `${ctx.featuresRoot()}/${p.split('/')[1]}` : p.split('/').slice(0, p.split('/').length > 2 ? 2 : 1).join('/');
    inbound.set(owner, (inbound.get(owner) || 0) + 1);
    const m = p.match(/(?:^|\/)app\/(.*?)\/?page\.[jt]sx?$/);
    if (m) routes.push({ route: '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/'), file: p });
  }
  const outFeatures = new Map();
  const external = new Set();
  for (const f of facts) {
    f.external.forEach((e) => external.add(e));
    for (const t of f.resolvedImports) {
      if (inFeature(t) || !t.startsWith(ctx.featuresRoot() + '/')) continue;
      const other = t.split('/')[1];
      outFeatures.set(other, (outFeatures.get(other) || 0) + 1);
    }
  }
  const publicApi = (facts.find((f) => f.path === `${dir}/index.ts`) || { exports: [] }).exports.map((e) => e.name);
  return { name, dir, facts, byLayer, dataFlow, fileEdges, inbound, routes, outFeatures, external: [...external].sort(), publicApi };
}

const sorted = (m) => [...m].map(([k, n]) => ({ name: k, files: n })).sort((a, b) => a.name.localeCompare(b.name));

function buildFeature(ctx, name, detail) {
  const d = LEVEL[detail];
  const D = featureData(ctx, name);
  if (!D.facts.length) return null;
  const graphLayers = ctx.graph();
  const expected = CORE_LAYERS.filter((l) => graphLayers[l]);
  const present = expected.filter((l) => D.byLayer[l]);
  const missing = expected.filter((l) => !D.byLayer[l]);
  const wfFiles = (D.byLayer.workflow || []).map((f) => f.path);
  const machines = machinesOf(ctx, wfFiles, { withStates: d >= 2 });
  const tests = testsFor(ctx, { dir: D.dir, names: [name] });
  const rules = violationsFor(ctx, (f) => f.startsWith(D.dir + '/'));
  const loc = D.facts.reduce((s, f) => s + f.loc, 0);

  const layerCounts = Object.fromEntries(Object.entries(D.byLayer).map(([l, fs]) => [l, fs.length]).sort());
  const sections = {
    layers: { present, missing, fileCounts: layerCounts },
    files: d === 0 ? undefined : Object.fromEntries(Object.entries(D.byLayer).sort().map(([l, fs]) => [l, fs.map((f) => fileEntry(f, { withExports: d >= 2 }))])),
    contracts: {
      publicApi: D.publicApi,
      routes: D.routes,
      ...(d >= 1 ? {
        hooks: (D.byLayer.hook || []).flatMap((f) => f.exports.filter((e) => e.signature).map((e) => e.signature)),
        components: (D.byLayer.component || []).concat(D.byLayer.page || []).map((f) => ({ file: f.path, props: f.props })).filter((c) => c.props.length),
        serviceEndpoints: [...new Set((D.byLayer.service || []).flatMap((f) => f.endpoints))].sort(),
      } : {}),
    },
    dataFlow: { layers: d === 0 ? D.dataFlow.map((e) => `${e.from} -> ${e.to}`) : D.dataFlow, ...(d >= 2 ? { files: D.fileEdges } : {}) },
    workflows: d === 0 ? machines.map((m) => ({ machine: m.machine, summary: m.summary })).slice(0, 3) : machines,
    dependencies: {
      usedBy: d === 0 ? D.inbound.size : sorted(D.inbound),
      usesFeatures: d === 0 ? [...D.outFeatures.keys()].sort() : sorted(D.outFeatures),
      externalPackages: d === 0 ? D.external.length : D.external,
    },
    rules: d === 0 ? { errors: rules.counts.error, warnings: rules.counts.warning, exceptions: rules.exceptions.length } : d === 1 ? { ...rules, violations: rules.violations.slice(0, 10) } : rules,
    tests: d === 0 ? { count: tests.length } : { count: tests.length, files: tests },
  };
  const findings = [];
  for (const l of missing) findings.push({ severity: 'info', code: 'missing-layer', message: `No ${l} layer yet.` });
  if (!D.publicApi.length) findings.push({ severity: 'warning', code: 'no-public-api', message: 'index.ts exports nothing (or is missing).' });
  if (!tests.length) findings.push({ severity: 'info', code: 'no-tests', message: 'No test files found for this feature.' });
  if (D.byLayer.unclassified) findings.push({ severity: 'info', code: 'unclassified-files', message: `${D.byLayer.unclassified.length} file(s) are not in a recognized layer.` });
  for (const v of rules.violations.slice(0, 5)) findings.push({ severity: v.severity === 'error' ? 'error' : 'warning', code: v.rule, message: `${v.file}: ${v.message}` });
  for (const m of machines) for (const f of m.findings.filter((x) => x.severity === 'warning')) findings.push({ severity: 'warning', code: 'workflow', message: `${m.machine}: ${f.message}` });
  const health = { ...healthFrom(findings), completeness: Number((present.length / (expected.length || 1)).toFixed(2)) };
  const summary = `Feature "${name}": ${D.facts.length} files, ${loc} LOC, ${present.length}/${expected.length} layers` +
    (missing.length ? ` (missing ${missing.join(', ')})` : '') + `; ${machines.length} workflow machine(s); ${rules.counts.error} error(s), ${rules.counts.warning} warning(s); ${tests.length} test file(s).`;
  return {
    name, path: D.dir, summary, sections, health,
    links: { parent: 'project:.', children: present.map((l) => refOf('layer', `${name}/${l}`)) },
    next: [
      ...(missing.length ? [nextItem('layer', `${name}/${missing[0]}`, `Missing layer "${missing[0]}"`)] : []),
      ...(rules.counts.error ? [{ ref: refOf('rule', rules.violations.find((v) => v.severity === 'error').rule), why: 'A rule this feature violates', cli: `construct summarize rule:${rules.violations.find((v) => v.severity === 'error').rule}` }] : []),
      ...present.slice(0, 3).map((l) => nextItem('layer', `${name}/${l}`, `Drill into the ${l} layer`)),
    ],
  };
}

export const featureKind = {
  kind: 'feature',
  description: 'A features/<name>/ vertical slice: layers, contracts, data flow, workflows, dependencies, rules, tests.',
  list: (ctx) => featureNames(ctx).map((n) => ({ id: n, name: n, path: `${ctx.featuresRoot()}/${n}` })),
  resolve: (ctx, ref) => (featureNames(ctx).includes(ref) ? [{ kind: 'feature', id: ref, tier: 1 }] : []),
  summarize: (ctx, id, detail) => buildFeature(ctx, id, detail),
};

// layer: "<feature>/<layer>" (one feature's layer) or "<layer>" (that layer across the project).
function buildLayer(ctx, id, detail) {
  const d = LEVEL[detail];
  const [a, b] = id.includes('/') ? id.split('/') : [null, id];
  const layer = b;
  if (!ctx.graph()[layer]) return null;
  const files = ctx.sourceFiles().filter((p) => !isTest(p) && ctx.layerOf(p) === layer && (!a || p.startsWith(`${ctx.featuresRoot()}/${a}/`)));
  if (!files.length) return null;
  const facts = files.map((p) => ctx.facts(p));
  const def = ctx.graph()[layer];
  const rules = violationsFor(ctx, (f) => files.includes(f));
  const wf = layer === 'workflow' ? machinesOf(ctx, files, { withStates: d >= 2 }) : null;
  return {
    name: id, path: a ? `${ctx.featuresRoot()}/${a}` : undefined,
    summary: `${a ? `Feature "${a}"'s` : 'Project-wide'} ${layer} layer: ${files.length} file(s), ${facts.reduce((s, f) => s + f.loc, 0)} LOC. May import: ${(def.canImport || []).join(', ') || 'nothing'}.`,
    sections: {
      rule: { pattern: def.pattern, canImport: def.canImport || [] },
      files: d === 0 ? { count: files.length, names: files.slice(0, 8).map((p) => path.basename(p)) } : facts.map((f) => fileEntry(f, { withExports: d >= 1 })),
      ...(wf ? { workflows: wf } : {}),
      rules: d === 0 ? rules.counts : rules,
    },
    health: healthFrom(rules.violations.map((v) => ({ severity: v.severity === 'error' ? 'error' : 'warning', code: v.rule, message: `${v.file}: ${v.message}` }))),
    links: { parent: a ? refOf('feature', a) : 'project:.', children: files.slice(0, 20).map((p) => refOf('file', p)) },
    next: files.slice(0, 3).map((p) => nextItem('file', p, 'Drill into this file')),
  };
}

export const layerKind = {
  kind: 'layer',
  description: 'One architecture layer, within a feature ("login/hook") or across the project ("hook").',
  list: (ctx) => {
    const out = [];
    for (const f of featureNames(ctx)) for (const l of CORE_LAYERS) if (ctx.graph()[l] && ctx.sourceFiles().some((p) => p.startsWith(`${ctx.featuresRoot()}/${f}/`) && ctx.layerOf(p) === l)) out.push({ id: `${f}/${l}`, name: `${f}/${l}` });
    return out;
  },
  resolve: (ctx, ref) => {
    if (/^[\w-]+\/[a-z]+$/.test(ref) && featureNames(ctx).includes(ref.split('/')[0]) && ctx.graph()[ref.split('/')[1]]) return [{ kind: 'layer', id: ref, tier: 1 }];
    return ctx.graph()[ref] ? [{ kind: 'layer', id: ref, tier: 3 }] : [];
  },
  summarize: (ctx, id, detail) => buildLayer(ctx, id, detail),
};

export const projectKind = {
  kind: 'project',
  description: 'The whole project: features with health one-liners, layer graph, rule totals.',
  list: () => [{ id: '.', name: 'project' }],
  resolve: (ctx, ref) => (ref === '.' || ref === 'project' ? [{ kind: 'project', id: '.', tier: 1 }] : []),
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    const names = featureNames(ctx);
    const feats = names.map((n) => {
      const s = buildFeature(ctx, n, 'brief');
      return s && { feature: n, files: Object.values(s.sections.layers.fileCounts).reduce((a, b) => a + b, 0), layers: `${s.sections.layers.present.length}/${s.sections.layers.present.length + s.sections.layers.missing.length}`, health: s.health.status, errors: s.sections.rules.errors, warnings: s.sections.rules.warnings };
    }).filter(Boolean);
    const all = ctx.violations();
    const cfg = ctx.config();
    return {
      name: path.basename(ctx.root), path: '.',
      summary: `Project ${path.basename(ctx.root)} (${cfg.project?.framework || 'nextjs'}): ${feats.length} feature(s); ${all.filter((v) => v.severity === 'error').length} error(s), ${all.filter((v) => v.severity === 'warning').length} warning(s).`,
      sections: {
        framework: cfg.project?.framework, featuresRoot: ctx.featuresRoot(),
        features: feats,
        layerGraph: Object.fromEntries(Object.entries(ctx.graph()).map(([l, def]) => [l, def.canImport || []])),
        ...(d >= 1 ? { rules: Object.fromEntries([...all.reduce((m, v) => m.set(v.rule, (m.get(v.rule) || 0) + 1), new Map())].sort()), exceptions: (cfg.exceptions || []).length, frozen: cfg.frozen || [] } : {}),
      },
      health: healthFrom(feats.filter((f) => f.errors).map((f) => ({ severity: 'error', code: 'feature-violations', message: `Feature ${f.feature} has ${f.errors} error(s).` }))),
      links: { children: feats.map((f) => refOf('feature', f.feature)) },
      next: feats.slice(0, 5).map((f) => nextItem('feature', f.feature, 'Drill into this feature')),
    };
  },
};
