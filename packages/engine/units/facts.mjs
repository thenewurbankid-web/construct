// Shared, pure "fact" blocks for unit summaries (deterministic, no LLM). Everything here is
// derived from source through packages/ast + existing blocks (layer graph, exceptions, enforcers);
// each unit-kind summarizer composes these instead of re-parsing.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../core/config.mjs';
import { walk, rel } from '../../core/fs.mjs';
import { loadLayerGraph, classifyProjectFile } from '../../core/architecture-graph.mjs';
import { readFrozenGlobs } from '../../core/frozen.mjs';
import { parseToAst, walkAst } from '../../../packages/ast/index.mjs';
import { readPathAliases, resolveImportSpecifier } from '../../core/route-resolver.mjs';
import { DEFAULT_ENFORCERS } from '../defaultEnforcers.mjs';
import { aggregateValidation } from '../../core/registry.mjs';
import { exceptionApplies } from '../../core/exceptions.mjs';

export const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
export const isTestFile = (p) => /\.(test|spec)\.[a-z]+$/.test(p) || /(^|\/)(__tests__|e2e)\//.test(p);

/** Lazy, memoized per-call context: config, layer graph, file list, validation. Pure reads. */
export function createContext(root) {
  const memo = {};
  const lazy = (k, f) => () => (k in memo ? memo[k] : (memo[k] = f()));
  const ctx = {
    root,
    config: lazy('config', () => loadConfig(root)),
    graph: lazy('graph', () => loadLayerGraph(root)),
    frozen: lazy('frozen', () => readFrozenGlobs(root)),
    aliases: lazy('aliases', () => readPathAliases(root).aliases),
    featuresRoot: () => ctx.config().features?.root || 'features',
    allFiles: lazy('files', () => walk(root).map((p) => rel(root, p)).filter((p) => !p.startsWith('.claude/')).sort()),
    sourceFiles: () => ctx.allFiles().filter((p) => SOURCE_EXTENSIONS_OK(p)),
    layerOf: (relPath) => classifyProjectFile(root, relPath, { graph: ctx.graph(), frozenGlobs: ctx.frozen() }),
    facts: (relPath) => (memo['f:' + relPath] ||= fileFacts(ctx, relPath)),
    violations: lazy('viol', () => {
      try { return aggregateValidation(root, DEFAULT_ENFORCERS).violations; } catch (e) { return [{ rule: 'VALIDATION-ERROR', severity: 'error', file: '', message: String(e.message || e) }]; }
    }),
  };
  return ctx;
}
const SOURCE_EXTENSIONS_OK = (p) => SOURCE_EXT.has(path.extname(p));

const LAYER_LABEL = { domain: 'Pure domain logic', service: 'Service (external effects)', workflow: 'Workflow state machine', hook: 'React hook', component: 'Presentation component', page: 'Page (presentation)', controller: 'Controller (wires page to hook/workflow)', route: 'Route entry' };

