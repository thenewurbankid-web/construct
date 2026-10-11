// Facts: the ONE facts module of Line. Two views of a project, both static and fixed size:
//
//   buildFacts     the snapshot an expression is evaluated against (contract.mjs LineFacts): readLineProject
//                  (library, features, findings) plus the library and feature files (bytes and sha256, the hash spot
//                  code editing uses), the structure hashes (structure.mjs) and, while a step is checked, what the step
//                  planned and what the writer did. Files and findings are capped (FACTS_LIMITS); `truncated` counts
//                  what was left out. Lazy: `plan` and `findingsNew` are known up front; the rest is read once, the
//                  first time an expression (or the summary) needs it. Two more views are lazy and never enumerated (so
//                  never summarized, hashed or stored): `contents` (file text, for the fileContains check) and `parts`
//                  (page parts and their props, for the propIs check).
//   factsSummary   the drafter's fixed-size summary (names, kinds, base links, findings with their typed fixes, page
//                  parts and fragment handles; never file contents) that the domain map, the route templates and Train
//                  Line's worlds read.
// (Merged 2026-10-11: the drafter's own facts mirror and Train Line's facts view now build on this module.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FACTS_LIMITS } from './contract.mjs';
import { readLineProject } from './model.mjs';
import { readPageTree } from './pageProp.mjs';
import { listFragments } from './fragments.mjs';
import { structureOf, readerOf, hash16, KIND_LAYER } from './structure.mjs';

const SKIP = new Set(['node_modules', '.git', '.next']);
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const flat = (roots) => { const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; roots.forEach(walk); return out; };

/**
 * Library and feature files: root-relative posix path -> {bytes, hash}, at most `limit`, sorted.
 * @param {string} root
 * @param {string[]} dirs
 * @param {number} [limit]
 * @returns {{files: Record<string, {bytes: number, hash: string}>, truncated: number}}
 */
export function fileFacts(root, dirs, limit = FACTS_LIMITS.files) {
  const found = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (SKIP.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) found.push(r);
    }
  };
  for (const d of dirs) if (d) walk(d);
  /** @type {Record<string, {bytes: number, hash: string}>} */
  const files = {};
  for (const r of found.slice(0, limit)) {
    const buf = fs.readFileSync(path.join(root, r));
    files[r] = { bytes: buf.length, hash: crypto.createHash('sha256').update(buf.toString('utf8')).digest('hex') };
  }
  return { files, truncated: Math.max(0, found.length - limit) };
}

/**
 * The facts' view of readLineProject.
 * @param {any} project
 * @returns {{library: any, features: any, findings: any[], truncatedFindings: number}}
 */
export function projectFacts(project) {
  const library = {};
  for (const l of project.library ?? []) library[l.id] = { kind: l.kind, name: l.name, file: l.file, level: l.level ?? null, usedBy: (l.usedBy ?? []).length };
  const features = {};
  for (const f of project.features ?? []) {
    features[f.name] = {
      spec: Boolean(f.spec),
      items: (f.items ?? []).map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base?.libraryId ?? null, status: String(i.status ?? 'ok'), findings: (i.findings ?? []).length })),
    };
  }
  const all = (project.findings ?? []).map((x) => ({ key: String(x.key ?? `${x.rule}|${x.file}|${x.line ?? 0}`), rule: x.rule, severity: x.severity, file: x.file, fixIds: (x.fixes ?? []).map((fx) => fx.id) }));
  return { library, features, findings: all.slice(0, FACTS_LIMITS.findings), truncatedFindings: Math.max(0, all.length - FACTS_LIMITS.findings) };
}

/**
 * New error findings as the facts keep them.
 * @param {any[]|undefined} findings
 * @returns {{key: string, rule: string, severity: string, file: string}[]}
 */
export const newFindingFacts = (findings) => (findings ?? []).filter((f) => f.severity === 'error').map((f) => ({ key: String(f.key ?? `${f.rule}|${f.file}|${f.line ?? 0}`), rule: f.rule, severity: f.severity, file: f.file }));

/**
 * The findings of `after` that `before` did not have (by rule and file), as the facts keep them: what a change added.
 * @param {{rule: string, file: string}[]} before
 * @param {{key: string, rule: string, severity?: string, file: string}[]} after
 * @returns {{key: string, rule: string, severity: string, file: string}[]}
 */
export function addedFindings(before, after) {
  const had = new Set(before.map((f) => `${f.rule}|${f.file}`));
  return after.filter((f) => !had.has(`${f.rule}|${f.file}`)).map((f) => ({ key: f.key, rule: f.rule, severity: f.severity ?? 'error', file: f.file }));
}

/**
 * Page parts and their props (the propIs check's view), by page file.
 * @param {string} root
 * @param {any} project
 * @returns {Record<string, {nodeId: string, tag: string, props: Record<string, unknown>}[]>}
 */
export function pageParts(root, project) {
  /** @type {Record<string, any[]>} */
  const parts = {};
  for (const f of project.features ?? []) for (const i of f.items ?? []) {
    if (i.kind !== 'pages') continue;
    const t = safe(() => readPageTree(root, i.file), null);
    if (t) parts[i.file] = flat(t.roots).map((n) => ({ nodeId: n.id, tag: n.tag, props: Object.fromEntries(n.props.map((p) => [p.name, p.value])) }));
  }
  return parts;
}

