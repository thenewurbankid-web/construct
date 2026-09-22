// Unit kinds for code below the feature level: file + one kind per layer (component, hook, service,
// domain, page, controller, workflow), a single export, a route, and a package (any directory,
// including Construct's own packages/ast, src/engine).
import fs from 'node:fs';
import path from 'node:path';
import { fileEntry, testsFor, violationsFor, healthFrom, isTestFile, SOURCE_EXT } from '../facts.mjs';
import { machinesOf } from '../machines.mjs';
import { discoverRoutes, frameworkOf } from '../route-adapters.mjs';
import { featureNames, refOf } from './feature.mjs';
import { extractExports } from '../../../../packages/ast/index.mjs';
import { extractDeclarationSource } from '../../../summarize.mjs';
import { describeImplementation } from '../../../prose.mjs';
import { resolveUrlToFolder, findRouteEntryFile, findReactSpaRoutesFile, parseReactSpaRoutes } from '../../../route-resolver.mjs';

const LEVEL = { brief: 0, standard: 1, full: 2 };
const norm = (ref) => ref.replace(/^\.\//, '').replace(/\/+$/, '');
const isFile = (ctx, p) => { try { return fs.statSync(path.join(ctx.root, p)).isFile(); } catch { return false; } };
const isDir = (ctx, p) => { try { return fs.statSync(path.join(ctx.root, p)).isDirectory(); } catch { return false; } };
const nextItem = (kind, id, why) => ({ ref: refOf(kind, id), why, cli: `construct summarize ${refOf(kind, id)}` });

const importedBy = (ctx, p) => ctx.sourceFiles().filter((q) => q !== p && ctx.facts(q).resolvedImports.includes(p));

// ---- file-like kinds -------------------------------------------------------------------------
function buildFile(ctx, p, detail, kind) {
  if (!isFile(ctx, p)) return null;
  const d = LEVEL[detail];
  const f = ctx.facts(p);
  const users = importedBy(ctx, p);
  const tests = testsFor(ctx, { names: [path.basename(p, path.extname(p))] }).filter((t) => t !== p);
  const rules = violationsFor(ctx, (x) => x === p);
  const featureMatch = p.match(new RegExp(`^${ctx.featuresRoot()}/([^/]+)/`));
  const wf = f.layer === 'workflow' ? machinesOf(ctx, [p], { withStates: d >= 2 }) : null;
  const sections = {
    file: { path: p, layer: f.layer, loc: f.loc, purpose: f.purpose, ...(f.error ? { error: f.error } : {}) },
    exports: d === 0 ? f.exports.map((e) => e.name) : f.exports,
    ...(f.props?.length ? { props: f.props } : {}),
    ...(f.endpoints?.length ? { endpoints: f.endpoints } : {}),
    ...(wf?.length ? { workflows: wf } : {}),
    dependencies: {
      imports: d === 0 ? f.resolvedImports.length : f.resolvedImports.map((t) => ({ path: t, layer: ctx.layerOf(t) })),
      externalPackages: f.external,
      usedBy: d === 0 ? users.length : users,
    },
    rules: d === 0 ? rules.counts : rules,
    tests: d === 0 ? { count: tests.length } : { count: tests.length, files: tests },
  };
  const findings = rules.violations.map((v) => ({ severity: v.severity === 'error' ? 'error' : 'warning', code: v.rule, message: v.message }));
  if (f.error) findings.push({ severity: 'warning', code: 'parse', message: f.error });
  for (const m of wf || []) for (const x of m.findings.filter((y) => y.severity === 'warning')) findings.push({ severity: 'warning', code: 'workflow', message: `${m.machine}: ${x.message}` });
  return {
    name: path.basename(p), path: p,
    summary: `${kind === 'file' ? 'File' : kind[0].toUpperCase() + kind.slice(1)} ${p}: ${f.purpose} ${f.exports.length} export(s), ${f.loc} LOC, imported by ${users.length} file(s).`,
    sections, health: healthFrom(findings),
    links: { parent: featureMatch ? refOf('feature', featureMatch[1]) : (path.dirname(p) === '.' ? 'project:.' : refOf('package', path.dirname(p))), children: f.exports.slice(0, 10).map((e) => refOf('export', `${p}#${e.name}`)) },
    next: [...users.slice(0, 2).map((u) => nextItem('file', u, 'A file that uses this one')), ...f.resolvedImports.slice(0, 2).map((t) => nextItem('file', t, 'A file this one depends on'))],
  };
}

const FILE_LAYER_KINDS = ['component', 'hook', 'service', 'domain', 'page', 'controller', 'workflow'];
const LAYER_DESC = { component: 'A presentation component', hook: 'A React hook', service: 'A service (external effects)', domain: 'A pure domain module', page: 'A page (presentation)', controller: 'A controller', workflow: 'A workflow file and its state machines' };

function fileKind(kind) {
  const layer = kind === 'file' ? null : kind;
  const layerFiles = (ctx) => ctx.sourceFiles().filter((p) => !isTestFile(p) && (layer ? ctx.layerOf(p) === layer : true));
  return {
    kind,
    description: kind === 'file' ? 'Any source file (purpose, exports/signatures, props, endpoints, imports, users, rules, tests).' : `${LAYER_DESC[kind]}, addressed by path, file name, export name, or feature/name.`,
    list: (ctx) => layerFiles(ctx).map((p) => ({ id: p, name: path.basename(p), path: p })),
    resolve: (ctx, ref, { explicit } = {}) => {
      const r = norm(ref);
      if (isFile(ctx, r) && SOURCE_EXT.has(path.extname(r))) {
        const l = ctx.layerOf(r);
        if (layer ? l === layer : explicit || !FILE_LAYER_KINDS.includes(l)) return [{ kind, id: r, tier: 1 }];
        if (layer && explicit) return [];
        return [];
      }
      if (!layer) return [];
      const [f, n] = r.includes('/') ? [r.split('/')[0], r.split('/').slice(1).join('/')] : [null, r];
      if (f && !featureNames(ctx).includes(f)) return [];
      return layerFiles(ctx).filter((p) => (!f || p.startsWith(`${ctx.featuresRoot()}/${f}/`)) && (path.basename(p, path.extname(p)) === n || ctx.facts(p).exports.some((e) => e.name === n)))
        .map((p) => ({ kind, id: p, tier: 2 }));
    },
    summarize: (ctx, id, detail) => buildFile(ctx, id, detail, kind),
  };
}
export const fileKinds = ['file', ...FILE_LAYER_KINDS].map(fileKind);

// ---- export ----------------------------------------------------------------------------------
export const exportKind = {
  kind: 'export',
  description: 'One exported function/const/type: signature, behaviour in English, users. Address as path#name.',
  list: (ctx) => ctx.sourceFiles().filter((p) => !isTestFile(p)).flatMap((p) => ctx.facts(p).exports.map((e) => ({ id: `${p}#${e.name}`, name: e.name, path: p }))),
  resolve: (ctx, ref) => {
    const [p, n] = norm(ref).split('#');
    return n && isFile(ctx, p) && ctx.facts(p).exports.some((e) => e.name === n) ? [{ kind: 'export', id: `${p}#${n}`, tier: 1 }] : [];
  },
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    const [p, n] = id.split('#');
    const f = ctx.facts(p);
    const e = f.exports.find((x) => x.name === n);
    if (!e) return null;
    let behavior = null;
    try {
      const src = fs.readFileSync(path.join(ctx.root, p), 'utf8');
      const entry = extractExports(src).find((x) => x.name === n);
      const code = entry && extractDeclarationSource(src, entry.index);
      if (code) { const b = describeImplementation(code); behavior = d >= 2 ? b : b.length > 240 ? b.slice(0, 237) + '...' : b; }
    } catch { /* best effort */ }
    const users = importedBy(ctx, p);
    return {
      name: n, path: p,
      summary: `${e.kind} ${e.signature || n} exported from ${p}${behavior ? ` — ${behavior}` : ''}`,
      sections: {
        export: { name: n, kind: e.kind, signature: e.signature || n, file: p, layer: f.layer, filePurpose: f.purpose },
        ...(behavior ? { behavior } : {}),
        usedBy: d === 0 ? users.length : users,
        tests: { files: testsFor(ctx, { names: [path.basename(p, path.extname(p))] }).filter((t) => t !== p) },
      },
      health: healthFrom([]),
      links: { parent: refOf('file', p) }, next: [nextItem('file', p, 'The file this export lives in')],
    };
  },
};

