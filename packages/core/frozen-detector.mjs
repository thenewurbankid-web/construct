// #23 -- "wrap, don't duplicate": detects a page/component/controller that
// reimplements markup already present in a frozen (externally-authored)
// source instead of being a thin import + prop-forward around it.
//
// Fully deterministic and AST-only (parseToAst + estree-walker, same tooling
// as architecture-enforcer.mjs) -- no text/regex matching over source, no
// LLM. Runs only when architecture.yml declares `frozen:` globs.
//
// For a candidate file in a pages/, components/ or controllers/ layer, three
// independent signals (each reported separately; a file can trip more than one):
//
//  1. same-name   The file exports a component whose name equals a component
//                 exported by a frozen file, yet does NOT import that frozen
//                 file. It is a re-authored copy under the same name. (A few
//                 generic names -- Page, App, Layout, ... -- are ignored:
//                 sharing them proves nothing.)
//  2. structure   The file has >= minDuplicateElements (default 6) JSX
//                 elements and >= similarity (default 0.8) of its JSX
//                 element-tag multiset is contained in ONE frozen file's
//                 multiset, and it does not import that frozen file. Small
//                 files can never trip this, so thin wrappers are safe.
//  3. not-thin    The file DOES import a frozen file, but declares more than
//                 maxOwnElements (default 5) JSX elements of its own -- a
//                 wrapper should import and prop-forward, not re-author
//                 markup around the frozen component.
//
// Thresholds are per-rule options in architecture.yml, e.g.
//   PAGE-007: { severity: error, similarity: 0.9, maxOwnElements: 3 }
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst, walkAst } from '../../packages/ast/index.mjs';
import { listFrozenFiles } from './frozen.mjs';

export const FROZEN_RULE_BY_LAYER = { page: 'PAGE-007', component: 'COMPONENT-004', controller: 'CONTROLLER-002' };

export const DEFAULT_THRESHOLDS = { minDuplicateElements: 6, similarity: 0.8, maxOwnElements: 5 };

// Names too generic for "same exported name" to mean anything.
const GENERIC_NAMES = new Set(['Page', 'App', 'Layout', 'Component', 'Index', 'Default', 'Root', 'Main']);

function jsxTagName(nameNode) {
  if (!nameNode) return null;
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') return `${jsxTagName(nameNode.object)}.${nameNode.property.name}`;
  if (nameNode.type === 'JSXNamespacedName') return `${nameNode.namespace.name}:${nameNode.name.name}`;
  return null;
}

/** Every JSX element (fragments excluded) as { tag, line }, in source order. */
function collectElements(ast) {
  const out = [];
  walkAst(ast, {
    enter(rawNode) {
      const node = /** @type {any} */ (rawNode); // estree types have no JSX nodes
      if (node.type === 'JSXElement') {
        const tag = jsxTagName(node.openingElement.name);
        if (tag) out.push({ tag, line: node.loc.start.line });
      }
    },
  });
  return out;
}

function multiset(tags) {
  const m = new Map();
  for (const t of tags) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** Fraction (0..1) of `a`'s elements (with multiplicity) present in `b`. */
function containment(a, b) {
  let total = 0;
  let shared = 0;
  for (const [tag, n] of a) {
    total += n;
    shared += Math.min(n, b.get(tag) || 0);
  }
  return total ? shared / total : 0;
}

/** Exported, capitalized (component-style) names -> line of the export. */
function exportedComponentNames(ast) {
  const out = new Map();
  const add = (name, node) => {
    if (typeof name === 'string' && /^[A-Z]/.test(name) && !out.has(name)) out.set(name, node.loc.start.line);
  };
  for (const node of ast.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      if (d.type === 'Identifier') add(d.name, node);
      else if (d.id) add(d.id.name, node);
    } else if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') add(v.id.name, node);
      if (d?.id) add(d.id.name, node);
      for (const s of node.specifiers || []) add(s.exported?.name ?? s.exported?.value, node);
    }
  }
  return out;
}

function staticImports(ast) {
  return ast.body.filter((n) => n.type === 'ImportDeclaration').map((n) => ({ spec: n.source.value, line: n.loc.start.line }));
}

/** Build the read-only index of frozen sources for a project. Unparseable
 * frozen files are skipped (they're not ours to complain about). */