function firstSentence(text, max = 140) {
  const t = String(text).replace(/^\/\*+|\*+\/$/g, '').split('\n').map((l) => l.replace(/^\s*\*?\s?/, '')).filter((l) => !/^@\w+/.test(l)).join(' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function leadingComment(ast, source) {
  const first = ast.body[0];
  const limit = first ? first.range[0] : source.length;
  const lines = [];
  let end = -1;
  for (const c of ast.comments || []) {
    if (c.range[0] >= limit) break;
    if (c.type === 'Block') { if (!lines.length) return c.value.startsWith('*') ? null : c.value; continue; }
    if (end >= 0 && /\S/.test(source.slice(end, c.range[0]).replace(/\n/g, ''))) break;
    lines.push(c.value.trim()); end = c.range[1];
  }
  const text = lines.join(' ').trim();
  return /^(eslint|@ts-|prettier|use client)/.test(text) ? null : text || null;
}

const paramsText = (source, fn) => {
  if (!fn.params?.length) return '';
  const t = source.slice(fn.params[0].range[0], fn.params[fn.params.length - 1].range[1]).replace(/\s+/g, ' ');
  return t.length > 80 ? t.slice(0, 77) + '...' : t;
};
const returnText = (source, fn) => (fn.returnType ? source.slice(fn.returnType.range[0], fn.returnType.range[1]).replace(/\s+/g, ' ').replace(/^:\s*/, ': ').slice(0, 40) : '');

function describeDecl(source, name, decl) {
  if (!decl) return { name, kind: 'export' };
  if (decl.type === 'FunctionDeclaration' || decl.type === 'TSDeclareFunction') return { name, kind: 'function', signature: `${name}(${paramsText(source, decl)})${returnText(source, decl)}` };
  if (decl.type === 'ClassDeclaration') return { name, kind: 'class' };
  if (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration') return { name, kind: 'type' };
  if (decl.type === 'VariableDeclaration') {
    const d = decl.declarations.find((x) => x.id?.name === name) || decl.declarations[0];
    const init = d?.init;
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) return { name, kind: 'function', signature: `${name}(${paramsText(source, init)})${returnText(source, init)}` };
    return { name, kind: 'value' };
  }
  return { name, kind: 'export' };
}

const memberNames = (source, members) => (members || []).map((m) => (m.key?.name ?? m.key?.value) && `${m.key.name ?? m.key.value}${m.optional ? '?' : ''}`).filter(Boolean);

/** One parsed file -> a compact fact record. Never throws (a parse error becomes `error`). */
export function fileFacts(ctx, relPath) {
  const abs = path.join(ctx.root, relPath);
  const layer = ctx.layerOf(relPath);
  let source;
  try {
    if (!fs.realpathSync(abs).startsWith(fs.realpathSync(ctx.root) + path.sep)) throw new Error('outside root');
    source = fs.readFileSync(abs, 'utf8');
  } catch { return { path: relPath, layer, error: 'unreadable', exports: [], imports: [], resolvedImports: [], external: [], props: [], endpoints: [], loc: 0, purpose: '' }; }
  const base = { path: relPath, layer, loc: source.split('\n').length };
  let ast;
  try { ast = parseToAst(source); } catch (e) { return { ...base, error: `parse error: ${String(e.message).split('\n')[0]}`, exports: [], imports: [], resolvedImports: [], external: [], props: [], endpoints: [], purpose: '' }; }

  const exports = [];
  const props = [];
  const seen = new Set();
  const pushExp = (e, jsdocIdx) => { if (e.name && !seen.has(e.name)) { seen.add(e.name); exports.push(e); } void jsdocIdx; };
  let firstExportNode = null;
  const imports = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') imports.push(node.source.value);
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' || node.type === 'ExportAllDeclaration') firstExportNode ||= node;
    if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.type === 'VariableDeclaration') for (const x of d.declarations) pushExp(describeDecl(source, x.id?.name, d));
      else if (d) pushExp(describeDecl(source, d.id?.name, d));
      else for (const s of node.specifiers || []) pushExp({ name: s.exported?.name ?? s.exported?.value, kind: 'reexport' });
      if (node.source) imports.push(node.source.value);
    } else if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      pushExp(d.type === 'Identifier' ? { name: d.name, kind: 'default' } : describeDecl(source, d.id?.name || 'default', d));
    } else if (node.type === 'ExportAllDeclaration') {
      pushExp({ name: node.exported?.name || node.source.value, kind: 'reexport' });
      imports.push(node.source.value);
    }
    const t = node.type.startsWith('Export') ? node.declaration : node;
    if (t?.type === 'TSInterfaceDeclaration' && /Props$/.test(t.id.name)) props.push({ type: t.id.name, members: memberNames(source, t.body.body) });
    if (t?.type === 'TSTypeAliasDeclaration' && /Props$/.test(t.id.name) && t.typeAnnotation.type === 'TSTypeLiteral') props.push({ type: t.id.name, members: memberNames(source, t.typeAnnotation.members) });
  }
  const dyn = [];
  const endpoints = new Set();
  walkAst(ast, {
    enter(n, parent) {
      if (n.type === 'ImportExpression' && n.source?.type === 'Literal') dyn.push(n.source.value);
      const v = n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateElement' ? n.value.cooked : null;
      if (v && parent?.type !== 'ImportDeclaration' && /^(https?:\/\/\S+|\/[a-zA-Z][\w\-/{}.:$]*)$/.test(v.trim()) && v.length > 2) endpoints.add(v.trim());
    },
  });
  imports.push(...dyn);
  const resolvedImports = [];
  for (const spec of imports) {
    const hit = resolveImportSpecifier(abs, spec, ctx.aliases());
    if (hit) resolvedImports.push(rel(ctx.root, hit));
  }
  const external = [...new Set(imports.filter((s) => !s.startsWith('.') && !s.startsWith('@/')).map((s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0])))].sort();

  let purpose = '', purposeSource = 'derived';
  const lead = leadingComment(ast, source);
  let jsdoc = null;
  if (firstExportNode) {
    const before = (ast.comments || []).filter((c) => c.type === 'Block' && c.value.startsWith('*') && c.range[1] <= firstExportNode.range[0]);
    const last = before[before.length - 1];
    if (last && !/\S/.test(source.slice(last.range[1], firstExportNode.range[0]))) jsdoc = last.value;
  }
  if (lead) { purpose = firstSentence(lead); purposeSource = 'comment'; }
  else if (jsdoc) { purpose = firstSentence(jsdoc); purposeSource = 'jsdoc'; }
  if (!purpose) {
    const names = exports.slice(0, 3).map((e) => e.name).join(', ');
    purpose = `${LAYER_LABEL[layer] || 'Source file'}${names ? ` exporting ${names}${exports.length > 3 ? ', ...' : ''}` : ''}.`;
  }
  const isReactish = /\.(tsx|jsx)$/.test(relPath);
  return {
    ...base, purpose, purposeSource, exports, props: isReactish ? props : [],
    endpoints: layer === 'service' || /services?\//.test(relPath) ? [...endpoints].sort() : [],
    imports: [...new Set(imports)], resolvedImports: [...new Set(resolvedImports)].sort(), external,
  };
}

