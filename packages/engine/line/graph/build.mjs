// Line knowledge graph (G1), the builder: ONE graph of a Line project from static analysis, stored at
// <state>/graph/{nodes.jsonl, edges.jsonl, index.json} through the transactional writer's writeLineState. Shapes are
// contract.mjs; no code text and no embeddings are ever stored (ids, labels, file:line and hashes only).
//
// What it reuses (nothing here re-derives what a Construct block already knows):
//   items, base links, findings  model.mjs readLineProject (the Line profile's own view: baseLinks, moduleEdges, classify)
//   IMPORTS                      import.mjs importGraph + route-resolver resolveImportSpecifier (relative and alias)
//   item layers (attrs)          core mechanical-plan readSignals + classify
//   units, PART_OF               logicMap.mjs buildLogicMap (fingerprints)
//   CALLS/RENDERS/USES_HOOK/HANDLES_EVENT   the TypeScript checker (symbols resolved through import aliases, not text)
//   process layer                findings (validate), spec.md acceptance points, the plan store's steps
//   domain layer                 domain.mjs (stub; G3)          runtime layer   reserved (G2)
//
// Incremental: every edge belongs to the file of its evidence, every item and unit node to its file. A file's
// fragment is recomputed when its content hash changes, and so is every file with an edge into a changed file's nodes.
// The project part (library and feature nodes, findings, spec points, plan steps) is recomputed whenever anything
// changed, because validate is project-wide. Adding or removing a file rebuilds every fragment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { readSignals, classify } from '@line/construct-core/mechanical-plan';
import { resolveImportSpecifier } from '@line/construct-core/route-resolver';
import { writeLineState } from '../../transactionalWriter.mjs';
import { readLineProject } from '../model.mjs';
import { importGraph } from '../import.mjs';
import { buildLogicMap } from '../logicMap.mjs';
import { classifyFile } from '../logicVerify/purity.mjs';
import { lineStateDir } from '../workspace.mjs';
import { domainLayer } from './domain.mjs';
import { GRAPH_VERSION, MAX_LABEL, assertLineGraph, countGraph, edgeKey } from './contract.mjs';

/** @typedef {import('./contract.mjs').GraphNode} GraphNode */
/** @typedef {import('./contract.mjs').GraphEdge} GraphEdge */
/** @typedef {import('./contract.mjs').LineGraph} LineGraph */
/** @typedef {import('./contract.mjs').GraphEdgeType} GraphEdgeType */
/** @typedef {{nodes: GraphNode[], edges: GraphEdge[]}} Fragment */
/** @typedef {{id: string, name: string, file: string, area: 'library'|'feature', feature: string|null, kind: string, baseId: string|null, level?: string}} Item */
/** @typedef {{graph: LineGraph, stats: {analyzed: string[], reused: string[], full: boolean}, written: boolean}} BuildResult */

const posix = path.posix;
const CODE = /\.[cm]?[jt]sx?$/;
const SPEC_FILE = /(^|\/)spec\.md$/;
const SPEC_POINT = /^\s*[-*]\s+(.+?)\s*$/;
const contentHash = (/** @type {string|Buffer} */ s) => `sha256:${crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)}`;
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const lineAt = (src, re) => { const i = src.split('\n').findIndex((l) => re.test(l)); return i >= 0 ? i + 1 : 1; };

/**
 * A label a person reads: one line, no code characters, at most MAX_LABEL long.
 * @param {string} s
 * @returns {string}
 */
