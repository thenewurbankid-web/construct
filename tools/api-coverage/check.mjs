#!/usr/bin/env node
// JSDoc coverage ratchet (epic #463, slice 2). Deterministic, no LLM.
// Reports every exported function or class under the checked roots that lacks a description, an @param for its
// parameters, or an @returns when it returns a value, and FAILS when a file has more such gaps than
// tools/api-coverage/baseline.json allows (the baseline only ever decreases; new files start at zero).
//
//   node tools/api-coverage/check.mjs            check against the baseline (exit 1 on regression)
//   node tools/api-coverage/check.mjs --report   list every gap
//   node tools/api-coverage/check.mjs --update   lower the baseline to the current counts (refuses to raise it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@typescript-eslint/typescript-estree';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const BASELINE_FILE = path.join(HERE, 'baseline.json');
/** Packages under the ratchet: Core engine, Engine, AST. Extend as later slices document more packages. */
export const ROOTS = ['src'];

const isSource = (n) => n.endsWith('.mjs') && !/\.(test|spec)\.mjs$/.test(n);

export function listFiles(repoRoot = REPO_ROOT, roots = ROOTS) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel);
      } else if (isSource(e.name)) out.push(rel);
    }
  };
  for (const r of roots) if (fs.existsSync(path.join(repoRoot, r))) walk(r);
  return out;
}

const returnsValue = (fn) => {
  if (fn.body?.type !== 'BlockStatement') return fn.body != null; // arrow with an expression body
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'ReturnStatement') {
      if (n.argument) found = true;
      return;
    }
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassDeclaration|ClassExpression)$/.test(n.type)) return;
    for (const k of Object.keys(n)) {
      if (k === 'parent' || k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(fn.body);
  return found;
};

/** Parse the leading JSDoc block into { description, params, returns }, or null when there is none. */
export function parseJsDoc(raw) {
  if (raw == null) return null;
  const lines = raw.split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
  const desc = [];
  const tags = [];
  for (const l of lines) {
    const t = /^@(\w+)\s*(.*)$/.exec(l.trim());
    if (t) tags.push({ tag: t[1], text: t[2] });
    else if (tags.length) tags[tags.length - 1].text += ' ' + l.trim();
    else desc.push(l);
  }
  return {
    description: desc.join(' ').trim(),
    params: tags.filter((t) => t.tag === 'param' || t.tag === 'arg' || t.tag === 'argument').length,
    returns: tags.some((t) => t.tag === 'returns' || t.tag === 'return'),
    inheritsAll: tags.some((t) => t.tag === 'inheritdoc' || t.tag === 'overload'),
  };
}

/** Gaps of one file: [{ name, line, missing: ['description' | '@param' | '@returns'] }]. */
export function gapsOf(source) {
  const ast = parse(source, { range: true, loc: true, comment: true, jsx: false, sourceType: 'module' });
  const comments = ast.comments.filter((c) => c.type === 'Block' && c.value.startsWith('*'));
  const docBefore = (node) => {
    // The JSDoc block that ends right before `node` (only whitespace between).
    const before = comments.filter((c) => c.range[1] <= node.range[0]).pop();
    if (!before) return null;
    return /^\s*$/.test(source.slice(before.range[1], node.range[0])) ? before.value : null;
  };
  const locals = new Map(); // top-level function/class declarations and function-valued consts, for `export { a }`
  const declare = (name, fn, node) => locals.set(name, { fn, node });
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' && n.id) declare(n.id.name, n, n);
    else if (n.type === 'ClassDeclaration' && n.id) declare(n.id.name, null, n);
    else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier' && d.init && /Function/.test(d.init.type)) declare(d.id.name, d.init, n);
  }
  const targets = []; // { name, fn (function node or null for a class), doc (raw or null), line }
  const push = (name, fn, docNode, exportNode) => targets.push({ name, fn, doc: docBefore(exportNode) ?? (docNode !== exportNode ? docBefore(docNode) : null), line: docNode.loc.start.line });
  for (const n of ast.body) {
    if (n.type === 'ExportNamedDeclaration') {
      const d = n.declaration;
      if (d?.type === 'FunctionDeclaration') push(d.id.name, d, d, n);
      else if (d?.type === 'ClassDeclaration') push(d.id.name, null, d, n);
      else if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier' && v.init && /Function/.test(v.init.type)) push(v.id.name, v.init, d, n);
      if (!d && !n.source) for (const s of n.specifiers) {
        const l = locals.get(s.local.name);
        if (l) push(s.exported.name ?? s.local.name, l.fn, l.node, l.node);
      }
    } else if (n.type === 'ExportDefaultDeclaration') {
      const d = n.declaration;
      if (d.type === 'FunctionDeclaration' || /Function/.test(d.type)) push(d.id?.name || 'default', d, n, n);
      else if (d.type === 'ClassDeclaration') push(d.id?.name || 'default', null, n, n);
      else if (d.type === 'Identifier' && locals.has(d.name)) push('default', locals.get(d.name).fn, locals.get(d.name).node, locals.get(d.name).node);
    }
  }
  const seen = new Set();
  const gaps = [];
  for (const t of targets) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    const doc = parseJsDoc(t.doc);
    const missing = [];
    if (!doc || (!doc.description && !doc.inheritsAll)) missing.push('description');
    if (t.fn && t.fn.params.length && !(doc && (doc.params > 0 || doc.inheritsAll))) missing.push('@param');
    if (t.fn && returnsValue(t.fn) && !(doc && (doc.returns || doc.inheritsAll))) missing.push('@returns');
    if (missing.length) gaps.push({ name: t.name, line: t.line, missing });
  }
  gaps.checked = seen.size;
  return gaps;
}

