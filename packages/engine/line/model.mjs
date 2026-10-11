// Line Cockpit model (T1, contract.mjs): the read-only Line view of a project, built from the Line
// profile's own helpers (packages/core/profiles/line/checks.mjs) and findings (validateLine), so the
// Cockpit sees exactly what `construct validate` sees. Reads files only; never writes, never runs code.
//
// Component level (LibraryItem.level), decided statically:
//   1. an `@line-level atom|molecule|organism` comment in the file wins;
//   2. else no imports from the library                     -> atom;
//   3. else imports only library components that are atoms -> molecule;
//   4. else (imports a molecule, an organism, a non-component library item, or an import cycle) -> organism.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../core/config.mjs';
import { normalizeLineConfig } from '../../core/profiles/line/contract.mjs';
import { validateLine } from '../../core/profiles/line/index.mjs';
import {
  resolveLayout, loadProject, isItemFile, baseLinks, resolveBase, moduleEdges, resolveSpecifier, classify,
} from '../../core/profiles/line/checks.mjs';
import { LEVELS } from './contract.mjs';
import { withFixes } from './fixes.mjs';
import { summarize } from '../../summarize/index.mjs';

const posix = path.posix;
const LEVEL_PRAGMA = /@line-level\s+(atom|molecule|organism)\b/;

/**
 * An item's name: the file name without extension, or its folder's name for an index file.
 * @param {string} rel The item's root-relative POSIX path.
 * @returns {string} The name, e.g. "Button" for components/Button/index.tsx.
 */
export function itemName(rel) {
  const base = posix.basename(rel).replace(/\.[^.]+$/, '');
  return base === 'index' ? posix.basename(posix.dirname(rel)) : base;
}

/** "Sentence." — validate messages are sentences already; this only guards the contract's full stop. */
const asSentence = (s) => { const t = String(s || 'This file breaks a Line rule.').trim(); return /[.?!]$/.test(t) ? t : `${t}.`; };

/**
 * A violation as the contract's LineFinding.
 * @param {{message: string, rule: string, severity: string, file: string, line?: number}} v
 * @returns {import('./contract.mjs').LineFinding}
 */
export function toFinding(v) {
  const severity = v.severity === 'error' || v.severity === 'warning' ? v.severity : 'info';
  const file = v.file || '.';
  const line = Number.isInteger(v.line) && v.line > 0 ? v.line : 1;
  // cs1: the sentence a person reads is made and checked by the one summarizer (the rule id and file:line stay fields).
  const sentence = summarize({ kind: 'finding', finding: { sentence: asSentence(v.message), rule: v.rule, file, line } }).sentences.join(' ');
  return { sentence, rule: v.rule, severity, file, line };
}

/**
 * The level of every library component (see the rule at the top of this file).
 * @param {Map<string, string[]>} imports Library component file -> library files it imports.
 * @param {Map<string, string>} pragmas Library component file -> its `@line-level`, when it has one.
 * @returns {Map<string, import('./contract.mjs').Level>} File -> level.
 */
export function componentLevels(imports, pragmas) {
  /** @type {Map<string, import('./contract.mjs').Level>} */
  const out = new Map();
  const visiting = new Set();
  const levelOf = (file) => {
    if (out.has(file)) return out.get(file);
    if (pragmas.has(file)) { out.set(file, /** @type {any} */ (pragmas.get(file))); return out.get(file); }
    if (visiting.has(file)) return 'organism'; // a cycle never makes anything simpler
    visiting.add(file);
    const deps = imports.get(file) || [];
    /** @type {import('./contract.mjs').Level} */
    let level = 'atom';
    if (deps.length) level = deps.every((d) => imports.has(d) && levelOf(d) === 'atom') ? 'molecule' : 'organism';
    visiting.delete(file);
    out.set(file, level);
    return level;
  };
  for (const file of imports.keys()) levelOf(file);
  return out;
}

/**
 * The library file an import target names (`library/components/Button` -> `library/components/Button.tsx`).
 * @param {string} target Root-relative target from resolveSpecifier.
 * @param {Set<string>} files Every project file.
 * @returns {string|null}
 */