export function buildFrozenIndex(root, globs) {
  const files = [];
  for (const abs of listFrozenFiles(root, globs)) {
    let ast;
    try { ast = parseToAst(fs.readFileSync(abs, 'utf8')); } catch { continue; }
    files.push({
      abs,
      names: new Set(exportedComponentNames(ast).keys()),
      tags: multiset(collectElements(ast).map((e) => e.tag)),
    });
  }
  return { files, absSet: new Set(files.map((f) => f.abs)) };
}

/**
 * @param {string} layer 'page' | 'component' | 'controller' (others: no-op)
 * @param {string} source the candidate file's source
 * @param {string} absFile the candidate file's absolute path
 * @param {{files: object[], absSet: Set<string>}} index from buildFrozenIndex
 * @param {{resolveImport: (fromAbs: string, spec: string) => string|null, options?: object}} ctx
 * @returns {{rule: string, line: number, message: string, why: string, expected: string[], suggestedFix: string}[]}
 */
export function detectFrozenViolations(layer, source, absFile, index, { resolveImport, options = {} }) {
  const rule = FROZEN_RULE_BY_LAYER[layer];
  if (!rule || !index.files.length) return [];
  const t = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(t)) if (typeof options[k] === 'number') t[k] = options[k];

  const ast = parseToAst(source);
  const elements = collectElements(ast);
  const ownTags = multiset(elements.map((e) => e.tag));
  const importedFrozen = new Set();
  let firstFrozenImportLine = 1;
  for (const imp of staticImports(ast)) {
    const hit = imp.spec.startsWith('.') ? resolveImport(absFile, imp.spec) : null;
    if (hit && index.absSet.has(path.resolve(hit))) {
      if (!importedFrozen.size) firstFrozenImportLine = imp.line;
      importedFrozen.add(path.resolve(hit));
    }
  }

  const candidates = index.files.filter((f) => f.abs !== path.resolve(absFile));
  const out = [];
  const rel = (abs) => path.relative(path.dirname(absFile), abs).split(path.sep).join('/');
  const fix = (target) => `Delete the duplicated markup and import the frozen source instead ("${target}"): render it from a controller and forward props (${'`<Frozen {...props} />`'}); put data/gating in hooks/workflows/domain.`;

  // 1. same-name
  const ownNames = exportedComponentNames(ast);
  for (const [name, line] of ownNames) {
    if (GENERIC_NAMES.has(name)) continue;
    const twin = candidates.find((f) => f.names.has(name) && !importedFrozen.has(f.abs));
    if (twin) {
      out.push({
        rule, line,
        message: `Exports "${name}", which a frozen source (${rel(twin.abs)}) already defines, without importing it.`,
        why: 'Frozen files are the single source of truth for their markup; a same-named copy in this layer is a fork that will drift. Wrap the frozen component instead.',
        expected: ['import the frozen component and forward props'],
        suggestedFix: fix(rel(twin.abs)),
      });
    }
  }

  // 2. structural duplicate
  if (elements.length >= t.minDuplicateElements) {
    let best = null;
    for (const f of candidates) {
      if (importedFrozen.has(f.abs)) continue;
      const score = containment(ownTags, f.tags);
      if (score >= t.similarity && (!best || score > best.score)) best = { f, score };
    }
    if (best) {
      out.push({
        rule, line: elements[0].line,
        message: `JSX structure duplicates frozen source ${rel(best.f.abs)} (${Math.round(best.score * 100)}% of ${elements.length} elements match) instead of importing it.`,
        why: 'Re-authoring markup that already exists in a frozen, externally-authored file forks the design output; it must stay the single source of truth.',
        expected: ['import the frozen component and forward props'],
        suggestedFix: fix(rel(best.f.abs)),
      });
    }
  }

  // 3. imports a frozen source but is not thin
  if (importedFrozen.size && elements.length > t.maxOwnElements) {
    const target = rel([...importedFrozen][0]);
    out.push({
      rule, line: firstFrozenImportLine,
      message: `Wraps frozen source ${target} but declares ${elements.length} JSX elements of its own (max ${t.maxOwnElements} for a thin wrapper).`,
      why: 'A wrapper around a frozen component should import it and forward props, not re-author surrounding markup.',
      expected: ['import + prop-forward only'],
      suggestedFix: `Reduce this file to rendering the frozen component and passing props; move any extra markup into the frozen source's owner (the design tool) or a separate component.`,
    });
  }
  return out;
}