export function safeLabel(s) {
  const t = String(s).replace(/\s+/g, ' ').replace(/=>/g, 'to').replace(/[{};<>]/g, '').trim() || 'unnamed';
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}…` : t;
}

/**
 * Where the graph lives for a project (its Line state folder), root-relative.
 * @param {string} root
 * @returns {{stateDir: string, nodes: string, edges: string, index: string}}
 */
export const graphFiles = (root) => {
  const dir = `${lineStateDir(root)}/graph`;
  return { stateDir: lineStateDir(root), nodes: `${dir}/nodes.jsonl`, edges: `${dir}/edges.jsonl`, index: `${dir}/index.json` };
};

/**
 * Every file the graph is built from: code and JSON fixtures under the library and features, and each spec.md.
 * @param {string} root
 * @returns {{layout: {library: string, features: string}, files: string[]}}
 */
export function graphSources(root) {
  const layout = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (CODE.test(e.name) || e.name.endsWith('.json') || SPEC_FILE.test(r)) out.push(r);
    }
  };
  walk(layout.library);
  walk(layout.features);
  return { layout, files: out.sort() };
}

/**
 * The content hash of every source file.
 * @param {string} root
 * @param {string[]} files
 * @returns {Record<string, string>}
 */
function hashFiles(root, files) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of files) { try { out[f] = contentHash(fs.readFileSync(path.join(root, f))); } catch { /* vanished */ } }
  return out;
}

/**
 * The project frame: Line's items by file, findings, specs (readLineProject: the same view validate has).
 * @param {string} root
 */
function projectFrame(root) {
  const project = readLineProject(root);
  /** @type {Map<string, Item>} */
  const items = new Map();
  for (const l of project.library) items.set(l.file, { id: `item:library/${l.id}`, name: l.name, file: l.file, area: 'library', feature: null, kind: l.kind, baseId: null, ...(l.level ? { level: l.level } : {}) });
  for (const f of project.features) for (const i of f.items) items.set(i.file, { id: `item:${i.id}`, name: i.name, file: i.file, area: 'feature', feature: f.name, kind: i.kind, baseId: i.base.libraryId ? `item:library/${i.base.libraryId}` : null });
  return { project, items };
}

/** A TypeScript program over `files` (roots), with the project's own tsconfig paths when it has one. */
function programFor(root, files) {
  /** @type {ts.CompilerOptions} */
  let options = {};
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const abs = path.join(root, name);
    if (!fs.existsSync(abs)) continue;
    const read = ts.readConfigFile(abs, ts.sys.readFile);
    if (!read.error) options = ts.parseJsonConfigFileContent(read.config, ts.sys, root).options;
    break;
  }
  options = { ...options, noEmit: true, allowJs: true, jsx: ts.JsxEmit.Preserve, noLib: true, types: [], skipLibCheck: true, resolveJsonModule: true, esModuleInterop: true };
  if (options.paths && !options.baseUrl) options.baseUrl = root;
  return ts.createProgram(files.map((f) => path.join(root, f)), options);
}

/**
 * The static edges of one file through the checker: CALLS, USES_HOOK, RENDERS, HANDLES_EVENT between items.
 * @param {string} root
 * @param {ts.Program} program
 * @param {Item} self
 * @param {Map<string, Item>} items
 * @returns {GraphEdge[]}
 */
function staticEdges(root, program, self, items) {
  const sf = program.getSourceFile(path.join(root, self.file));
  if (!sf) return [];
  const checker = program.getTypeChecker();
  /** @type {GraphEdge[]} */
  const out = [];
  const line = (/** @type {ts.Node} */ n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const itemOf = (/** @type {ts.Node} */ n) => {
    let sym = checker.getSymbolAtLocation(n);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { return null; } }
    const decl = sym.declarations?.[0];
    if (!decl) return null;
    return items.get(toRel(root, decl.getSourceFile().fileName)) ?? null;
  };
  const add = (/** @type {GraphEdgeType} */ type, /** @type {Item} */ from, /** @type {Item} */ to, /** @type {ts.Node} */ at) => {
    if (from.id !== to.id) out.push({ from: from.id, to: to.id, type, layer: 'static', evidence: { file: self.file, line: line(at) } });
  };
  const visit = (/** @type {ts.Node} */ n) => {
    if (ts.isCallExpression(n)) {
      const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
      const t = itemOf(callee);
      const name = ts.isIdentifier(callee) ? callee.text : '';
      if (t) add(/^use[A-Z0-9]/.test(name) ? 'USES_HOOK' : 'CALLS', self, t, n);
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const t = itemOf(n.tagName);
      if (t) {
        add('RENDERS', self, t, n);
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a) || !a.initializer || !/^on[A-Z]/.test(a.name.getText(sf))) continue;
          const expr = ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
          // The handler's owner: the item that declares a named handler, else this file (an inline handler).
          const owner = (expr && (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) && itemOf(ts.isPropertyAccessExpression(expr) ? expr.name : expr)) || self;
          add('HANDLES_EVENT', owner, t, a);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * One file's fragment: its item node, its unit nodes, its route nodes and every edge whose evidence is in it.
 * @param {string} root
 * @param {Item} self
 * @param {Map<string, Item>} items
 * @param {string} hash The file's content hash.
 * @param {ts.Program|null} program
 * @returns {Fragment}
 */
function fileFragment(root, self, items, hash, program) {
  const src = fs.readFileSync(path.join(root, self.file), 'utf8');
  const code = CODE.test(self.file);
  /** @type {GraphNode[]} */
  const nodes = [];
  /** @type {GraphEdge[]} */
  const edges = [];
  const ev = (l = 1) => ({ file: self.file, line: l });
  let layers = [];
  if (code) { const c = classify(readSignals(src, self.file)); layers = c.layers ?? []; }
  nodes.push({
    id: self.id, kind: 'item', label: safeLabel(self.name), file: self.file, line: 1, hash,
    attrs: { area: self.area, itemKind: self.kind, ...(self.feature ? { feature: self.feature } : {}), ...(self.level ? { level: self.level } : {}), ...(layers.length ? { layers } : {}) },
  });
  edges.push(self.area === 'library'
    ? { from: self.id, to: 'library', type: 'IN_LIBRARY', layer: 'structure', evidence: ev() }
    : { from: self.id, to: `feature:${self.feature}`, type: 'IN_FEATURE', layer: 'structure', evidence: ev() });
  if (self.baseId && self.baseId !== self.id) edges.push({ from: self.id, to: self.baseId, type: 'BASED_ON', layer: 'structure', evidence: ev(lineAt(src, /@line-base\b|"\$lineBase"/)) });
  if (!code) return { nodes, edges };

  // IMPORTS: importGraph's targets (relative and alias), each at the line that names it.
  const g = importGraph(root, [self.file]);
  const targets = g.imports.get(self.file) ?? new Set();
  src.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/g)) {
      const abs = resolveImportSpecifier(path.join(root, self.file), m[2], g.aliases);
      const to = abs ? items.get(toRel(root, abs)) : undefined;
      if (to && to.id !== self.id && targets.has(to.file)) edges.push({ from: self.id, to: to.id, type: 'IMPORTS', layer: 'structure', evidence: ev(i + 1) });
    }
  });

  // Routes this page serves.
  if (self.kind === 'pages') {
    src.split('\n').forEach((text, i) => {
      for (const m of text.matchAll(/@line-route\s+([^\s*]+)/g)) {
        const id = `route:${m[1]}`;
        nodes.push({ id, kind: 'route', label: safeLabel(m[1]), hash: contentHash(m[1]) });
        edges.push({ from: self.id, to: id, type: 'PART_OF', layer: 'structure', evidence: ev(i + 1) });
      }
    });
  }

  // Logic units (fingerprints from the logic map), each PART_OF its item. Labels name the kind and function only.
  try {
    for (const u of buildLogicMap(root, [self.file], { read: () => src, classify: classifyFile }).units) {
      const id = `unit:${u.fingerprint}`;
      // No file or line on the node: the same logic in two files is ONE unit (one fingerprint), PART_OF each item,
      // and each PART_OF edge carries where it sits. So a unit node never depends on which file was read first.
      nodes.push({ id, kind: 'unit', label: safeLabel(u.exportName ? `${u.kind} ${u.exportName}` : `${u.kind} in ${u.fn}`), hash: contentHash(u.fingerprint), attrs: { unitKind: u.kind, ...(u.purity ? { purity: u.purity, effects: u.effects } : {}) } });
      edges.push({ from: id, to: self.id, type: 'PART_OF', layer: 'structure', evidence: ev(u.line) });
    }
  } catch { /* a file that does not parse has no units; validate reports it */ }

  if (program) edges.push(...staticEdges(root, program, self, items));
  return { nodes, edges };
}

/**
 * The project part: library and feature nodes, findings (FLAGS), spec points (COVERS), plan steps (CHANGES) and the
 * domain layer (stub).
 * @param {string} root
 * @param {ReturnType<typeof projectFrame>} frame
 * @param {Record<string, string>} hashes
 * @returns {Fragment}
 */
function projectFragment(root, frame, hashes) {
  const { project, items } = frame;
  /** @type {GraphNode[]} */
  const nodes = [{ id: 'library', kind: 'library', label: 'library', hash: contentHash(project.layout.library) }];
  /** @type {GraphEdge[]} */
  const edges = [];
  for (const f of project.features) {
    nodes.push({ id: `feature:${f.name}`, kind: 'feature', label: safeLabel(f.name), ...(f.spec ? { file: f.spec } : {}), hash: f.spec && hashes[f.spec] ? hashes[f.spec] : contentHash(f.name) });
    if (!f.spec) continue;
    const named = f.items.map((i) => ({ id: `item:${i.id}`, re: new RegExp(`\\b${i.name}\\b`) }));
    let n = 0;
    fs.readFileSync(path.join(root, f.spec), 'utf8').split('\n').forEach((text, i) => {
      const m = SPEC_POINT.exec(text);
      if (!m) return;
      n += 1;
      const id = `spec:${f.name}#${n}`;
      nodes.push({ id, kind: 'specPoint', label: safeLabel(m[1]), file: f.spec, line: i + 1, hash: contentHash(m[1]) });
      for (const it of named) if (it.re.test(m[1])) edges.push({ from: id, to: it.id, type: 'COVERS', layer: 'process', evidence: { file: f.spec, line: i + 1 } });
    });
  }
  for (const x of project.findings) {
    const id = `finding:${x.rule}|${x.file}|${x.line}`;
    if (nodes.some((nd) => nd.id === id)) continue;
    nodes.push({ id, kind: 'finding', label: safeLabel(x.sentence), file: x.file, line: x.line, hash: contentHash(`${x.rule}|${x.sentence}`), attrs: { rule: x.rule, severity: x.severity } });
    const it = items.get(x.file);
    if (it) edges.push({ from: id, to: it.id, type: 'FLAGS', layer: 'process', evidence: { file: x.file, line: x.line } });
  }
  const steps = planSteps(root, items);
  nodes.push(...steps.nodes);
  edges.push(...steps.edges);
  const domain = domainLayer(root, frame);
  nodes.push(...domain.nodes);
  edges.push(...domain.edges);
  return { nodes, edges };
}