function libraryFileFor(target, files) {
  if (files.has(target)) return target;
  for (const f of files) {
    const noExt = f.replace(/\.[^./]+$/, '');
    if (noExt === target || noExt === `${target}/index`) return f;
  }
  return null;
}

/**
 * Every finding of the project's Line profile, as LineFindings, each LINE-* one with its typed fixes (fixes.mjs).
 * @param {string} root Project root.
 * @returns {import('./contract.mjs').LineFinding[]}
 */
export function lineFindings(root) {
  return withFixes(root, validateLine(root).violations.map(toFinding));
}

/**
 * The whole Line view of a project. A project whose architecture.yml preset is not "line" gets
 * `isLine: false` and empty lists, so a caller can fall back to its non-Line screen without paying for a scan.
 * @param {string} root Project root.
 * @returns {import('./contract.mjs').LineProject}
 */
export function readLineProject(root) {
  const config = loadConfig(root);
  const line = normalizeLineConfig(/** @type {any} */ (config).line);
  const layout = resolveLayout(root, line);
  const isLine = /** @type {any} */ (config).preset === 'line';
  if (!isLine) return { isLine: false, layout, library: [], features: [], findings: [] };

  const project = loadProject(root, layout);
  const allFiles = new Set(project.files.map((f) => f.rel));
  const findings = lineFindings(root);

  // Library items, and what each library component imports from the library.
  const libFiles = project.files.filter((f) => f.area === 'library' && isItemFile(f));
  const imports = new Map();
  const pragmas = new Map();
  for (const f of libFiles) {
    if (f.kind !== 'components' || f.rel.endsWith('.json')) continue;
    const src = project.source(f.rel);
    const m = LEVEL_PRAGMA.exec(src);
    if (m) pragmas.set(f.rel, m[1]);
    const ast = project.ast(f.rel);
    const deps = new Set();
    if (!(ast instanceof Error)) {
      for (const e of moduleEdges(ast)) {
        const target = resolveSpecifier(layout, f.rel, e.specifier);
        if (!target || classify(target, layout).area !== 'library') continue;
        const file = libraryFileFor(target, allFiles);
        if (file && file !== f.rel) deps.add(file);
      }
    }
    imports.set(f.rel, [...deps]);
  }
  const levels = componentLevels(imports, pragmas);

  // Feature items with their base links, resolved to library files.
  const featureDirs = (() => {
    try { return fs.readdirSync(path.join(root, layout.features), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; }
  })();
  const libIdByFile = new Map(libFiles.map((f) => [f.rel, `${f.kind}/${itemName(f.rel)}`]));
  const usedBy = new Map();
  const features = featureDirs.map((name) => {
    const spec = `${layout.features}/${name}/spec.md`;
    const items = project.files.filter((f) => f.area === 'feature' && f.feature === name && isItemFile(f)).map((f) => {
      const { links } = baseLinks(project, f.rel);
      const value = links[0]?.value ?? null;
      const target = links.length === 1 ? resolveBase(root, layout, links[0].value) : null;
      const libraryId = target && target.kind === f.kind && target.file ? libIdByFile.get(target.file) ?? null : null;
      if (libraryId) {
        if (!usedBy.has(libraryId)) usedBy.set(libraryId, []);
        usedBy.get(libraryId).push({ feature: name, file: f.rel });
      }
      const own = findings.filter((x) => x.file === f.rel);
      return {
        id: `${name}/${f.kind}/${itemName(f.rel)}`, kind: /** @type {any} */ (f.kind), name: itemName(f.rel), feature: name, file: f.rel,
        base: { value, libraryId }, status: /** @type {'ok'|'problem'} */ (own.length ? 'problem' : 'ok'), findings: own,
      };
    });
    return { name, spec: allFiles.has(spec) ? spec : null, items };
  });

  const library = libFiles.map((f) => {
    const id = libIdByFile.get(f.rel);
    return {
      id, kind: /** @type {any} */ (f.kind), name: itemName(f.rel), file: f.rel,
      ...(f.kind === 'components' ? { level: levels.get(f.rel) ?? /** @type {const} */ ('atom') } : {}),
      usedBy: usedBy.get(id) || [],
    };
  });

  return { isLine: true, layout, library, features, findings };
}