/** Compact file entry used in every kind's `files` section. */
export const fileEntry = (f, { withExports = false } = {}) => ({
  path: f.path, layer: f.layer, loc: f.loc, purpose: f.purpose,
  ...(withExports ? { exports: f.exports.map((e) => e.signature || e.name) } : {}),
  ...(f.error ? { error: f.error } : {}),
});

/** Test files relevant to a set of source paths: colocated, or a test file whose name mentions a source basename / feature. */
export function testsFor(ctx, { dir, names = [] }) {
  const tests = ctx.allFiles().filter((p) => SOURCE_EXT.has(path.extname(p)) && isTestFile(p));
  const needles = names.filter((n) => n && n.length > 2).map((n) => n.toLowerCase());
  return tests.filter((p) => (dir && p.startsWith(dir.replace(/\/?$/, '/'))) || needles.some((n) => path.basename(p).toLowerCase().includes(n))).sort();
}

/** Violations attached to files/prefixes, plus active exceptions covering those paths. */
export function violationsFor(ctx, pred) {
  const v = ctx.violations().filter((x) => pred(x.file || '')).map((x) => ({ rule: x.rule, severity: x.severity, file: x.file, line: x.line, message: x.message }));
  const exceptions = (ctx.config().exceptions || []).filter((e) => {
    const rules = e.rule ? [e.rule] : e.rules || [];
    return ctx.allFiles().some((p) => pred(p) && rules.some((r) => exceptionApplies(ctx.config(), r, p) && e.path));
  }).map((e) => ({ path: e.path, rules: e.rule ? [e.rule] : e.rules, ...(e.reason ? { reason: e.reason } : {}), ...(e.expires ? { expires: String(e.expires instanceof Date ? e.expires.toISOString().slice(0, 10) : e.expires) } : {}) }));
  return { violations: v, exceptions, counts: { error: v.filter((x) => x.severity === 'error').length, warning: v.filter((x) => x.severity === 'warning').length } };
}

export const healthFrom = (findings) => ({
  status: findings.some((f) => f.severity === 'error') ? 'issues' : findings.some((f) => f.severity === 'warning') ? 'warnings' : 'ok',
  findings,
});