/**
 * Plan steps from the plan store (<state>/plans/*.json) and the items each one changes: a step whose argument names
 * an item file or a Line item id CHANGES that item.
 * @param {string} root
 * @param {Map<string, Item>} items
 * @returns {Fragment}
 */
function planSteps(root, items) {
  const dir = `${lineStateDir(root)}/plans`;
  /** @type {Fragment} */
  const out = { nodes: [], edges: [] };
  let names = [];
  try { names = fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.json')).sort(); } catch { return out; }
  const byKey = new Map();
  for (const it of items.values()) { byKey.set(it.file, it.id); byKey.set(it.id.slice('item:'.length), it.id); byKey.set(it.id.replace(/^item:library\//, ''), it.id); }
  const strings = (v, acc = []) => { if (typeof v === 'string') acc.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, acc); return acc; };
  for (const name of names) {
    const file = `${dir}/${name}`;
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { continue; }
    const plans = Array.isArray(data?.plans) ? data.plans : [data];
    for (const p of plans) {
      if (!p || !Array.isArray(p.steps)) continue;
      for (const s of p.steps) {
        if (!s?.id || !s?.tool) continue;
        const id = `step:${p.id ?? name.replace(/\.json$/, '')}#${s.id}`;
        if (out.nodes.some((n) => n.id === id)) continue;
        out.nodes.push({ id, kind: 'planStep', label: safeLabel(String(s.tool)), hash: contentHash(`${s.tool}|${JSON.stringify(s.args ?? {})}`) });
        for (const to of new Set(strings(s.args).map((v) => byKey.get(v)).filter(Boolean))) out.edges.push({ from: id, to, type: 'CHANGES', layer: 'process', evidence: { file, line: 1 } });
      }
    }
  }
  return out;
}

/**
 * Join fragments into one sorted graph: first node per id wins (fragments in file order), edges de-duplicated, edges
 * whose ends are missing dropped.
 * @param {Fragment[]} parts
 * @param {Record<string, string>} files
 * @returns {LineGraph}
 */
function assemble(parts, files) {
  /** @type {Map<string, GraphNode>} */
  const nodes = new Map();
  for (const p of parts) for (const n of p.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  /** @type {Map<string, GraphEdge>} */
  const edges = new Map();
  for (const p of parts) for (const e of p.edges) if (nodes.has(e.from) && nodes.has(e.to)) edges.set(edgeKey(e), e);
  const ns = [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const es = [...edges.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, e]) => e);
  return { nodes: ns, edges: es, index: { version: GRAPH_VERSION, files: Object.fromEntries(Object.entries(files).sort()), counts: countGraph(ns, es) } };
}

/**
 * Read the stored graph, or null when there is none (or it does not fit the contract).
 * @param {string} root
 * @returns {LineGraph|null}
 */
export function readLineGraph(root) {
  const f = graphFiles(root);
  try {
    const jsonl = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const g = { nodes: jsonl(f.nodes), edges: jsonl(f.edges), index: JSON.parse(fs.readFileSync(path.join(root, f.index), 'utf8')) };
    assertLineGraph(g);
    return g;
  } catch { return null; }
}

/** Store the graph through writeLineState; a file whose content is unchanged is not rewritten. */
function storeGraph(root, graph) {
  const f = graphFiles(root);
  const put = (rel, text) => {
    try { if (fs.readFileSync(path.join(root, rel), 'utf8') === text) return false; } catch { /* new */ }
    writeLineState(root, rel, text, { stateDir: f.stateDir });
    return true;
  };
  const a = put(f.nodes, graph.nodes.map((n) => JSON.stringify(n)).join('\n') + (graph.nodes.length ? '\n' : ''));
  const b = put(f.edges, graph.edges.map((e) => JSON.stringify(e)).join('\n') + (graph.edges.length ? '\n' : ''));
  const c = put(f.index, `${JSON.stringify(graph.index, null, 2)}\n`);
  return a || b || c;
}

/**
 * Rebuild the fragments of `redo` and keep the stored ones for every other file.
 * @param {string} root
 * @param {Record<string, string>} hashes
 * @param {Set<string>|null} redo  null: every file.
 * @param {LineGraph|null} prev
 * @returns {{graph: LineGraph, analyzed: string[], reused: string[]}}
 */
function compose(root, hashes, redo, prev) {
  const frame = projectFrame(root);
  const itemFiles = [...frame.items.keys()].filter((f) => f in hashes).sort();
  const analyze = itemFiles.filter((f) => !redo || redo.has(f));
  const reused = itemFiles.filter((f) => redo && !redo.has(f));
  const codeFiles = analyze.filter((f) => CODE.test(f));
  const program = codeFiles.length ? programFor(root, codeFiles) : null;
  /** @type {Fragment[]} */
  const parts = [];
  for (const f of itemFiles) {
    if (!redo || redo.has(f)) { parts.push(fileFragment(root, /** @type {Item} */ (frame.items.get(f)), frame.items, hashes[f], program)); continue; }
    // Kept: the nodes this file owns and the edges whose evidence is in it, as stored.
    const kept = (prev?.edges ?? []).filter((e) => 'file' in e.evidence && e.evidence.file === f);
    // Unit and route nodes carry no file: keep those this file's kept PART_OF edges join.
    const joined = new Set(kept.filter((e) => e.type === 'PART_OF').flatMap((e) => [e.from, e.to]));
    parts.push({ nodes: (prev?.nodes ?? []).filter((n) => (n.kind === 'item' && n.file === f) || ((n.kind === 'unit' || n.kind === 'route') && joined.has(n.id))), edges: kept });
  }
  parts.push(projectFragment(root, frame, hashes));
  const graph = assemble(parts, hashes);
  assertLineGraph(graph);
  return { graph, analyzed: analyze, reused };
}

/**
 * Build the project's graph. With a stored graph whose file hashes all match, nothing is analysed and nothing is
 * written; otherwise only the changed files (and the files with edges into them) are re-analysed.
 * @param {string} root
 * @param {{files?: string[], write?: boolean, force?: boolean}} [options] `files` limits the sources to these
 *   (root-relative; the project part still covers the whole project); `force` ignores the stored graph.
 * @returns {BuildResult}
 */
export function buildLineGraph(root, { files, write = true, force = false } = {}) {
  const all = graphSources(root).files;
  const sources = files ? all.filter((f) => files.includes(f)) : all;
  const hashes = hashFiles(root, sources);
  const prev = force ? null : readLineGraph(root);
  if (prev && sameKeys(prev.index.files, hashes)) {
    const changed = Object.keys(hashes).filter((f) => prev.index.files[f] !== hashes[f]);
    if (!changed.length) return { graph: prev, stats: { analyzed: [], reused: Object.keys(hashes).sort(), full: false }, written: false };
    return finish(root, compose(root, hashes, withDependents(prev, changed), prev), write, false);
  }
  return finish(root, compose(root, hashes, null, null), write, true);
}

/**
 * Update the stored graph after `changedFiles` changed: only their fragments and those of files with edges into
 * them are recomputed (a file added or removed rebuilds every fragment).
 * @param {string} root
 * @param {string[]} changedFiles Root-relative.
 * @param {{write?: boolean}} [options]
 * @returns {BuildResult}
 */
export function updateLineGraph(root, changedFiles, { write = true } = {}) {
  const prev = readLineGraph(root);
  const hashes = hashFiles(root, graphSources(root).files);
  if (!prev || !sameKeys(prev.index.files, hashes)) return finish(root, compose(root, hashes, null, null), write, true);
  const changed = changedFiles.map((f) => f.split(path.sep).join('/')).filter((f) => f in hashes);
  return finish(root, compose(root, hashes, withDependents(prev, changed), prev), write, false);
}

const sameKeys = (a, b) => { const x = Object.keys(a).sort(); const y = Object.keys(b).sort(); return x.length === y.length && x.every((k, i) => k === y[i]); };

/** The changed files plus every file whose stored edges point into a changed file's nodes. */
function withDependents(prev, changed) {
  const set = new Set(changed);
  const owned = new Set(prev.nodes.filter((n) => n.kind === 'item' && n.file && set.has(n.file)).map((n) => n.id));
  for (const e of prev.edges) if (e.type === 'PART_OF' && 'file' in e.evidence && set.has(e.evidence.file) && e.from.startsWith('unit:')) owned.add(e.from);
  for (const e of prev.edges) if ('file' in e.evidence && owned.has(e.to)) set.add(e.evidence.file);
  return set;
}

/** @returns {BuildResult} */
function finish(root, { graph, analyzed, reused }, write, full) {
  const written = write ? storeGraph(root, graph) : false;
  return { graph, stats: { analyzed, reused, full }, written };
}

/**
 * One sentence about a graph (the CLI's summary).
 * @param {LineGraph} g
 * @param {{analyzed: string[], reused: string[]}} [stats]
 * @returns {string}
 */
export function graphSentence(g, stats) {
  const c = g.index.counts;
  const items = c.byKind.item ?? 0;
  const layers = ['structure', 'static', 'domain', 'process', 'runtime'].map((l) => `${c.byLayer[l] ?? 0} ${l}`).join(', ');
  const work = stats ? ` (${stats.analyzed.length} file${stats.analyzed.length === 1 ? '' : 's'} analysed, ${stats.reused.length} reused)` : '';
  return `The Line graph has ${c.nodes} nodes (${items} item${items === 1 ? '' : 's'}, ${c.byKind.unit ?? 0} logic units) and ${c.edges} edges: ${layers}${work}.`;
}
