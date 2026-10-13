// Line profile, static checks (ca1). Every check reads files and parses them; nothing here runs project
// code, calls a model or writes to disk. Each check returns hits `{rule, file, line, message}`; index.mjs
// turns them into diagnostics.mjs violations with the rule's severity and plain-English "why".
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { walk as walkAst } from 'estree-walker';
import { parseToAst } from '@construct/ast';
import { lineOf } from '@construct/ast/extract';
import { findAtomCopies } from '@line/atoms/check';
import {
  ITEM_KINDS, LOGIC_KINDS, BASE_OPTIONAL_KINDS, KIND_SINGULAR, FEATURE_FILES, LIBRARY_FILES, CODE_EXTENSIONS, SKIP_DIRS, NON_ITEM_FILE, DEFAULT_APP_FOLDERS, DEFAULT_PACKAGE_ROOTS,
  FS_WRITE_FUNCTIONS, FS_EXTRA_WRITE_FUNCTIONS, FS_MODULES, SHARED_CONCERNS,
} from './contract.mjs';
import { readPathAliases, resolveImportSpecifier } from '../../route-resolver.mjs';

const posix = path.posix;
const SINGULAR = KIND_SINGULAR;
/** Folder names that hold tests, test data or examples rather than the app; LINE-OWNER skips pages in them. */
// `__line_characterization__`: the characterization tests and their runtime Line generates for an import (engine
// line/characterize.mjs CHAR_DIR).
const TEST_DATA_SEGMENTS = new Set(['test', 'tests', '__tests__', 'e2e', 'fixtures', '__fixtures__', 'mocks', '__mocks__', 'examples', '__line_characterization__']);

const isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };
const isCode = (rel) => CODE_EXTENSIONS.includes(posix.extname(rel));

/**
 * Decide where the library and the features live: the configured folders, else `src/library` and
 * `src/features` when only those exist, else `library` and `features`.
 * @param {string} root Project root.
 * @param {{library?: string, features?: string, state: string}} line Normalized `line:` config.
 * @returns {{library: string, features: string, state: string}}
 */
export function resolveLayout(root, line) {
  const has = (p) => isDir(path.join(root, p));
  const useSrc = !line.library && !line.features && !has('library') && !has('features') && (has('src/library') || has('src/features'));
  return {
    library: line.library ?? (useSrc ? 'src/library' : 'library'),
    features: line.features ?? (useSrc ? 'src/features' : 'features'),
    state: line.state,
  };
}

/**
 * Whether `root` or a folder above it holds `.git` (a folder, or a file as in a linked worktree or submodule).
 * @param {string} root
 * @returns {boolean}
 */
