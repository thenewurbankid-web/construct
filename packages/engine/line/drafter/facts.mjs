// The drafter's two views of a project. `factsSummary`: a fixed-size summary (names, kinds, base links, findings with
// their typed fixes, page parts and fragment handles; never file contents) that the domain map and the templates read.
// `factsSnapshot`: the evaluation view the expressions run against (mirror of the expression contract's snapshot,
// replace on merge), which may hold file contents because it is never stored or shown to a model.
import fs from 'node:fs';
import path from 'node:path';
import { readLineProject } from '../model.mjs';
import { readPageTree } from '../pageProp.mjs';
import { listFragments } from '../fragments.mjs';
import { KIND_LAYER } from './contract.mjs';

/** Caps that keep the summary a fixed size whatever the project. */
export const CAPS = Object.freeze({ features: 50, items: 50, library: 200, findings: 50, pages: 50, parts: 30, fragments: 100 });

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const flat = (roots) => { const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; roots.forEach(walk); return out; };

/**
 * The fixed-size facts summary of a Line project.
 * @param {string} root Project root.
 * @param {import('../contract.mjs').LineProject} [project] An already-read project.
 * @returns {{layout: {library: string, features: string, state: string}, features: {name: string, items: {id: string, kind: string, name: string, file: string, base: string|null, layer: string}[]}[], library: {id: string, kind: string, name: string, file: string, layer: string, usedBy: number}[], findings: {key: string, rule: string, file: string, item: string|null, fixes: {id: string, rank: number, step: {tool: string, args: Record<string, unknown>}|null}[]}[], pages: {file: string, item: string, contentHash: string, parts: {nodeId: string, tag: string, props: {name: string, kind: string, value: unknown}[]}[]}[], fragments: {file: string, item: string, contentHash: string, id: string, kind: string, nodeId: string}[], routes: {item: string, path: string}[], specs: {feature: string, text: string}[]}}
 */
export function factsSummary(root, project = readLineProject(root)) {
  const features = project.features.slice(0, CAPS.features).map((f) => ({
    name: f.name,
    items: f.items.slice(0, CAPS.items).map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base.libraryId, layer: KIND_LAYER[i.kind] })),
  }));
  const library = project.library.slice(0, CAPS.library).map((l) => ({ id: l.id, kind: l.kind, name: l.name, file: l.file, layer: KIND_LAYER[l.kind], usedBy: l.usedBy.length }));
  const itemOfFile = new Map(/** @type {[string, string][]} */ ([...features.flatMap((f) => f.items.map((i) => [i.file, i.id])), ...library.map((l) => [l.file, l.id])]));
  const findings = project.findings.slice(0, CAPS.findings).map((x) => ({
    key: x.key ?? `${x.rule}|${x.file}|${x.line}`, rule: x.rule, file: x.file, item: itemOfFile.get(x.file) ?? null,
    fixes: (x.fixes ?? []).map((y) => ({ id: y.id, rank: y.rank, step: y.step ? { tool: y.step.tool, args: { ...y.step.args } } : null })),
  }));
  const pageItems = features.flatMap((f) => f.items.filter((i) => i.kind === 'pages')).slice(0, CAPS.pages);
  const pages = pageItems.map((i) => safe(() => {
    const t = readPageTree(root, i.file);
    const parts = flat(t.roots).filter((n) => n.settable).slice(0, CAPS.parts).map((n) => ({ nodeId: n.id, tag: n.tag, props: n.props.map((p) => ({ name: p.name, kind: p.kind, value: p.value })) }));
    return { file: i.file, item: i.id, contentHash: t.contentHash, parts };
  }, null)).filter(Boolean);
  const codeItems = features.flatMap((f) => f.items.filter((i) => i.kind !== 'fixtures'));
  const fragments = [];
  for (const i of codeItems) {
    if (fragments.length >= CAPS.fragments) break;
    const l = safe(() => listFragments(root, i.file), null);
    if (l) for (const g of l.fragments) fragments.push({ file: i.file, item: i.id, contentHash: l.contentHash, id: g.id, kind: g.kind, nodeId: g.nodeId });
  }
  const routes = [];
  const specs = [];
  for (const f of project.features) {
    for (const i of f.items) {
      const src = i.kind === 'pages' ? safe(() => fs.readFileSync(path.join(root, i.file), 'utf8'), '') : '';
      const m = /@line-route\s+(\S+)/.exec(src);
      if (m) routes.push({ item: i.id, path: m[1] });
    }
    if (f.spec) specs.push({ feature: f.name, text: safe(() => fs.readFileSync(path.join(root, f.spec), 'utf8'), '').slice(0, 2000) });
  }
  return { layout: project.layout, features, library, findings: findings.slice(0, CAPS.findings), pages, fragments: fragments.slice(0, CAPS.fragments), routes, specs };
}

/** Every file under the library and features folders (the evaluation view). */
function codeFiles(root, layout) {
  /** @type {Record<string, string>} */
  const out = {};
  const walk = (rel) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(r); } else out[r] = safe(() => fs.readFileSync(path.join(root, r), 'utf8'), '');
    }
  };
  walk(layout.library); walk(layout.features);
  return out;
}

/**
 * The facts snapshot (MIRROR of the expression contract's snapshot; replace on merge). `before` gives findingsNew.
 * @param {string} root
 * @param {import('./contract.mjs').FactsSnapshot|null} [before]
 * @returns {import('./contract.mjs').FactsSnapshot}
 */
export function factsSnapshot(root, before = null) {
  const project = readLineProject(root);
  const findings = project.findings.map((x) => ({ key: x.key ?? `${x.rule}|${x.file}|${x.line}`, rule: x.rule, file: x.file, line: x.line }));
  const had = new Set((before?.findings ?? []).map((x) => `${x.rule}|${x.file}`));
  /** @type {Record<string, any[]>} */
  const parts = {};
  for (const f of project.features) for (const i of f.items) {
    if (i.kind !== 'pages') continue;
    const t = safe(() => readPageTree(root, i.file), null);
    if (t) parts[i.file] = flat(t.roots).map((n) => ({ nodeId: n.id, tag: n.tag, props: Object.fromEntries(n.props.map((p) => [p.name, p.value])) }));
  }
  return {
    files: codeFiles(root, project.layout),
    library: project.library.map((l) => l.id),
    features: project.features.map((f) => ({ name: f.name, items: f.items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base.libraryId })) })),
    findings,
    findingsNew: before ? findings.filter((x) => !had.has(`${x.rule}|${x.file}`)) : [],
    plan: null,
    parts,
  };
}