/**
 * The facts snapshot of `root`.
 * @param {string} root
 * @param {{ops?: {readLineProject: (root: string) => any}, plan?: import('./contract.mjs').LineFacts['plan'],
 *   findingsNew?: import('./contract.mjs').LineFacts['findingsNew'], project?: any}} [o] `project`: a readLineProject
 *   result already in hand.
 * @returns {import('./contract.mjs').LineFacts & {project: () => any}}
 */
export function buildFacts(root, { ops, plan = null, findingsNew = [], project } = {}) {
  const read = ops?.readLineProject ?? readLineProject;
  let p = project ?? null; let pf = null; let ff = null; let st = null; let ct = null; let pp = null;
  const proj = () => (p ??= read(root));
  const pfacts = () => (pf ??= projectFacts(proj()));
  const files = () => (ff ??= fileFacts(root, [proj().layout?.library ?? 'library', proj().layout?.features ?? 'features']));
  const contents = () => {
    if (ct) return ct;
    const source = readerOf(root);
    /** @type {Record<string, string>} */
    const out = {};
    for (const f of Object.keys(files().files)) out[f] = source(f);
    return (ct = out);
  };
  const facts = { plan, findingsNew };
  Object.defineProperties(facts, {
    files: { enumerable: true, get: () => files().files },
    library: { enumerable: true, get: () => pfacts().library },
    features: { enumerable: true, get: () => pfacts().features },
    findings: { enumerable: true, get: () => pfacts().findings },
    structure: { enumerable: true, get: () => (st ??= structureOf(proj(), readerOf(root))) },
    truncated: { enumerable: true, get: () => ({ files: files().truncated, findings: pfacts().truncatedFindings }) },
    contents: { enumerable: false, get: contents },
    parts: { enumerable: false, get: () => (pp ??= pageParts(root, proj())) },
    project: { enumerable: false, value: proj },
  });
  return /** @type {any} */ (facts);
}

/**
 * The facts as plain JSON (reads everything once; the lazy contents and parts views are left out).
 * @param {any} facts
 * @returns {import('./contract.mjs').LineFacts}
 */
export function summarizeFacts(facts) {
  const { files, library, features, findings, findingsNew, plan, structure, truncated } = facts;
  return { files, library, features, findings, findingsNew, plan, structure, truncated };
}

/**
 * "sha256:<16 hex>" of the facts summary.
 * @param {any} facts
 * @returns {string}
 */
export const factsHash = (facts) => hash16(summarizeFacts(facts));

// ------------------------------------------------------------------------------------------------ the summary view
/** Caps that keep the summary a fixed size whatever the project. */
export const SUMMARY_CAPS = Object.freeze({ features: 50, items: 50, library: 200, findings: 50, pages: 50, parts: 30, fragments: 100 });

/**
 * The fixed-size facts summary of a Line project (the drafter's and Train Line's view).
 * @param {string} root Project root.
 * @param {import('./contract.mjs').LineProject} [project] An already-read project.
 * @returns {{layout: {library: string, features: string, state: string}, features: {name: string, items: {id: string, kind: string, name: string, file: string, base: string|null, layer: string}[]}[], library: {id: string, kind: string, name: string, file: string, layer: string, usedBy: number, level: string|null}[], findings: {key: string, rule: string, file: string, line: number, sentence: string, item: string|null, fixes: {id: string, rank: number, sentence: string, step: {tool: string, args: Record<string, unknown>}|null}[]}[], pages: {file: string, item: string, contentHash: string, parts: {nodeId: string, tag: string, props: {name: string, kind: string, value: unknown}[]}[]}[], fragments: {file: string, item: string, contentHash: string, id: string, kind: string, nodeId: string, label: string}[], routes: {item: string, path: string}[], specs: {feature: string, text: string}[]}}
 */
export function factsSummary(root, project = readLineProject(root)) {
  const CAPS = SUMMARY_CAPS;
  const features = project.features.slice(0, CAPS.features).map((f) => ({
    name: f.name,
    items: f.items.slice(0, CAPS.items).map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base.libraryId, layer: KIND_LAYER[i.kind] })),
  }));
  const library = project.library.slice(0, CAPS.library).map((l) => ({ id: l.id, kind: l.kind, name: l.name, file: l.file, layer: KIND_LAYER[l.kind], usedBy: l.usedBy.length, level: l.level ?? null }));
  const itemOfFile = new Map(/** @type {[string, string][]} */ ([...features.flatMap((f) => f.items.map((i) => [i.file, i.id])), ...library.map((l) => [l.file, l.id])]));
  const findings = project.findings.slice(0, CAPS.findings).map((x) => ({
    key: x.key ?? `${x.rule}|${x.file}|${x.line}`, rule: x.rule, file: x.file, line: x.line, sentence: x.sentence, item: itemOfFile.get(x.file) ?? null,
    fixes: (x.fixes ?? []).map((y) => ({ id: y.id, rank: y.rank, sentence: y.sentence, step: y.step ? { tool: y.step.tool, args: { ...y.step.args } } : null })),
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
    if (l) for (const g of l.fragments) fragments.push({ file: i.file, item: i.id, contentHash: l.contentHash, id: g.id, kind: g.kind, nodeId: g.nodeId, label: g.label });
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