function hasGitAbove(root) {
  let dir = path.resolve(root);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * The files git sees under `root` (tracked plus untracked, minus .gitignore'd), root-relative; null when `root` is
 * not inside a git work tree, git is missing, or git lists nothing (so the caller walks the disk instead).
 * @param {string} root Project root.
 * @returns {string[]|null} Root-relative paths, unfiltered.
 */
export function gitVisibleFiles(root) {
  // No `.git` in the root or any folder above it (a scratch copy in the temp folder): not a work tree, so no git
  // process is spawned (spawning one per check made drafting in scratch copies several times slower).
  if (!process.env.GIT_DIR && !process.env.GIT_WORK_TREE && !hasGitAbove(root)) return null;
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
  const files = r.stdout.split('\0').filter(Boolean);
  return files.length ? files : null;
}

/**
 * Every file under the root (posix, root-relative), skipping dependency and build folders, dot-folders and symlinks.
 * In a git work tree, gitignored files (generated vendor copies, build output, caches) are skipped too: one
 * `git ls-files` call lists what git sees; without git it is a plain walk.
 * @param {string} root Project root.
 * @returns {string[]} Sorted root-relative paths.
 */
export function listFiles(root) {
  const fromGit = gitVisibleFiles(root);
  if (fromGit) {
    const kept = fromGit.filter((rel) => {
      const segs = rel.split('/');
      if (segs.slice(0, -1).some((s) => s.startsWith('.') || SKIP_DIRS.includes(s))) return false;
      try { return fs.lstatSync(path.join(root, rel)).isFile(); } catch { return false; } // deleted or a symlink
    });
    return [...new Set(kept)].sort();
  }
  const out = [];
  const visit = (dir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.includes(e.name)) continue;
        visit(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  };
  visit(root, '');
  return out.sort();
}

/**
 * Where a root-relative path sits in a Line project.
 * @param {string} rel Root-relative path.
 * @param {{library: string, features: string, state: string}} layout The resolved layout.
 * @returns {{area: 'library'|'feature'|'state'|'other', feature?: string, kind?: string}} Its area, feature and kind.
 */
export function classify(rel, layout) {
  const under = (dir) => rel === dir || rel.startsWith(`${dir}/`);
  if (under(layout.library)) {
    const segs = rel.slice(layout.library.length + 1).split('/');
    return { area: 'library', kind: segs.length > 1 && ITEM_KINDS.includes(segs[0]) ? segs[0] : undefined };
  }
  if (under(layout.features)) {
    const segs = rel.slice(layout.features.length + 1).split('/');
    if (segs.length < 2) return { area: 'feature' };
    return { area: 'feature', feature: segs[0], kind: segs.length > 2 && ITEM_KINDS.includes(segs[1]) ? segs[1] : undefined };
  }
  if (under(layout.state)) return { area: 'state' };
  return { area: 'other' };
}

/**
 * A loaded project: its files with their places, and lazily read and parsed sources.
 * @param {string} root Project root.
 * @param {{library: string, features: string, state: string}} layout The resolved layout.
 * @returns {{root: string, layout: object, files: {rel: string, area: string, feature?: string, kind?: string}[], source: (rel: string) => string, ast: (rel: string) => any}} The project.
 */
export function loadProject(root, layout) {
  const files = listFiles(root).map((rel) => ({ rel, ...classify(rel, layout) }));
  const sources = new Map();
  const asts = new Map();
  const source = (rel) => {
    if (!sources.has(rel)) sources.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
    return sources.get(rel);
  };
  /** The parsed AST, or an Error when the file does not parse. */
  const ast = (rel) => {
    if (!asts.has(rel)) {
      try { asts.set(rel, parseToAst(source(rel))); } catch (e) { asts.set(rel, e instanceof Error ? e : new Error(String(e))); }
    }
    return asts.get(rel);
  };
  return { root, layout, files, source, ast };
}

/**
 * Whether a file is a library or feature item (not a test, story or index barrel).
 * @param {{rel: string, kind?: string}} file A classified file.
 * @returns {boolean} True for an item.
 */
export function isItemFile(file) {
  if (!file.kind) return false;
  const base = posix.basename(file.rel);
  if (NON_ITEM_FILE.test(base)) return false;
  if (isCode(file.rel)) return true;
  return file.kind === 'fixtures' && posix.extname(file.rel) === '.json';
}

// ---------------------------------------------------------------------------------------------
// LINE-LAYOUT

/**
 * Whether a source file outside the library and the features is allowed where it is (LINE-LAYOUT "stray source"):
 * files directly at the root or in src/ (config and entry files), app/config/test folders (line.appFolders, also under src/), Line's state, package roots, test
 * and example folders, pages (LINE-OWNER's), tests, stories and type declarations.
 * @param {string} rel Root-relative path of a code file outside the library and the features.
 * @param {{library: string, features: string, state: string}} layout
 * @param {{appFolders?: string[], packageRoots?: string[]}} [line] Normalized `line:` config.
 * @returns {boolean}
 */
export function strayAllowed(rel, layout, line = {}) {
  const segs = rel.split('/');
  const dirs = segs.slice(0, -1);
  const base = segs[segs.length - 1];
  if (NON_ITEM_FILE.test(base) || /\.d\.[cm]?ts$/.test(base) || isPageShaped(rel)) return true;
  if (dirs.some((d) => TEST_DATA_SEGMENTS.has(d))) return true;
  // Code roots: the project root, src/, and the folder holding the library and the features when it is another one.
  const own = posix.dirname(layout.library) === posix.dirname(layout.features) ? posix.dirname(layout.library) : '.';
  const roots = [...new Set(['', 'src', own === '.' ? '' : own])];
  const dir = dirs.join('/');
  if (roots.includes(dir)) return true;
  const under = (d) => rel.startsWith(`${d}/`);
  const folders = [...(line.appFolders ?? DEFAULT_APP_FOLDERS), ...(line.packageRoots ?? DEFAULT_PACKAGE_ROOTS)];
  return [layout.state, ...roots.flatMap((r) => folders.map((f) => (r ? `${r}/${f}` : f)))].some(under);
}

/**
 * LINE-LAYOUT: entries under the library, the features folder and each feature must be known kinds or allowed files;
 * once the project has either folder, a source file anywhere else (outside the app/config folders) is reported too.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {{appFolders?: string[], packageRoots?: string[]}} [line] Normalized `line:` config.
 * @returns {{rule: string, file: string, line: number, message: string}[]} The hits.
 */
export function checkLayout(project, line = {}) {
  const { root, layout } = project;
  const hits = [];
  const hit = (file, message) => hits.push({ rule: 'LINE-LAYOUT', file, line: 1, message });
  const read = (rel) => { try { return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).filter((e) => !e.name.startsWith('.')); } catch { return null; } };
  const lib = read(layout.library);
  const feats = read(layout.features);
  if (!lib && !feats) {
    hit('.', `This project has no ${layout.library}/ or ${layout.features}/ folder, so it is not laid out as a Line project yet; create ${layout.library}/ for shared items and ${layout.features}/<name>/ for each feature.`);
    return hits;
  }
  const kinds = `${ITEM_KINDS.slice(0, -1).map((k) => `${k}/`).join(', ')} and ${ITEM_KINDS[ITEM_KINDS.length - 1]}/`;
  for (const e of lib || []) {
    const rel = `${layout.library}/${e.name}`;
    if (e.isDirectory() && !ITEM_KINDS.includes(e.name)) hit(rel, `The library folder "${rel}" is not one of the library kinds; the library holds only ${kinds}, so move its files into one of them.`);
    else if (!e.isDirectory() && !LIBRARY_FILES.includes(e.name)) hit(rel, `The file "${rel}" sits at the top of the library; move it into one of ${kinds}.`);
  }
  for (const e of feats || []) {
    const rel = `${layout.features}/${e.name}`;
    if (!e.isDirectory()) {
      hit(rel, `The file "${rel}" sits directly in the features folder; every feature file belongs inside a feature folder, so move it into ${layout.features}/<name>/.`);
      continue;
    }
    for (const c of read(rel) || []) {
      const crel = `${rel}/${c.name}`;
      if (c.isDirectory() && !ITEM_KINDS.includes(c.name)) hit(crel, `Feature "${e.name}" has a "${c.name}" folder, but a feature holds only ${kinds} plus spec.md; move these files into one of those folders or into the library.`);
      else if (!c.isDirectory() && !FEATURE_FILES.includes(c.name)) hit(crel, `Feature "${e.name}" has the file "${c.name}" at its top level, but only spec.md, the API contract (openapi.json) and the public index (index.ts) may sit there; move it into one of ${kinds}.`);
    }
  }
  for (const f of project.files) {
    if (f.area !== 'other' || !isCode(f.rel) || strayAllowed(f.rel, layout, line)) continue;
    hit(f.rel, `The source file "${f.rel}" is outside ${layout.library}/ and ${layout.features}/, so Line cannot check or reuse it; move it into the library or into the feature that uses it.`);
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// LINE-BASE

const BASE_PRAGMA = /@line-base\s+([^\s*]+)/g;
const ROUTE_PRAGMA = /@line-route\s+([^\s*]+)/g;

/** Pragmas of one kind found in a code file's comments (falls back to the raw text when it does not parse). */
function pragmas(project, rel, re) {
  const src = project.source(rel);
  const ast = project.ast(rel);
  const out = [];
  if (ast instanceof Error) {
    for (const m of src.matchAll(re)) out.push({ value: m[1], line: lineOf(src, m.index) });
    return out;
  }
  for (const c of ast.comments || []) {
    for (const m of c.value.matchAll(re)) out.push({ value: m[1], line: c.loc.start.line });
  }
  return out;
}

/**
 * The base links a feature item declares: `@line-base` comments in code, `"$lineBase"` in a JSON fixture.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {string} rel Root-relative file path.
 * @returns {{links: {value: string, line: number}[], invalid?: boolean, array?: boolean}} The links, whether a JSON fixture failed
 *   to parse, and whether it is a bare array (which cannot hold a base until it is wrapped as `{ "$lineBase", "value" }`).
 */
export function baseLinks(project, rel) {
  if (posix.extname(rel) !== '.json') return { links: pragmas(project, rel, BASE_PRAGMA) };
  const src = project.source(rel);
  let data;
  try { data = JSON.parse(src); } catch { return { links: [], invalid: true }; }
  const at = src.indexOf('"$lineBase"');
  const line = at >= 0 ? lineOf(src, at) : 1;
  if (Array.isArray(data)) return { links: [], array: true };
  const value = data && typeof data === 'object' ? data.$lineBase : undefined;
  if (typeof value === 'string') return { links: [{ value, line }] };
  if (Array.isArray(value)) return { links: value.filter((v) => typeof v === 'string').map((v) => ({ value: v, line })) };
  return { links: [] };
}

/**
 * The rows of a fixture's JSON (#935): a bare array, or the based form `{ "$lineBase": "fixtures/<name>", "value": [...] }`
 * a feature fixture uses to carry its base (the same wrapper line.baseOn and line.setBase write for an array fixture).
 * Null when the data is neither.
 * @param {unknown} data Parsed fixture JSON.
 * @returns {unknown[]|null}
 */
export function fixtureRows(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && '$lineBase' in data && Array.isArray(/** @type {any} */ (data).value)) return /** @type {any} */ (data).value;
  return null;
}

/**
 * Resolve a base link (`components/Button`, `library/components/Button.tsx`, ...) to an existing library file.
 * @param {string} root Project root.
 * @param {{library: string}} layout The resolved layout.
 * @param {string} value The link value.
 * @returns {{kind: string, file: string|undefined}} The kind the link names and the file it resolves to, if any.
 */
export function resolveBase(root, layout, value) {
  const norm = value.replace(/^\.\//, '').replace(new RegExp(`^${layout.library.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '').replace(/^library\//, '');
  // A link never leaves the library: `components/../../features/x` names no library item.
  if (norm.split('/').includes('..')) return { kind: norm.split('/')[0], file: undefined };
  const kind = norm.split('/')[0];
  const base = `${layout.library}/${norm}`;
  const exts = [...CODE_EXTENSIONS, '.json'];
  const candidates = [base, ...exts.map((x) => base + x), ...exts.map((x) => `${base}/index${x}`)];
  const found = candidates.find((c) => { try { return fs.statSync(path.join(root, c)).isFile(); } catch { return false; } });
  return { kind, file: found };
}

/**
 * LINE-BASE: every feature item links to exactly one existing library item of the same kind.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @returns {{rule: string, file: string, line: number, message: string}[]} The hits.
 */
export function checkBase(project) {
  const { root, layout } = project;
  const hits = [];
  for (const file of project.files) {
    if (file.area !== 'feature' || !isItemFile(file) || LOGIC_KINDS.includes(String(file.kind))) continue;
    const what = `feature ${SINGULAR[file.kind]}`;
    const isJson = posix.extname(file.rel) === '.json';
    const { links, invalid, array } = baseLinks(project, file.rel);
    const add = (line, message) => hits.push({ rule: 'LINE-BASE', file: file.rel, line, message });
    if (!links.length && !invalid && BASE_OPTIONAL_KINDS.includes(String(file.kind))) continue;
    if (invalid) { add(1, `The fixture "${file.rel}" is not valid JSON, so its library base cannot be read; fix the JSON and keep one "$lineBase" link.`); continue; }
    if (!links.length) {
      const how = array ? `a base by wrapping its rows as { "$lineBase": "${file.kind}/<name>", "value": [ ...rows ] }`
        : isJson ? `a "$lineBase": "${file.kind}/<name>" field` : `one "@line-base ${file.kind}/<Name>" comment`;
      add(1, `The ${what} "${file.rel}" has no library base; add ${how} naming the library item it is based on, and create that library item first if none fits.`);
      continue;
    }
    if (links.length > 1) {
      add(links[1].line, `The ${what} "${file.rel}" links to ${links.length} library bases (${links.map((l) => l.value).join(', ')}); a feature item is based on exactly one library item, so keep one link.`);
      continue;
    }
    const [link] = links;
    const { kind, file: target } = resolveBase(root, layout, link.value);
    if (kind !== file.kind) {
      add(link.line, `The ${what} "${file.rel}" is based on "${link.value}", which is not a library ${SINGULAR[file.kind]}; base it on an item in ${layout.library}/${file.kind}/.`);
    } else if (!target) {
      add(link.line, `The library base "${link.value}" of "${file.rel}" does not exist in ${layout.library}/; create the library item first or fix the link.`);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// LINE-OWNER

/**
 * Whether a path looks like a page: in a pages/ folder, an app router page file, or a Name.page.tsx file.
 * @param {string} rel Root-relative path.
 * @returns {boolean} True for a page-shaped code file.
 */
export function isPageShaped(rel) {
  if (!isCode(rel) || NON_ITEM_FILE.test(posix.basename(rel))) return false;
  const segs = rel.split('/');
  const dirs = segs.slice(0, -1);
  const base = segs[segs.length - 1];
  return dirs.includes('pages') || (dirs.includes('app') && /^page\.[cm]?[jt]sx?$/.test(base)) || /\.page\.[cm]?[jt]sx?$/.test(base);
}

/** An app-router route entry: the whole file is one re-export of a page as the route's default export. */
const ROUTE_ENTRY = /^export\s*\{\s*(?:default|[A-Za-z_$][\w$]*\s+as\s+default)\s*\}\s*from\s*['"]([^'"]+)['"]\s*;?$/;

/**
 * The feature whose page an app-router route entry (`app/.../page.tsx` holding only `export { X as default } from
 * '<features>/<f>/pages/X'`) re-exports, or null when the file is not such an entry. A route entry is how a Next.js
 * app router serves a feature page: the page stays in its feature, the framework's file only points at it.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {string} rel Root-relative path of the page-shaped file.
 * @returns {string|null} The owning feature.
 */
export function routeEntryFeature(project, rel) {
  if (!/(?:^|\/)app\/(?:.*\/)?page\.[cm]?[jt]sx?$/.test(rel)) return null;
  let src;
  try { src = String(project.source(rel)); } catch { return null; }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
  const m = ROUTE_ENTRY.exec(code);
  if (!m) return null;
  // Resolved the way the app resolves it (relative, or the project's tsconfig `paths` aliases), and only to a page file
  // that exists: a link to a missing page, or to a page outside a feature's pages/, does not make the entry a feature's.
  const { aliases } = readPathAliases(project.root);
  const abs = resolveImportSpecifier(path.join(project.root, rel), m[1], aliases);
  if (!abs) return null;
  const target = path.relative(project.root, abs).split(path.sep).join('/');
  if (target.startsWith('..')) return null;
  const prefix = `${/** @type {any} */ (project.layout).features}/`;
  if (!target.startsWith(prefix)) return null;
  const segs = target.slice(prefix.length).split('/');
  return segs.length === 3 && segs[1] === 'pages' && segs[0] && isCode(target) ? segs[0] : null;
}

/**
 * LINE-OWNER: every page outside the library pages belongs to exactly one feature. An app-router route entry that only
 * re-exports one feature page (routeEntryFeature) belongs to that feature.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @returns {{rule: string, file: string, line: number, message: string}[]} The hits.
 */
export function checkOwner(project) {
  const { layout } = project;
  const hits = [];
  const routes = new Map();
  for (const file of project.files) {
    if (file.area === 'state' || !isPageShaped(file.rel)) continue;
    const add = (line, message) => hits.push({ rule: 'LINE-OWNER', file: file.rel, line, message });
    if (file.area === 'library' && file.kind === 'pages') continue;
    if (file.area === 'feature' && file.kind === 'pages') {
      for (const r of pragmas(project, file.rel, ROUTE_PRAGMA)) {
        if (!routes.has(r.value)) routes.set(r.value, []);
        routes.get(r.value).push({ feature: file.feature, rel: file.rel, line: r.line });
      }
      continue;
    }
    if (file.area !== 'feature' && file.area !== 'library' && routeEntryFeature(project, file.rel)) continue;
    if (file.area === 'feature' && file.feature) {
      add(1, `The page "${file.rel}" sits in feature "${file.feature}" outside its pages/ folder; move it to ${layout.features}/${file.feature}/pages/.`);
    } else if (file.area === 'library') {
      add(1, `The page "${file.rel}" sits in the library outside ${layout.library}/pages/; move it there if it is a full library page.`);
    } else if (!file.rel.split('/').slice(0, -1).some((s) => TEST_DATA_SEGMENTS.has(s))) {
      add(1, `The page "${file.rel}" does not belong to any feature; move it into ${layout.features}/<feature>/pages/, or into ${layout.library}/pages/ if it is a full library page (an app-router route file may hold only \`export { Page as default } from '<the feature page>'\`).`);
    }
  }
  for (const [route, claims] of routes) {
    const features = [...new Set(claims.map((c) => c.feature))];
    if (features.length < 2) continue;
    for (const c of claims) {
      hits.push({ rule: 'LINE-OWNER', file: c.rel, line: c.line, message: `The route "${route}" is claimed by pages in the features ${features.map((f) => `"${f}"`).join(' and ')}; a page belongs to exactly one feature, so keep it in one of them and give the others their own route.` });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// LINE-DIR

/**
 * Every module edge of a parsed file: imports (type-only included), re-exports, dynamic imports and require(). `names`
 * lists what a static import or re-export takes from the module (`default` for a default import, `*` for a namespace
 * import or `export *`); it is null for dynamic imports and require(), which name nothing statically.
 * @param {object} ast A parsed Program.
 * @returns {{specifier: string, line: number, names: string[]|null}[]} The edges in source order.
 */
export function moduleEdges(ast) {
  const edges = [];
  const literal = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : n && n.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : null);
  walkAst(ast, {
    enter(/** @type {any} */ node) {
      let spec = null;
      let names = null;
      const id = (n) => (n.type === 'Identifier' ? n.name : String(n.value));
      if (node.type === 'ImportDeclaration') names = node.specifiers.map((x) => (x.type === 'ImportDefaultSpecifier' ? 'default' : x.type === 'ImportNamespaceSpecifier' ? '*' : id(x.imported)));
      else if (node.type === 'ExportNamedDeclaration' && node.source) names = node.specifiers.map((x) => id(x.local));
      else if (node.type === 'ExportAllDeclaration') names = ['*'];
      if ((node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') && node.source) spec = literal(node.source);
      else if (node.type === 'ImportExpression') spec = literal(node.source);
      else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1) spec = literal(node.arguments[0]);
      else if (node.type === 'TSImportType' || node.type === 'TSExternalModuleReference') spec = literal(node.argument?.literal ?? node.argument ?? node.expression);
      if (spec !== null) edges.push({ specifier: spec, line: node.loc.start.line, names });
    },
  });
  return edges;
}

/**
 * Resolve an import specifier to a root-relative path when it points into the library or the features (relative paths, the at-sign, tilde and hash aliases, and src-less forms).
 * @param {{library: string, features: string}} layout The resolved layout.
 * @param {string} fromRel The importing file.
 * @param {string} spec The specifier.
 * @returns {string|null} The root-relative target, or null when it points elsewhere.
 */
export function resolveSpecifier(layout, fromRel, spec) {
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromRel), spec));
  const s = spec.replace(/^[@~#]\//, '');
  for (const dir of [layout.features, layout.library]) {
    for (const form of new Set([dir, dir.replace(/^src\//, '')])) {
      if (s === form || s.startsWith(`${form}/`)) return dir + s.slice(form.length);
    }
  }
  return null;
}

// Feature modules (#935): a feature's public index (features/<f>/index.ts) is the only way into it from another feature.

const RESOLVE_EXTS = [...CODE_EXTENSIONS, '.json'];
const fileSets = new WeakMap();
/** The project's root-relative file paths as a set (cached per project). */
function fileSet(project) {
  if (!fileSets.has(project)) fileSets.set(project, new Set(project.files.map((f) => f.rel)));
  return fileSets.get(project);
}

/**
 * The project file a root-relative import target names: itself, with a code or JSON extension, or its folder's index.
 * @param {{files: {rel: string}[]}} project The loaded project.
 * @param {string} target Root-relative path, as resolveSpecifier returns it.
 * @returns {string|null} The file, or null when none exists.
 */
export function resolveProjectFile(project, target) {
  const have = fileSet(project);
  if (have.has(target)) return target;
  for (const x of RESOLVE_EXTS) if (have.has(target + x)) return target + x;
  for (const x of CODE_EXTENSIONS) if (have.has(`${target}/index${x}`)) return `${target}/index${x}`;
  const js = /\.[cm]?jsx?$/.exec(target); // ESM-style `./Foo.js` naming Foo.ts
  if (js) for (const x of CODE_EXTENSIONS) if (have.has(target.slice(0, -js[0].length) + x)) return target.slice(0, -js[0].length) + x;
  return null;
}

/**
 * A feature's public index file (features/<feature>/index.ts, or another code extension), or null when it has none.
 * @param {{files: {rel: string}[], layout: {features: string}}} project The loaded project.
 * @param {string} feature The feature name.
 * @returns {string|null} Root-relative path.
 */
export function featureIndexFile(project, feature) {
  const have = fileSet(project);
  const base = `${project.layout.features}/${feature}/index`;
  const ext = CODE_EXTENSIONS.find((x) => have.has(base + x));
  return ext ? base + ext : null;
}

/**
 * What one file exports, statically: each exported name with the file it comes from, following `export *` through
 * project files. `open` is true when an `export *` reaches outside the project (a package) or the file does not parse,
 * so names not listed may still exist; `stale` lists export lines whose relative module does not exist.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {string} rel Root-relative file.
 * @param {Set<string>} [seen] Files already visited (cycle guard).
 * @returns {{names: Map<string, {from: string, line: number}>, stale: {specifier: string, line: number}[], open: boolean}}
 */
export function fileExports(project, rel, seen = new Set()) {
  /** @type {Map<string, {from: string, line: number}>} */
  const names = new Map();
  /** @type {{specifier: string, line: number}[]} */
  const stale = [];
  let open = false;
  if (seen.has(rel)) return { names, stale, open };
  seen.add(rel);
  if (posix.extname(rel) === '.json') { names.set('default', { from: rel, line: 1 }); return { names, stale, open }; }
  const ast = project.ast(rel);
  if (ast instanceof Error) return { names, stale, open: true };
  const id = (n) => (n.type === 'Identifier' ? n.name : String(n.value));
  /** The project file a module specifier names; null when it names a missing project file, undefined for a package. */
  const target = (spec) => {
    const t = resolveSpecifier(project.layout, rel, spec);
    return t === null ? undefined : resolveProjectFile(project, t);
  };
  for (const node of ast.body || []) {
    const line = node.loc?.start.line ?? 1;
    const src = node.source && typeof node.source.value === 'string' ? node.source.value : null;
    if (!/^Export/.test(node.type)) continue;
    const from = src === null ? rel : target(src);
    if (src !== null && from === null) { stale.push({ specifier: src, line }); continue; }
    if (node.type === 'ExportDefaultDeclaration') names.set('default', { from: rel, line });
    else if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.type === 'VariableDeclaration') { for (const v of d.declarations) if (v.id.type === 'Identifier') names.set(v.id.name, { from: rel, line }); }
      else if (d?.id?.name) names.set(d.id.name, { from: rel, line });
      for (const x of node.specifiers || []) names.set(id(x.exported), { from: from ?? rel, line });
    } else if (node.type === 'ExportAllDeclaration') {
      if (node.exported) { names.set(id(node.exported), { from: from ?? rel, line }); continue; }
      if (from === undefined) { open = true; continue; }
      const inner = fileExports(project, /** @type {string} */ (from), seen);
      for (const [n, at] of inner.names) if (n !== 'default' && !names.has(n)) names.set(n, at);
      open ||= inner.open;
    }
  }
  return { names, stale, open };
}

/**
 * A feature module's public exports: its index file and what that file exports (fileExports), or null when the
 * feature has no index.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {string} feature The feature name.
 * @returns {({file: string} & ReturnType<typeof fileExports>)|null}
 */
export function indexExports(project, feature) {
  const file = featureIndexFile(project, feature);
  return file ? { file, ...fileExports(project, file) } : null;
}

/**
 * LINE-DIR: a feature imports the library, its own files, and another feature only through that feature's public index
 * (naming exports the index has); the library never imports a feature. A stale export line in an index another
 * feature imports is reported on the index.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @returns {{rule: string, file: string, line: number, message: string}[]} The hits.
 */
export function checkDirection(project) {
  const { layout } = project;
  const hits = [];
  const staleSeen = new Set();
  const indexes = new Map();
  const exportsOf = (f) => { if (!indexes.has(f)) indexes.set(f, indexExports(project, f)); return indexes.get(f); };
  for (const file of project.files) {
    if ((file.area !== 'feature' && file.area !== 'library') || !isCode(file.rel)) continue;
    if (file.area === 'feature' && !file.feature) continue;
    const ast = project.ast(file.rel);
    if (ast instanceof Error) continue;
    for (const e of moduleEdges(ast)) {
      const target = resolveSpecifier(layout, file.rel, e.specifier);
      if (!target) continue;
      const t = classify(target, layout);
      // A specifier that names a feature folder itself (`../../orders`, `@/features/orders`) reaches its index.
      if (t.area === 'feature' && !t.feature) t.feature = target.slice(layout.features.length + 1).split('/')[0] || undefined;
      if (t.area !== 'feature' || !t.feature) continue;
      const add = (message, at = { file: file.rel, line: e.line }) => hits.push({ rule: 'LINE-DIR', file: at.file, line: at.line, message });
      if (file.area === 'library') {
        add(`The library file "${file.rel}" imports "${e.specifier}" from feature "${t.feature}"; the library must not depend on any feature, so move what it needs into the library.`);
        continue;
      }
      if (t.feature === file.feature) continue;
      const folder = `${layout.features}/${t.feature}`;
      let via = posix.relative(posix.dirname(file.rel), folder);
      if (!via.startsWith('.')) via = `./${via}`;
      const indexTarget = target === folder || target.replace(/\.[cm]?[jt]sx?$/, '') === `${folder}/index`;
      const what = (e.names || []).filter((n) => n !== '*' && n !== 'default');
      const named = what.length ? `{ ${what.join(', ')} }` : '{ ... }';
      if (!indexTarget) {
        add(`Feature "${file.feature}" imports "${e.specifier}", a file inside feature "${t.feature}"; another feature is used only through its public index, so import it as \`import ${named} from '${via}'\` and export it from ${folder}/index.ts if it is not exported there yet (or promote it to ${layout.library}/ when several features share it).`);
        continue;
      }
      const ex = exportsOf(t.feature);
      if (!ex) {
        add(`Feature "${file.feature}" imports "${e.specifier}", but feature "${t.feature}" has no public index; create ${folder}/index.ts exporting what other features may use (for example \`export ${named} from './components/<Name>';\`).`);
        continue;
      }
      for (const s of ex.stale) {
        const key = `${ex.file}:${s.line}`;
        if (staleSeen.has(key)) continue;
        staleSeen.add(key);
        add(`The public index "${ex.file}" exports "${s.specifier}", which does not exist, and feature "${file.feature}" imports this index; remove the line or restore the file it names.`, { file: ex.file, line: s.line });
      }
      if (ex.open) continue;
      for (const n of (e.names || []).filter((x) => x !== '*')) {
        if (ex.names.has(n)) continue;
        const has = ex.names.size ? ` (it exports ${[...ex.names.keys()].slice(0, 6).join(', ')})` : '';
        add(`Feature "${file.feature}" imports "${n}" from feature "${t.feature}", but ${ex.file} does not export it; add \`export { ${n} } from './<kind>/<Name>';\` to ${ex.file} (feature "${t.feature}" decides what it exports), or import something it does export${has}.`);
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// LINE-WRITER

const FS_WRITES = new Set(FS_WRITE_FUNCTIONS.flatMap((n) => [n, `${n}Sync`]));
const FS_EXTRA_WRITES = new Set(FS_EXTRA_WRITE_FUNCTIONS.flatMap((n) => [n, `${n}Sync`]));
const isWriteName = (name, mod) => FS_WRITES.has(name) || (mod === 'fs-extra' && FS_EXTRA_WRITES.has(name));
const propName = (n) => (n && n.type === 'Identifier' ? n.name : n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null);

/**
 * Every use of a file-writing fs function in one parsed file. Tracks the bindings an fs module reaches
 * the code through: default/namespace/named imports, `promises`, require(), dynamic import() and
 * destructuring, then reports member calls (`fs.writeFileSync`, `fs.promises.mkdir`) and named
 * bindings (`writeFile(...)`, or one passed on as a value).
 * @param {object} ast A parsed Program.
 * @returns {{name: string, line: number}[]} Each write with its function name and line.
 */
export function findFsWrites(ast) {
  const namespaces = new Map(); // local name -> module
  const direct = new Map(); // local name -> {name, mod}
  const declSites = new Set(); // ranges of identifiers that declare a binding (not uses)
  const fsModuleOf = (spec) => (typeof spec === 'string' && FS_MODULES.includes(spec) ? spec.replace(/^node:/, '').replace(/\/promises$/, '') : null);

  /** The fs module an initializer evaluates to (`require('fs')`, `await import('fs')`, `fs.promises`), or null. */
  const moduleOfExpr = (n) => {
    if (!n) return null;
    if (n.type === 'AwaitExpression') return moduleOfExpr(n.argument);
    if (n.type === 'ChainExpression') return moduleOfExpr(n.expression);
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require') return fsModuleOf(n.arguments[0]?.value);
    if (n.type === 'ImportExpression') return fsModuleOf(n.source?.value);
    if (n.type === 'Identifier' && namespaces.has(n.name)) return namespaces.get(n.name);
    if (n.type === 'MemberExpression' && propName(n.property) === 'promises') return moduleOfExpr(n.object);
    if (n.type === 'MemberExpression' && propName(n.property) === 'default') return moduleOfExpr(n.object);
    return null;
  };

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const mod = fsModuleOf(node.source.value);
    if (!mod) continue;
    for (const s of node.specifiers) {
      declSites.add(s.local.range[0]);
      if (s.type !== 'ImportSpecifier') { namespaces.set(s.local.name, mod); continue; }
      const imported = propName(s.imported);
      if (imported === 'promises' || imported === 'default') namespaces.set(s.local.name, mod);
      else if (isWriteName(imported, mod)) direct.set(s.local.name, { name: imported, mod });
    }
  }
  walkAst(ast, {
    enter(/** @type {any} */ node) {
      if (node.type !== 'VariableDeclarator') return;
      const mod = moduleOfExpr(node.init);
      if (!mod) return;
      if (node.id.type === 'Identifier') { namespaces.set(node.id.name, mod); declSites.add(node.id.range[0]); return; }
      if (node.id.type !== 'ObjectPattern') return;
      const bindPattern = (pattern) => {
        for (const p of pattern.properties) {
          if (p.type !== 'Property') continue;
          const key = propName(p.key);
          const local = p.value.type === 'AssignmentPattern' ? p.value.left : p.value;
          declSites.add(p.key.range[0]);
          // `const { promises: { writeFile } } = require('fs')` binds through the nested pattern.
          if (local.type === 'ObjectPattern' && (key === 'promises' || key === 'default')) { bindPattern(local); continue; }
          if (local.type !== 'Identifier') continue;
          declSites.add(local.range[0]);
          if (key === 'promises') namespaces.set(local.name, mod);
          else if (isWriteName(key, mod)) direct.set(local.name, { name: key, mod });
        }
      };
      bindPattern(node.id);
    },
  });

  const out = [];
  const seen = new Set();
  const report = (name, line) => { const k = `${name}@${line}`; if (!seen.has(k)) { seen.add(k); out.push({ name, line }); } };
  walkAst(ast, {
    enter(/** @type {any} */ node, /** @type {any} */ parent) {
      if (node.type === 'MemberExpression') {
        const name = propName(node.computed && node.property.type !== 'Literal' ? null : node.property);
        const mod = moduleOfExpr(node.object);
        if (name && mod && isWriteName(name, mod)) report(name, node.loc.start.line);
        return;
      }
      if (node.type !== 'Identifier' || !direct.has(node.name) || declSites.has(node.range[0])) return;
      if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent && parent.type === 'Property' && parent.key === node && !parent.shorthand) return;
      if (parent && (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier')) return;
      report(direct.get(node.name).name, node.loc.start.line);
    },
  });
  return out.sort((a, b) => a.line - b.line);
}

/**
 * LINE-WRITER: every file write outside line.writers and line.writerExempt.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {{writers: string[], writerExempt: string[]}} line Normalized `line:` config.
 * @returns {{rule: string, file: string, line: number, message: string}[]} The hits.
 */
export function checkWriter(project, line) {
  const hits = [];
  for (const file of project.files) {
    if (!isCode(file.rel)) continue;
    if (matchesAny(file.rel, line.writerExempt) || matchesAny(file.rel, line.writers)) continue;
    const ast = project.ast(file.rel);
    if (ast instanceof Error) continue;
    for (const w of findFsWrites(ast)) {
      hits.push({ rule: 'LINE-WRITER', file: file.rel, line: w.line, message: `"${file.rel}" changes files directly with ${w.name}(); send this write through Construct's writer instead, so it is checked, approved and logged.` });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// LINE-SHARED

/**
 * The package.json name of the nearest package that holds a file, looking from the file's folder up to the project root.
 * @param {string} root Project root.
 * @param {string} rel Root-relative file path.
 * @param {Map<string, string|null>} cache Folder to package name, shared across calls.
 * @returns {string|null} The package name, or null when no package.json with a name is found.
 */
export function packageNameOf(root, rel, cache) {
  const seen = [];
  let dir = posix.dirname(rel);
  let name = null;
  for (;;) {
    if (cache.has(dir)) { name = cache.get(dir); break; }
    seen.push(dir);
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
      if (pkg && typeof pkg.name === 'string') { name = pkg.name; break; }
    } catch { /* no package.json here */ }
    if (dir === '.' || dir === '') break;
    dir = posix.dirname(dir);
  }
  for (const d of seen) cache.set(d, name);
  return name;
}

/** Names a module exports directly (functions, classes, variables). */
function exportedNames(ast) {
  const out = [];
  for (const node of ast.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
    const d = node.declaration;
    if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) out.push({ name: d.id.name, line: d.loc.start.line });
    if (d.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') out.push({ name: v.id.name, line: v.loc.start.line });
  }
  return out;
}

/** String literal and template text in a file, with lines. */
function stringsOf(ast) {
  const out = [];
  walkAst(ast, {
    enter(/** @type {any} */ node) {
      if (node.type === 'Literal' && typeof node.value === 'string') out.push({ text: node.value, line: node.loc.start.line });
      else if (node.type === 'TemplateElement') out.push({ text: node.value.cooked ?? node.value.raw, line: node.loc.start.line });
    },
  });
  return out;
}

/**
 * Copies of a shared concern in one parsed file: an import only the owner may use, a string only the owner
 * may use, or an exported function with the owner's signature name.
 * @param {object} ast A parsed Program.
 * @param {typeof SHARED_CONCERNS[number]} concern The concern to look for.
 * @returns {{line: number, what: string}[]} One entry per signal.
 */
export function findSharedCopies(ast, concern) {
  const out = [];
  if (concern.imports) {
    for (const e of moduleEdges(ast)) {
      if (concern.imports.some((m) => e.specifier === m || e.specifier.startsWith(`${m}/`))) out.push({ line: e.line, what: `imports "${e.specifier}"` });
    }
  }
  if (concern.strings) {
    const seen = new Set();
    for (const str of stringsOf(ast)) {
      const hit = concern.strings.find((x) => str.text.includes(x));
      if (hit && !seen.has(str.line)) { seen.add(str.line); out.push({ line: str.line, what: `talks to "${hit}" directly` }); }
    }
  }
  if (concern.declares) {
    for (const x of exportedNames(ast)) if (concern.declares.test(x.name)) out.push({ line: x.line, what: `exports its own ${x.name}()` });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * LINE-SHARED: every file outside a concern's owner packages that keeps its own copy of that concern.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {{writerExempt: string[], sharedOwners: Record<string, string[]>}} line Normalized `line:` config.
 * @returns {{rule: string, file: string, line: number, message: string, concern: string}[]} The hits.
 */
export function checkShared(project, line) {
  const hits = [];
  const cache = new Map();
  for (const file of project.files) {
    if (!isCode(file.rel) || matchesAny(file.rel, line.writerExempt)) continue;
    const ast = project.ast(file.rel);
    if (ast instanceof Error) continue;
    const pkg = packageNameOf(project.root, file.rel, cache);
    for (const concern of SHARED_CONCERNS) {
      const owners = [...concern.owners, ...(line.sharedOwners[concern.id] || [])];
      if (pkg && owners.includes(pkg)) continue;
      if (concern.ownerFiles?.includes(file.rel)) continue;
      for (const c of findSharedCopies(ast, concern)) {
        hits.push({ rule: 'LINE-SHARED', concern: concern.id, file: file.rel, line: c.line, message: `"${file.rel}" keeps its own copy of ${concern.concern} (it ${c.what}); use the shared module ${concern.module} instead.` });
      }
    }
  }
  return hits;
}

/**
 * Whether a root-relative path matches any of the globs (a glob without a slash matches the base name).
 * @param {string} rel Root-relative path.
 * @param {string[]} globs Patterns.
 * @returns {boolean} True on the first match.
 */
export function matchesAny(rel, globs) {
  return globs.some((g) => minimatch(rel, g, { dot: true, matchBase: !g.includes('/') }));
}

/**
 * Code files that did not parse, once each (the checks skip or fall back on them).
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @returns {{file: string, message: string}[]} Each file with its first error line.
 */
export function parseFailures(project) {
  const out = [];
  for (const file of project.files) {
    if (!isCode(file.rel)) continue;
    const ast = project.ast(file.rel);
    if (ast instanceof Error) out.push({ file: file.rel, message: ast.message.split('\n')[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// LINE-MODULE

const CONTRACT_FILE = /^(contract|types)\.[cm]?[jt]sx?$/;
const DTS_FILE = /\.d\.[cm]?ts$/;
const JS_FILE = /\.[cm]?jsx?$/;
const JSDOC_TYPES = /@(typedef|callback)\b/;
const MOCK_FILE = /(^mocks?\.[^/]+$)|(\.mock\.[^/]+$)/;
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
const TEST_DIRS = new Set(['test', 'tests', '__tests__']);

/**
 * The packages of a project: every folder with a package.json directly under a package root, or under an @scope folder there.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {string[]} packageRoots Root-relative folders (line.packageRoots).
 * @returns {{dir: string, name: string|null, pkg: any, files: string[]}[]} Each package with its root-relative folder, name, parsed package.json and files (relative to the package).
 */
export function findPackages(project, packageRoots) {
  const out = [];
  const isPkgJson = (rest) => /^[^/@][^/]*\/package\.json$/.test(rest) || /^@[^/]+\/[^/]+\/package\.json$/.test(rest);
  for (const root of packageRoots) {
    for (const f of project.files) {
      if (!f.rel.startsWith(`${root}/`) || !isPkgJson(f.rel.slice(root.length + 1))) continue;
      const dir = posix.dirname(f.rel);
      let pkg = null;
      try { pkg = JSON.parse(project.source(f.rel)); } catch { pkg = null; }
      out.push({ dir, name: pkg && typeof pkg.name === 'string' ? pkg.name : null, pkg, files: [] });
    }
  }
  const byDir = new Map(out.map((p) => [p.dir, p]));
  for (const f of project.files) {
    const segs = f.rel.split('/');
    for (let i = segs.length - 1; i > 0; i--) {
      const p = byDir.get(segs.slice(0, i).join('/'));
      if (p) { p.files.push(segs.slice(i).join('/')); break; }
    }
  }
  return out;
}

/** Whether `sub` ("./x/y") is listed by a package.json "exports" value (exact keys, folder keys and one-star patterns). */
function exportsAllows(exportsField, sub) {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) return false;
  return Object.keys(exportsField).some((k) => {
    if (!k.startsWith('.')) return false;
    if (k === sub) return true;
    const star = k.indexOf('*');
    if (star < 0) return k.endsWith('/') && sub.startsWith(k);
    return sub.length >= k.length - 1 && sub.startsWith(k.slice(0, star)) && sub.endsWith(k.slice(star + 1));
  });
}

/**
 * LINE-MODULE: every package has a typed contract, a mock and its own tests, and other packages reach it only by name.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @param {{packageRoots: string[], writerExempt: string[]}} line Normalized `line:` config.
 * @returns {{rule: string, file: string, line: number, message: string}[]} The hits.
 */
export function checkModules(project, line) {
  const hits = [];
  const packages = findPackages(project, line.packageRoots);
  const label = (p) => (p.name ? `The package "${p.name}" (${p.dir})` : `The package in ${p.dir}`);
  for (const p of packages) {
    // One line per package-level check (1 contract, 2 mock, 3 tests): the registry dedups and finding keys are
    // rule|file|line, so sharing line 1 hid all but the first missing piece.
    const add = (message, line = 1) => hits.push({ rule: 'LINE-MODULE', file: `${p.dir}/package.json`, line, message });
    const atContractSpot = (f) => !f.includes('/') || (f.startsWith('src/') && f.split('/').length === 2);
    const candidates = p.files.filter((f) => atContractSpot(f) && (CONTRACT_FILE.test(posix.basename(f)) || DTS_FILE.test(f)));
    const typed = candidates.filter((f) => !JS_FILE.test(f) || JSDOC_TYPES.test(project.source(`${p.dir}/${f}`)));
    const declared = [p.pkg?.types, p.pkg?.typings].filter((t) => typeof t === 'string').map((t) => posix.normalize(t.replace(/^\.\//, '')));
    if (!typed.length && !declared.some((t) => p.files.includes(t))) {
      const untyped = candidates.filter((f) => JS_FILE.test(f));
      if (untyped.length) add(`${label(p)} has ${untyped.map((f) => `${p.dir}/${f}`).join(' and ')} but no JSDoc @typedef or @callback in it, so it does not describe a typed contract; add the types of what the package takes and returns there, or add ${p.dir}/contract.d.ts.`);
      else add(`${label(p)} has no typed contract; add ${p.dir}/contract.d.ts (or contract.ts or types.ts in ${p.dir}/src/, or a "types" entry in its package.json naming a real file) describing what it takes and returns, so other modules can rely on it and swap it for a mock.`);
    }
    if (!p.files.some((f) => MOCK_FILE.test(posix.basename(f)) || f.split('/').includes('__mocks__'))) {
      add(`${label(p)} has no mock; add ${p.dir}/mock.mjs (or mock.ts, or a __mocks__/ folder) exporting a stand-in with the same contract, so other modules can test without it and Line can fall back when it is down.`, 2);
    }
    if (!p.files.some((f) => TEST_FILE.test(posix.basename(f)) || f.split('/').slice(0, -1).some((s) => TEST_DIRS.has(s)))) {
      add(`${label(p)} has no tests of its own; add them in ${p.dir}/test/ (or as *.test.* files next to its code), so it can be checked on its own.`, 3);
    }
  }

  const byName = new Map(packages.filter((p) => p.name).map((p) => [p.name, p]));
  const ownerOf = (rel) => packages.find((p) => rel === p.dir || rel.startsWith(`${p.dir}/`));
  for (const p of packages) {
    for (const f of p.files) {
      const rel = `${p.dir}/${f}`;
      // Tests (line.writerExempt) may reach into what they test, as LINE-WRITER and LINE-SHARED allow them.
      if (!isCode(rel) || matchesAny(rel, line.writerExempt)) continue;
      const ast = project.ast(rel);
      if (ast instanceof Error) continue;
      for (const e of moduleEdges(ast)) {
        const spec = e.specifier;
        if (spec.startsWith('.')) {
          const other = ownerOf(posix.normalize(posix.join(posix.dirname(rel), spec)));
          if (!other || other === p) continue;
          const how = other.name ? `import it by its name "${other.name}" (or a subpath its package.json "exports" lists)` : `give ${other.dir}/package.json a name and import the package by that name`;
          hits.push({ rule: 'LINE-MODULE', file: rel, line: e.line, message: `"${rel}" imports "${spec}", a path into the package in ${other.dir}; ${how}, so that package can change its insides or be swapped for its mock.` });
          continue;
        }
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const other = byName.get(name);
        if (!other || other === p || spec === name) continue;
        const sub = `.${spec.slice(name.length)}`;
        if (exportsAllows(other.pkg?.exports, sub)) continue;
        hits.push({ rule: 'LINE-MODULE', file: rel, line: e.line, message: `"${rel}" imports "${spec}", a file inside ${name} that its package.json "exports" does not list; import "${name}" itself, or add "${sub}" to the "exports" of ${other.dir}/package.json if it is meant to be public.` });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// LINE-ATOM

/**
 * LINE-ATOM: hand-written code in the library or a feature that does a logic atom's job (with the typed fix "use atom
 * X"), and atoms imported by kinds other than usecases and services. The detection is @line/atoms' own check.
 * @param {ReturnType<typeof loadProject>} project The loaded project.
 * @returns {{rule: string, file: string, line: number, message: string, atom: string}[]} The hits.
 */
export function checkAtoms(project) {
  const hits = [];
  for (const file of project.files) {
    if ((file.area !== 'library' && file.area !== 'feature') || !isItemFile(file) || !isCode(file.rel)) continue;
    const ast = project.ast(file.rel);
    if (ast instanceof Error) continue;
    for (const h of findAtomCopies({ file: file.rel, source: project.source(file.rel), ast, kind: file.kind })) {
      hits.push({ rule: 'LINE-ATOM', file: h.file, line: h.line, message: h.message, atom: h.atom });
    }
  }
  return hits;
}