// ---- package (any directory) -----------------------------------------------------------------
export const packageKind = {
  kind: 'package',
  description: 'Any directory as a package (incl. Construct\'s own packages/ast, src/engine): files + purposes, entry exports, README, dependencies.',
  list: (ctx) => {
    const dirs = new Set();
    for (const p of ctx.sourceFiles()) { const parts = p.split('/'); for (let i = 1; i < Math.min(parts.length, 3); i++) dirs.add(parts.slice(0, i).join('/')); }
    return [...dirs].sort().map((id) => ({ id, name: id, path: id }));
  },
  resolve: (ctx, ref) => { const r = norm(ref); return r && r !== '.' && isDir(ctx, r) ? [{ kind: 'package', id: r, tier: 2 }] : []; },
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    const files = ctx.sourceFiles().filter((p) => p.startsWith(id + '/') && !isTestFile(p));
    if (!files.length) return null;
    const facts = files.map((p) => ctx.facts(p));
    const entry = facts.find((f) => /^index\.[jt]sx?$|^index\.mjs$/.test(path.basename(f.path)) && path.dirname(f.path) === id);
    let readme = null;
    for (const n of ['README.md', 'readme.md']) if (isFile(ctx, `${id}/${n}`)) {
      readme = fs.readFileSync(path.join(ctx.root, id, n), 'utf8').split(/\n\s*\n/).map((s) => s.replace(/^#+\s.*\n?/gm, '').trim()).find((s) => s && !s.startsWith('```') && !s.startsWith('|'))?.replace(/\s+/g, ' ').slice(0, 300) || null;
    }
    const inSelf = (t) => t.startsWith(id + '/');
    const external = [...new Set(facts.flatMap((f) => f.external))].sort();
    const usesInternal = [...new Set(facts.flatMap((f) => f.resolvedImports).filter((t) => !inSelf(t)).map((t) => t.split('/').slice(0, Math.min(2, t.split('/').length - 1) || 1).join('/')))].sort();
    const usedBy = ctx.sourceFiles().filter((q) => !q.startsWith(id + '/') && ctx.facts(q).resolvedImports.some(inSelf));
    const rules = violationsFor(ctx, (f) => f.startsWith(id + '/'));
    const tests = testsFor(ctx, { dir: id, names: [path.basename(id)] });
    return {
      name: id, path: id,
      summary: `Package ${id}: ${files.length} file(s), ${facts.reduce((s, f) => s + f.loc, 0)} LOC${readme ? `. ${readme.split(/(?<=[.!?])\s/)[0]}` : entry ? `. ${entry.purpose}` : ''}`,
      sections: {
        ...(readme ? { readme } : {}),
        ...(entry ? { entry: { path: entry.path, exports: d === 0 ? entry.exports.map((e) => e.name) : entry.exports.map((e) => e.signature || e.name) } } : {}),
        files: d === 0 ? { count: files.length, names: files.slice(0, 10).map((p) => path.basename(p)) } : facts.map((f) => fileEntry(f, { withExports: d >= 2 })),
        dependencies: { externalPackages: external, usesInternal, usedBy: d === 0 ? usedBy.length : usedBy.slice(0, d >= 2 ? 200 : 15) },
        rules: d === 0 ? rules.counts : rules,
        tests: d === 0 ? { count: tests.length } : { count: tests.length, files: tests },
      },
      health: healthFrom([
        ...rules.violations.map((v) => ({ severity: v.severity === 'error' ? 'error' : 'warning', code: v.rule, message: `${v.file}: ${v.message}` })),
        ...(tests.length ? [] : [{ severity: 'info', code: 'no-tests', message: 'No test files found for this package.' }]),
      ]),
      links: { parent: path.dirname(id) === '.' ? 'project:.' : refOf('package', path.dirname(id)), children: files.slice(0, 20).map((p) => refOf('file', p)) },
      next: files.slice(0, 3).map((p) => nextItem('file', p, 'Drill into this file')),
    };
  },
};

// ---- route -----------------------------------------------------------------------------------
function findRoute(ctx, url) {
  for (const appDir of ['app', 'src/app']) {
    const abs = path.join(ctx.root, appDir);
    if (!fs.existsSync(abs)) continue;
    try {
      const entry = findRouteEntryFile(resolveUrlToFolder(abs, url));
      return { url, entry: path.relative(ctx.root, entry).split(path.sep).join('/'), router: 'next-app' };
    } catch { /* try next */ }
  }
  // react-spa: the adapter knows which controller(s) this route renders (#334), so a route's chain
  // starts from those, not from every controller the route table imports.
  if (frameworkOf(ctx) === 'react-spa') {
    const hit = discoverRoutes(ctx).find((r) => r.route === url);
    if (hit) return { url, entry: hit.file, router: 'react-spa', controllers: hit.entries.map((e) => e.file) };
  }
  try {
    const src = fs.readFileSync(findReactSpaRoutesFile(ctx.root), 'utf8');
    const hit = parseReactSpaRoutes(src).find((r) => r.path === url);
    if (hit) return { url, entry: path.relative(ctx.root, findReactSpaRoutesFile(ctx.root)).split(path.sep).join('/'), router: 'react-spa', component: hit.component };
  } catch { /* none */ }
  return null;
}

export const routeKind = {
  kind: 'route',
  description: 'A URL route (e.g. /login): entry file, the controller/feature it renders, and the import chain behind it.',
  list: (ctx) => (frameworkOf(ctx) === 'react-spa' ? [...new Set(discoverRoutes(ctx).map((r) => r.route))].map((id) => ({ id, name: id })) : ctx.sourceFiles().map((p) => p.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/)).filter(Boolean).map((m) => ({ id: '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/'), name: '/' + m[1] }))),
  resolve: (ctx, ref) => (ref.startsWith('/') && findRoute(ctx, ref) ? [{ kind: 'route', id: ref, tier: 1 }] : []),
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    const r = findRoute(ctx, id);
    if (!r) return null;
    const chain = [];
    const seen = new Set([r.entry]);
    let frontier = [r.entry];
    if (r.controllers) {
      for (const c of r.controllers) { seen.add(c); chain.push({ depth: 1, path: c, layer: ctx.layerOf(c), from: r.entry }); }
      frontier = r.controllers;
    }
    const startDepth = r.controllers ? 1 : 0;
    for (let depth = startDepth; depth < 4 && frontier.length; depth++) {
      const next = [];
      for (const p of frontier) for (const t of ctx.facts(p).resolvedImports) {
        if (seen.has(t) || !t.startsWith(ctx.featuresRoot() + '/')) continue;
        seen.add(t); next.push(t);
        chain.push({ depth: depth + 1, path: t, layer: ctx.layerOf(t), from: p });
      }
      frontier = next;
    }
    const features = [...new Set(chain.map((c) => c.path.split('/')[1]))].sort();
    const entry = ctx.facts(r.entry);
    return {
      name: id, path: r.entry,
      summary: `Route ${id} is served by ${r.entry}${features.length ? ` and renders feature(s) ${features.join(', ')}` : ''} (${chain.length} feature file(s) reachable).`,
      sections: { route: r, entryPurpose: entry.purpose, features, chain: d === 0 ? chain.map((c) => c.layer).filter(Boolean) : chain.slice(0, d >= 2 ? 100 : 20) },
      health: healthFrom(violationsFor(ctx, (f) => f === r.entry).violations.map((v) => ({ severity: v.severity === 'error' ? 'error' : 'warning', code: v.rule, message: v.message }))),
      links: { children: features.map((f) => refOf('feature', f)), parent: refOf('file', r.entry) },
      next: features.map((f) => nextItem('feature', f, 'Feature rendered by this route')),
    };
  },
};