export function measure(repoRoot = REPO_ROOT, roots = ROOTS) {
  const files = {};
  let exportsChecked = 0;
  for (const rel of listFiles(repoRoot, roots)) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    let gaps;
    try {
      gaps = gapsOf(src);
    } catch (err) {
      throw new Error(`${rel}: cannot parse (${err.message})`);
    }
    exportsChecked += gaps.checked;
    if (gaps.length) files[rel] = gaps;
  }
  return { files, exportsChecked };
}

const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const readBaseline = () => (fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : { files: {} });

/** Compare current per-file counts with a baseline; returns the regressions and the improvements. */
export function compare(current, baseline) {
  const regressions = [];
  const improvements = [];
  for (const [f, n] of Object.entries(current)) if (n > (baseline[f] ?? 0)) regressions.push({ file: f, was: baseline[f] ?? 0, now: n });
  for (const [f, n] of Object.entries(baseline)) if ((current[f] ?? 0) < n) improvements.push({ file: f, was: n, now: current[f] ?? 0 });
  return { regressions, improvements };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const { files, exportsChecked } = measure();
  const counts = Object.fromEntries(Object.entries(files).map(([f, g]) => [f, g.length]));
  const baseline = readBaseline();
  const { regressions, improvements } = compare(counts, baseline.files || {});
  if (args.has('--report')) {
    for (const [f, gaps] of Object.entries(files)) for (const g of gaps) console.log(`${f}:${g.line}  ${g.name}  missing ${g.missing.join(', ')}`);
  }
  console.log(`API doc gaps: ${total(counts)} of ${exportsChecked} exported functions/classes, in ${Object.keys(counts).length} files (baseline ${total(baseline.files || {})})`);
  if (args.has('--update')) {
    if (regressions.length && fs.existsSync(BASELINE_FILE)) {
      console.error('Refusing to raise the baseline:\n' + regressions.map((r) => `  ${r.file}: ${r.was} -> ${r.now}`).join('\n'));
      process.exit(1);
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ note: 'Exported functions/classes lacking a description, @param or @returns, per file. Only ever decreases: node tools/api-coverage/check.mjs --update', total: total(counts), files: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + '\n');
    console.log(`Baseline written (${total(counts)}).`);
  } else if (regressions.length) {
    console.error('API doc coverage regressed (document the new exports; the baseline only decreases):\n' + regressions.map((r) => `  ${r.file}: ${r.was} -> ${r.now}`).join('\n'));
    for (const r of regressions) for (const g of files[r.file]) console.error(`    ${r.file}:${g.line}  ${g.name}  missing ${g.missing.join(', ')}`);
    process.exit(1);
  } else if (improvements.length) {
    console.log(`Coverage improved in ${improvements.length} file(s); run with --update to lower the baseline.`);
  }
}
