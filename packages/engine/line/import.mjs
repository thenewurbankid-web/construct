// Line Import, partial migration (ci1, contract.mjs ImportScan / ImportPlan / ImportApplyResult): bring ONE folder of an app
// not built with Line into Line's layout. Static only (AST and import graph, no model):
//
//   scanImport(project, folder)            what the folder holds and what Line proposes; questions only where two rules disagree
//   planImport(project, folder, answers)   the proposals as plan-ready steps (tool + args + sentence), nothing written
//   applyImport(project, folder, answers)  each step planned on the current disk and landed through applyChange (the writer)
//   planImportStep(folderRoot, step)       one step -> StagedChange (what a plan runner calls; root = <project>/<folder>)
//
// The folder becomes a small Line project of its own (architecture.yml `preset: line`, <folder>/library,
// <folder>/features/<name>), and every step runs with the folder as the writer's root, so nothing outside it can be
// written. The rest of the project is only read: to see which pages use what and which routes serve which page. A file
// that code outside the folder imports keeps a one-line re-export at its old path, so the app keeps working unchanged.
//
// Rules (each found item lists the ids that decided it, for Details):
//   kind       components: exported PascalCase function or const that renders JSX; pages: the same under a pages folder,
//              named ...Page, or served by a route; workflows: exported functions with no JSX; fixtures: .json data.
//   used-by-pages   reached from 2 or more pages (through imports) -> library.
//   generic-name    a general UI name (Button, Card, Table, ...) -> library.
//   folder          otherwise -> the feature named after its folder (the folder itself when it sits in a kind folder).
//   one-page        used by exactly one page -> that page's feature.
//   A question is asked only when generic-name disagrees with the feature rules, or folder disagrees with one-page.
//   base       a feature item whose outermost element is a library component of the same kind, and which nothing in
//              the library uses, moves into the feature based on it; any other feature item is split: its complete
//              code goes to the library and the feature gets a thin item based on it (Line's library/feature pattern).
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError, assertStagedChange } from './contract.mjs';
import { planMoveFile, planBaseOn, planCreateLayout, applyChange } from './ops.mjs';
import { listFiles } from '../../core/profiles/line/checks.mjs';
import { CODE_EXTENSIONS, NON_ITEM_FILE } from '../../core/profiles/line/contract.mjs';
import { readPathAliases, resolveImportSpecifier, parseReactSpaRoutes } from '../../core/route-resolver.mjs';
import { parseToAst, walkAst } from '../../ast/index.mjs';
import { createTransaction } from '../transactionalWriter.mjs';
import { aggregateValidation } from '../../core/registry.mjs';
import { enforcersForRoot } from '../../core/profiles/index.mjs';

const posix = path.posix;
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\2/gm;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
/** General UI names: an item called exactly this is library material. */
export const GENERIC_UI = Object.freeze(['Accordion', 'Avatar', 'Badge', 'Breadcrumbs', 'Button', 'Card', 'Checkbox', 'Chip', 'Dialog', 'Divider',
  'Drawer', 'DropdownMenu', 'Field', 'Form', 'Icon', 'IconButton', 'Input', 'Label', 'Link', 'List', 'Loader', 'Menu', 'Modal', 'Pagination',
  'Popover', 'Progress', 'Radio', 'Select', 'Skeleton', 'Spinner', 'Switch', 'Tab', 'Table', 'Tabs', 'Tag', 'TextField', 'Toast', 'Tooltip']);
/** Folder names that say what a file is, not which feature it belongs to. */
const KIND_DIRS = new Set(['components', 'component', 'pages', 'page', 'hooks', 'services', 'service', 'workflows', 'fixtures', 'mocks', 'data',
  'ui', 'lib', 'libs', 'utils', 'api', 'src', 'views', 'screens', 'containers', 'routes', 'app']);
const KIND_ORDER = { fixtures: 0, workflows: 1, components: 2, pages: 3 };
const SINGULAR = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture' };
const JSON_CONFIG = /(^|\/)(package|package-lock|tsconfig[^/]*|jsconfig|composer|\.?eslintrc|components)\.json$/;

const stripExt = (rel) => rel.slice(0, rel.length - posix.extname(rel).length);
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const featureName = (dir) => dir.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'imported';
const isPagesDir = (seg) => /pages$/i.test(seg);

/** The folder, checked: project-relative, inside the project, an existing folder, not the project itself. */
function checkFolder(projectRoot, folder) {
  const f = String(folder ?? '').trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!f || f === '.' || f.startsWith('/') || f.includes('\\') || f.split('/').some((s) => s === '..' || s === '' || s.startsWith('.'))) {
    throw new LineOpError(`"${folder ?? ''}" is not a folder inside the project; pick one folder of it, such as src/alerts.`, 'BAD_FOLDER');
  }
  if (!fs.statSync(path.join(projectRoot, f), { throwIfNoEntry: false })?.isDirectory()) {
    throw new LineOpError(`The project has no folder "${f}"; pick one of its folders.`, 'BAD_FOLDER');
  }
  return f;
}

/** The folders worth importing: every folder (to depth 4) holding code, with its code-file count, largest first. */
export function listImportFolders(projectRoot) {
  const counts = new Map();
  for (const rel of listFiles(projectRoot)) {
    if (!CODE_EXTENSIONS.includes(posix.extname(rel))) continue;
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= Math.min(parts.length, 4); i += 1) {
      const dir = parts.slice(0, i).join('/');
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  const folders = [...counts].map(([p, files]) => ({ path: p, files })).sort((a, b) => a.path.localeCompare(b.path));
  return { sourceRoot: path.resolve(projectRoot), folders };
}

// ---------------------------------------------------------------------------------------------
// Reading the project: import graph, routes, and what each file in the folder exports.

/** Module specifiers of a source text (static, dynamic, require, side-effect). */
function specifiersOf(src) {
  return [...src.matchAll(SPECIFIER)].map((m) => m[3]);
}

/** The project's import graph over its code files: file -> resolved project-relative targets (and the reverse). */
function importGraph(projectRoot, files) {
  const { aliases } = readPathAliases(projectRoot);
  const imports = new Map();
  const importers = new Map();
  const sources = new Map();
  for (const rel of files) {
    if (!CODE_EXTENSIONS.includes(posix.extname(rel))) continue;
    let src;
    try { src = fs.readFileSync(path.join(projectRoot, rel), 'utf8'); } catch { continue; }
    sources.set(rel, src);
    const targets = new Set();
    for (const spec of specifiersOf(src)) {
      if (!spec.startsWith('.') && !aliases.some((a) => spec.startsWith(a.prefix))) continue;
      const abs = resolveImportSpecifier(path.join(projectRoot, rel), spec, aliases);
      if (!abs) continue;
      const t = toRel(projectRoot, abs);
      if (t.startsWith('..')) continue;
      targets.add(t);
      if (!importers.has(t)) importers.set(t, new Set());
      importers.get(t).add(rel);
    }
    imports.set(rel, targets);
  }
  return { imports, importers, sources, aliases };
}

/** Next.js app-router route of an `app/.../page.tsx` file: groups dropped, `[x]` as `:x`. */
function appRoute(rel) {
  const m = rel.match(/(?:^|\/)app\/(.*?)\/?page\.[cm]?[jt]sx?$/) || rel.match(/(?:^|\/)app\/()page\.[cm]?[jt]sx?$/);
  if (!m) return null;
  const segs = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).map((s) => s.replace(/^\[+\.{0,3}(.*?)\]+$/, ':$1'));
  return `/${segs.join('/')}`;
}

/** Which file a JSX name in `src` (the file at `rel`) was imported from. */
function bindingTarget(projectRoot, graph, rel, src, name) {
  const re = new RegExp(`import\\s+(?:type\\s+)?(?:${name}\\b|[^;]*?\\{[^}]*\\b(?:\\w+\\s+as\\s+)?${name}\\b[^}]*\\})[^;]*?from\\s+(['"])([^'"]+)\\1`);
  const m = src.match(re);
  if (!m) return null;
  const abs = resolveImportSpecifier(path.join(projectRoot, rel), m[2], graph.aliases);
  return abs ? toRel(projectRoot, abs) : null;
}

/** Every route the project declares: app-router page files, and `<Route path element={<X/>}>` tables. */
function readRoutes(projectRoot, graph) {
  /** @type {{path: string, file: string, entry: string}[]} */
  const routes = [];
  for (const [rel, src] of graph.sources) {
    const r = appRoute(rel);
    if (r !== null) {
      routes.push({ path: r, file: rel, entry: rel });
      for (const t of graph.imports.get(rel) ?? []) routes.push({ path: r, file: t, entry: rel });
    }
    if (/<Route\b/.test(src)) {
      let table = [];
      try { table = parseReactSpaRoutes(src); } catch { table = []; }
      for (const { path: p, component } of table) {
        const t = bindingTarget(projectRoot, graph, rel, src, component);
        if (t) routes.push({ path: p, file: t, entry: rel });
      }
    }
  }
  return routes;
}

/** True when the AST subtree holds JSX. */
function hasJsx(node) {
  let found = false;
  walkAst(node, { enter(/** @type {any} */ n) { if (n.type === 'JSXElement' || n.type === 'JSXFragment') { found = true; this.skip(); } } });
  return found;
}

/** The outermost JSX element a function returns, as a tag name (null when it is a DOM tag or none). */
function rootTag(fn) {
  let tag = null;
  walkAst(fn.body ?? fn, {
    enter(/** @type {any} */ n) {
      if (tag) return this.skip();
      const ret = /** @type {any} */ (n.type === 'ReturnStatement' ? n.argument : (n === fn.body && n.type === 'JSXElement' ? n : null));
      const el = ret?.type === 'ParenthesizedExpression' ? ret.expression : ret;
      if (el?.type === 'JSXElement') {
        const name = el.openingElement.name;
        if (name.type === 'JSXIdentifier' && PASCAL.test(name.name)) tag = name.name;
        else tag = '';
      }
    },
  });
  return tag || null;
}

/**
 * What one code file exports: its components (exported PascalCase functions rendering JSX), whether it exports other
 * functions, and whether it has a default export.
 */
function readExports(src) {
  let ast;
  try { ast = parseToAst(src); } catch { return null; }
  const locals = new Map(); // name -> function node
  const fnOf = (decl) => {
    if (!decl) return null;
    if (decl.type === 'FunctionDeclaration') return decl;
    if (decl.type === 'VariableDeclarator') {
      let init = decl.init;
      while (init && (init.type === 'CallExpression') && init.arguments?.[0]) init = init.arguments[0]; // memo(...), forwardRef(...)
      if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) return init;
    }
    return null;
  };
  for (const node of ast.body) {
    const d = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
    if (d?.type === 'FunctionDeclaration' && d.id) locals.set(d.id.name, d);
    if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id?.type === 'Identifier' && fnOf(v)) locals.set(v.id.name, fnOf(v));
  }
  const exported = new Set();
  let hasDefault = false;
  let defaultName = null;
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.type === 'FunctionDeclaration' && d.id) exported.add(d.id.name);
      if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id?.type === 'Identifier') exported.add(v.id.name);
      for (const s of node.specifiers ?? []) {
        if (s.exported?.name === 'default') { hasDefault = true; defaultName = s.local?.name ?? null; } else if (s.local?.name) exported.add(s.local.name);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      hasDefault = true;
      const d = node.declaration;
      if (d.type === 'Identifier') defaultName = d.name;
      else if (d.id?.name) { defaultName = d.id.name; locals.set(d.id.name, d); }
      else if (d.type === 'ArrowFunctionExpression' || d.type === 'FunctionExpression' || d.type === 'FunctionDeclaration') { defaultName = 'default'; locals.set('default', d); }
    }
  }
  if (defaultName) exported.add(defaultName);
  const components = [];
  let functions = 0;
  for (const name of exported) {
    const fn = locals.get(name);
    if (!fn) continue;
    if ((PASCAL.test(name) || name === 'default') && hasJsx(fn)) components.push({ name, root: rootTag(fn) });
    else functions += 1;
  }
  return { components, functions, hasDefault };
}

// ---------------------------------------------------------------------------------------------
// Scan

/** The feature a file in the folder belongs to by folder name: its nearest folder that is not a kind folder, else the folder itself. */
function folderFeature(folder, rel) {
  const dirs = rel.slice(folder.length + 1).split('/').slice(0, -1).filter((d) => !KIND_DIRS.has(d.toLowerCase()) && !isPagesDir(d));
  return featureName(dirs.length ? dirs[dirs.length - 1] : posix.basename(folder));
}

/** Pages (project-relative) that reach `rel` through imports, stopping at each page. */
function pagesReaching(rel, graph, isPage) {
  const out = new Set();
  const seen = new Set([rel]);
  const queue = [rel];
  while (queue.length) {
    const cur = queue.shift();
    for (const imp of graph.importers.get(cur) ?? []) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      if (isPage(imp)) out.add(imp); else queue.push(imp);
    }
  }
  return out;
}

const levelFromSize = (src) => {
  const lines = src.split('\n').filter((l) => l.trim()).length;
  return lines <= 30 ? 'atom' : lines <= 100 ? 'molecule' : 'organism';
};

/** Read the project and classify every file in the folder (kinds, usage, routes); no decisions yet. */
function readFolder(projectRoot, folder) {
  const files = listFiles(projectRoot);
  const graph = importGraph(projectRoot, files);
  const routes = readRoutes(projectRoot, graph);
  const inFolder = files.filter((f) => f.startsWith(`${folder}/`));
  const routeOf = new Map();
  for (const r of routes) if (!routeOf.has(r.file)) routeOf.set(r.file, r.path);
  const routeEntries = new Set(routes.map((r) => r.entry));
  /** @type {any[]} */
  const items = [];
  const unchanged = [];
  for (const rel of inFolder) {
    const ext = posix.extname(rel);
    const base = posix.basename(rel);
    if (ext === '.json') {
      if (JSON_CONFIG.test(rel)) { unchanged.push({ file: rel, sentence: `${base} is configuration, so it stays where it is.` }); continue; }
      items.push({ file: rel, kind: 'fixtures', name: stripExt(base), src: fs.readFileSync(path.join(projectRoot, rel), 'utf8') });
      continue;
    }
    if (!CODE_EXTENSIONS.includes(ext)) continue;
    if (NON_ITEM_FILE.test(base)) { unchanged.push({ file: rel, sentence: `${base} is a test, story or index file, so it stays where it is.` }); continue; }
    const src = graph.sources.get(rel) ?? '';
    const ex = readExports(src);
    if (!ex) { unchanged.push({ file: rel, sentence: `${base} could not be read as code, so it stays where it is.` }); continue; }
    if (ex.components.length) {
      const own = stripExt(base);
      const main = ex.components.find((c) => c.name === own) ?? ex.components[0];
      const name = main.name === 'default' ? own : main.name;
      if (!PASCAL.test(name)) { unchanged.push({ file: rel, sentence: `${base} has no capitalised component name, so it stays where it is.` }); continue; }
      const segs = rel.split('/').slice(0, -1);
      const page = segs.some(isPagesDir) || /Page$/.test(name) || routeOf.has(rel) || appRoute(rel) !== null;
      items.push({ file: rel, kind: page ? 'pages' : 'components', name, root: main.root, src, hasDefault: ex.hasDefault, route: routeOf.get(rel) });
    } else if (ex.functions && (/^use[A-Z]/.test(base) || /from\s+['"]react(-dom)?['"]/.test(src))) {
      unchanged.push({ file: rel, sentence: `${base} is a React hook, and a Line workflow holds plain logic without React, so it stays where it is for now.` });
    } else if (ex.functions) {
      items.push({ file: rel, kind: 'workflows', name: stripExt(base), src, hasDefault: ex.hasDefault });
    } else {
      unchanged.push({ file: rel, sentence: `${base} holds only types or constants, so it stays where it is.` });
    }
  }
  const pageFiles = new Set(items.filter((i) => i.kind === 'pages').map((i) => i.file));
  const isPage = (f) => pageFiles.has(f) || routeEntries.has(f) || appRoute(f) !== null || (!f.startsWith(`${folder}/`) && /(^|\/)[^/]*pages?\//i.test(f));
  for (const it of items) {
    it.pages = [...pagesReaching(it.file, graph, isPage)].sort();
    it.usedBy = [...(graph.importers.get(it.file) ?? [])].sort();
    it.outsideUsers = it.usedBy.filter((u) => !u.startsWith(`${folder}/`));
    it.folderFeature = folderFeature(folder, it.file);
  }
  return { items, unchanged, routes, graph };
}

const pageFeatureOf = (folder, page) => (page.startsWith(`${folder}/`) ? folderFeature(folder, page) : null);

/** The questions two rules raise for an item, with the recommended option first. */
function questionsFor(folder, it) {
  if (it.kind === 'pages' || it.pages.length >= 2) return [];
  const qs = [];
  const feature = it.pages.length === 1 ? (pageFeatureOf(folder, it.pages[0]) ?? it.folderFeature) : it.folderFeature;
  if (it.kind === 'components' && GENERIC_UI.includes(it.name)) {
    qs.push({
      id: `generic-name:${it.file}`, file: it.file,
      sentence: `${it.name} sounds like general UI, so it could go to the library, but ${it.pages.length ? 'only one page uses it' : 'no page uses it yet'}; where should it go?`,
      options: [
        { id: 'library', sentence: `Put ${it.name} in the library, so every feature can use it.` },
        { id: `feature:${feature}`, sentence: `Keep ${it.name} in feature ${feature}, where it is used.` },
      ],
      recommended: 'library',
    });
  } else if (it.pages.length === 1) {
    const pf = pageFeatureOf(folder, it.pages[0]);
    if (pf && pf !== it.folderFeature) {
      qs.push({
        id: `one-page:${it.file}`, file: it.file,
        sentence: `${it.name} sits in the ${it.folderFeature} folder, but only a page of feature ${pf} uses it; which feature should own it?`,
        options: [
          { id: `feature:${pf}`, sentence: `Feature ${pf}, where its only page is.` },
          { id: `feature:${it.folderFeature}`, sentence: `Feature ${it.folderFeature}, after its folder.` },
        ],
        recommended: `feature:${pf}`,
      });
    }
  }
  return qs;
}

/** Targets for every item (library, or a feature), with the rules that decided each and the answers given. */
function decideTargets(folder, items, answers) {
  for (const it of items) {
    it.rules = [];
    const qs = questionsFor(folder, it);
    it.questions = qs;
    const answer = qs.length ? (answers?.[qs[0].id] ?? qs[0].recommended) : null;
    it.answered = Boolean(qs.length && answers?.[qs[0].id]);
    if (it.kind === 'pages') {
      it.rules.push('kind-page', 'folder');
      it.target = 'feature';
      it.feature = it.folderFeature;
    } else if (it.pages.length >= 2) {
      it.rules.push('used-by-pages');
      it.target = 'library';
    } else if (answer) {
      it.rules.push(qs[0].id.split(':')[0], 'answer');
      it.target = answer === 'library' ? 'library' : 'feature';
      it.feature = answer.startsWith('feature:') ? answer.slice('feature:'.length) : undefined;
    } else if (it.pages.length === 1 && pageFeatureOf(folder, it.pages[0])) {
      it.rules.push('one-page');
      it.target = 'feature';
      it.feature = pageFeatureOf(folder, it.pages[0]);
    } else {
      it.rules.push('folder');
      it.target = 'feature';
      it.feature = it.folderFeature;
    }
  }
}

/** Bases: which feature items move in on a real library base, and which are split (complete code to the library). */
function decideBases(folder, items, graph) {
  const byFile = new Map(items.map((i) => [i.file, i]));
  const libLiving = new Set(items.filter((i) => i.target === 'library').map((i) => i.file));
  for (const it of items) {
    if (it.target !== 'feature') continue;
    it.mode = 'split';
    if (it.kind === 'components' && it.root) {
      // The file the outermost element is imported from, resolved like the graph does.
      const spec = (it.src.match(new RegExp(`import\\s+(?:${it.root}\\b|[^;]*?\\{[^}]*\\b${it.root}\\b[^}]*\\})[^;]*?from\\s+(['"])([^'"]+)\\1`)) || [])[2];
      const target = [...(graph.imports.get(it.file) ?? [])].find((t) => spec && stripExt(t).endsWith(stripExt(spec.replace(/^(\.\.?\/)+/, '').replace(/^@\//, ''))));
      const lib = target && byFile.get(target);
      if (lib && lib.target === 'library' && lib.kind === 'components') { it.mode = 'move'; it.baseItem = lib; }
    }
    if (it.mode === 'split') libLiving.add(it.file);
  }
  // A feature item that a library item uses must be split too (the library may use only the library); repeat to a fixpoint.
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of items) {
      if (it.target !== 'feature' || it.mode !== 'move') continue;
      if ([...(graph.importers.get(it.file) ?? [])].some((u) => libLiving.has(u))) { it.mode = 'split'; libLiving.add(it.file); changed = true; }
    }
  }
  for (const it of items) {
    if (it.target === 'library') { it.libraryId = `${it.kind}/${it.name}`; if (it.kind === 'components') it.level = levelFromSize(it.src); }
    if (it.target === 'feature') it.base = it.mode === 'move' ? `components/${it.baseItem.name}` : `${it.kind}/${it.name}`;
  }
}

function proposalSentence(it) {
  const used = it.pages.length >= 2 ? `${it.pages.length} pages use it` : it.pages.length === 1 ? 'only one page uses it' : 'no page uses it';
  if (it.target === 'library') {
    const lvl = it.level ? ` as ${it.level === 'atom' ? 'an' : 'a'} ${it.level}` : '';
    const why = it.rules.includes('used-by-pages') ? `, because ${used}` : it.rules.includes('answer') ? (it.answered ? ', as you chose' : ' unless you choose otherwise') : '';
    return `${it.name} goes to the library${lvl}${why}.`;
  }
  const route = it.route ? `, served at ${it.route}` : '';
  if (it.mode === 'move') return `${it.name} goes to feature ${it.feature}, based on the library ${it.baseItem.name} that it renders${route}.`;
  return `${it.name} goes to feature ${it.feature}${route}; its full code goes to the library and the feature gets a ${SINGULAR[it.kind]} based on it.`;
}

/** Scan and decide (with `answers`, recommended where none). */
function decide(projectRoot, folderArg, answers) {
  const folder = checkFolder(projectRoot, folderArg);
  const { items, unchanged, routes, graph } = readFolder(projectRoot, folder);
  decideTargets(folder, items, answers);
  decideBases(folder, items, graph);
  return { folder, items, unchanged, routes };
}

/**
 * Scan one folder of the open project: what it holds and what Line proposes for each item (pure read, no model).
 * @param {string} projectRoot The open project (absolute).
 * @param {string} folder Project-relative folder.
 * @returns {import('./contract.mjs').ImportScan}
 * @throws {LineOpError} BAD_FOLDER.
 */
export function scanImport(projectRoot, folder) {
  const d = decide(projectRoot, folder, {});
  const order = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.file.localeCompare(b.file);
  const items = [...d.items].sort(order);
  return {
    sourceRoot: path.resolve(projectRoot),
    folder: d.folder,
    found: items.map((it) => ({
      file: it.file, kind: it.kind, name: it.name,
      proposal: {
        target: it.target,
        ...(it.target === 'feature' ? { feature: it.feature, base: it.base } : {}),
        ...(it.level ? { level: it.level } : {}),
        ...(it.route ? { route: it.route } : {}),
        sentence: proposalSentence(it),
      },
      confidence: it.questions.length ? 'ask' : 'sure',
      rules: it.rules,
      usedBy: it.usedBy,
    })),
    questions: items.flatMap((it) => it.questions),
    unchanged: d.unchanged,
    routes: [...new Set(d.routes.filter((r) => r.file !== r.entry).map((r) => `${r.path} -> ${r.file}`))].sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// Plan

/**
 * The proposals as plan-ready steps. Order: mark the folder as Line; every complete item into the library (fixtures,
 * workflows, components, pages); feature items that move in on a real base; then the thin feature items over split ones.
 * @param {string} projectRoot
 * @param {string} folder
 * @param {Record<string, string>} [answers] Question id -> option id; the recommended option where missing.
 * @returns {import('./contract.mjs').ImportPlan}
 */
export function planImport(projectRoot, folder, answers = {}) {
  const d = decide(projectRoot, folder, answers);
  const f = d.folder;
  const order = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.file.localeCompare(b.file);
  const items = [...d.items].sort(order);
  const features = [...new Set(items.filter((i) => i.target === 'feature').map((i) => i.feature))].sort();
  const local = (rel) => rel.slice(f.length + 1);
  /** @type {import('./contract.mjs').ImportStep[]} */
  const steps = [];
  const add = (tool, args, sentence, slug) => steps.push({ id: `import-${steps.length + 1}-${slug}`, tool, args: { folder: f, ...args }, sentence });
  add('line.import.mark', { features }, `Marks ${f} as a Line folder, with a library and ${features.length === 1 ? `the feature ${features[0]}` : `the features ${features.join(', ')}`}${features.length ? '' : ' no features'}.`, 'mark');
  const shimNote = (it) => (it.outsideUsers.length ? ` Its old file stays as a one-line link, because ${it.outsideUsers.length === 1 ? posix.basename(it.outsideUsers[0]) : `${it.outsideUsers.length} files`} outside the folder use${it.outsideUsers.length === 1 ? 's' : ''} it.` : '');
  for (const it of items.filter((i) => i.target === 'library' || i.mode === 'split')) {
    const lvl = it.target === 'library' && it.level ? it.level : undefined;
    add('line.import.toLibrary', { from: local(it.file), kind: it.kind, name: it.name, ...(lvl ? { level: lvl } : {}), keepShim: it.outsideUsers.length > 0 },
      `Moves ${it.name} into the library${lvl ? ` as ${lvl === 'atom' ? 'an' : 'a'} ${lvl}` : ''} and points its users at it.${shimNote(it)}`, `lib-${it.name}`);
  }
  for (const it of items.filter((i) => i.mode === 'move')) {
    add('line.import.toFeature', { mode: 'move', from: local(it.file), kind: it.kind, name: it.name, feature: it.feature, base: it.base, keepShim: it.outsideUsers.length > 0, ...(it.route ? { route: it.route } : {}) },
      `Moves ${it.name} into feature ${it.feature}, based on the library ${it.baseItem.name}.${shimNote(it)}`, `feature-${it.name}`);
  }
  for (const it of items.filter((i) => i.mode === 'split')) {
    add('line.import.toFeature', { mode: 'wrap', kind: it.kind, name: it.name, feature: it.feature, base: it.base, ...(it.route ? { route: it.route } : {}) },
      `Adds ${it.name} to feature ${it.feature}, based on the library ${it.name}${it.route ? `, serving ${it.route}` : ''}.`, `feature-${it.name}`);
  }
  const lib = items.filter((i) => i.target === 'library').length;
  const feat = items.length - lib;
  const summary = items.length
    ? `Brings ${items.length} item${items.length === 1 ? '' : 's'} of ${f} into Line in ${steps.length} steps: ${lib} to the library and ${feat} to ${features.length === 1 ? `feature ${features[0]}` : `${features.length} features`}; nothing outside ${f} changes.`
    : `There is nothing in ${f} for Line to bring in.`;
  return { folder: f, summary, steps: items.length ? steps : [] };
}

// ---------------------------------------------------------------------------------------------
// Steps (plan-ready tools): each returns a StagedChange relative to the folder.

/** A re-export left at an old path so code outside the folder keeps working. */
function shimSource(oldRel, newRel, src) {
  if (posix.extname(oldRel) === '.json') return src;
  let spec = posix.relative(posix.dirname(oldRel), stripExt(newRel));
  if (!spec.startsWith('.')) spec = `./${spec}`;
  const def = /export\s+default\b|export\s*\{[^}]*\bas\s+default\b/.test(src) ? `export { default } from '${spec}';\n` : '';
  return `// Moved into Line: ${newRel}. This file stays so code outside this folder keeps working.\nexport * from '${spec}';\n${def}`;
}

/** Put the shim in place of the old file's delete. */
function withShim(change, from, to, keepShim) {
  if (!keepShim) return change;
  const original = change.files.find((x) => x.path === to)?.content ?? '';
  return { ...change, files: change.files.map((x) => (x.path === from && x.content === null ? { path: from, content: shimSource(from, to, original) } : x)) };
}

/**
 * Imported code rarely follows Line's layer rules yet (a page that calls a hook, say). Those findings travel with the
 * code; they are not new problems. So a move step records the layer findings its moved file already brings as named
 * exceptions in the folder's architecture.yml (the to-do list for bringing it to the pattern), in the same change.
 * LINE-* rules (bases, ownership, direction, writer) are never excepted: the writer still refuses those.
 * The findings come from a dry run of the same writer: staged in a transaction, validated in its shadow copy, never committed.
 */
function withCarriedExceptions(root, change, moved, from) {
  const txn = createTransaction(root);
  /** @type {any[]} */
  let found = [];
  try {
    for (const f of change.files) { if (f.content === null) txn.deleteFile(f.path); else txn.writeFile(f.path, f.content); }
    txn.commit({ validate: (shadow, ctx) => { found = aggregateValidation(shadow, enforcersForRoot(shadow), ctx).violations; return { violations: [], ok: false }; } });
  } catch { found = []; } finally { txn.reset(); }
  const rules = [...new Set(found.filter((v) => v.file === moved && v.severity === 'error' && !String(v.rule).startsWith('LINE-')).map((v) => String(v.rule)))].sort();
  if (!rules.length) return change;
  const yml = change.files.find((x) => x.path === 'architecture.yml')?.content ?? fs.readFileSync(path.join(root, 'architecture.yml'), 'utf8');
  const head = /^exceptions:\s*$/m.test(yml) ? yml.replace(/\n*$/, '\n') : `${yml.replace(/\n*$/, '\n')}exceptions:\n`;
  const entry = `  - path: ${moved}\n    rules: [${rules.join(', ')}]\n    reason: Imported from ${from}; Line brings it to the pattern step by step.\n`;
  return { ...change, files: [...change.files.filter((x) => x.path !== 'architecture.yml'), { path: 'architecture.yml', content: head + entry }] };
}

const libPath = (args) =>`library/${args.kind}/${args.name}${posix.extname(String(args.from))}`;

/** Every tool an import step can name; each is (folderRoot, args) -> StagedChange. */
export const IMPORT_STEP_TOOLS = Object.freeze({
  'line.import.mark': (root, { folder, features = [] }) => {
    const files = [];
    if (!fs.existsSync(path.join(root, 'architecture.yml'))) files.push({ path: 'architecture.yml', content: `# ${folder} was brought into Line by Import; the rest of the project is not a Line project.\nversion: 1\npreset: line\n` });
    if (!fs.existsSync(path.join(root, 'library'))) files.push(...planCreateLayout(root).files);
    for (const name of features) {
      if (!fs.existsSync(path.join(root, 'features', name, 'spec.md'))) files.push({ path: `features/${name}/spec.md`, content: `# ${name}\n\nBrought into Line from ${folder} by Import. Write what this feature does here.\n` });
    }
    if (!files.length) throw new LineOpError(`${folder} is already marked as a Line folder.`, 'NAME_TAKEN');
    return { summary: `Marks ${folder} as a Line folder.`, files };
  },
  'line.import.toLibrary': (root, { from, kind, name, level, keepShim }) => {
    const to = libPath({ from, kind, name });
    let change = planMoveFile(root, { from, to });
    if (level) change = { ...change, files: change.files.map((x) => (x.path === to ? { ...x, content: `// @line-level ${level}\n${x.content}` } : x)) };
    change = withCarriedExceptions(root, withShim(change, from, to, keepShim), to, from);
    return { ...change, summary: `Moves ${name} into the library.` };
  },
  'line.import.toFeature': (root, { mode, from, kind, name, feature, base, route, keepShim }) => {
    const addRoute = (c, p) => (route && kind === 'pages' ? { ...c, files: c.files.map((x) => (x.path === p ? { ...x, content: x.content.replace(/^(\/\/ @line-base [^\n]*\n)/, `$1// @line-route ${route}\n`) } : x)) } : c);
    if (mode === 'move') {
      const to = `features/${feature}/${kind}/${name}${posix.extname(String(from))}`;
      const change = withCarriedExceptions(root, addRoute(withShim(planMoveFile(root, { from, to, base }), from, to, keepShim), to), to, from);
      return { ...change, summary: `Moves ${name} into feature ${feature}.` };
    }
    const change = planBaseOn(root, { libraryId: base, feature, name });
    return { ...addRoute(change, change.files[0].path), summary: `Adds ${name} to feature ${feature}, based on the library ${name}.` };
  },
});

/**
 * One step's StagedChange, planned on the folder as it is now.
 * @param {string} folderRoot `<project>/<step.args.folder>` (absolute).
 * @param {import('./contract.mjs').ImportStep} step
 * @returns {import('./contract.mjs').StagedChange}
 */
export function planImportStep(folderRoot, step) {
  const tool = IMPORT_STEP_TOOLS[step?.tool];
  if (!tool) throw new LineOpError(`"${step?.tool}" is not an import step Line knows.`, 'UNKNOWN_TOOL');
  const change = tool(folderRoot, /** @type {any} */ (step.args ?? {}));
  assertStagedChange(change);
  return change;
}

/**
 * Plan and apply the import step by step: each step is planned on the current disk and lands only through applyChange
 * with the folder as the root, so nothing outside the folder can be written. Stops at the first refused step.
 * @param {string} projectRoot
 * @param {string} folder
 * @param {Record<string, string>} [answers]
 * @returns {import('./contract.mjs').ImportApplyResult}
 */
export function applyImport(projectRoot, folder, answers = {}) {
  const plan = planImport(projectRoot, folder, answers);
  const root = path.join(projectRoot, plan.folder);
  const written = [];
  const steps = [];
  const prefix = (p) => `${plan.folder}/${p}`;
  if (!plan.steps.length) return { ok: false, sentence: `Nothing was saved: there is nothing in ${plan.folder} for Line to bring in.`, files: [], findings: [], steps };
  for (const step of plan.steps) {
    let change;
    try {
      change = planImportStep(root, step);
    } catch (e) {
      const s = e instanceof LineOpError || e?.name === 'LineOpError' ? e.sentence : 'Line could not plan this step.';
      steps.push({ id: step.id, ok: false, sentence: `Not done: ${s.charAt(0).toLowerCase()}${s.slice(1)}` });
      return { ok: false, sentence: `Stopped at "${step.sentence.replace(/[.?!]$/, '')}": ${s.charAt(0).toLowerCase()}${s.slice(1)}`, files: [], findings: [], steps, landed: written };
    }
    const outside = change.files.find((x) => x.path.startsWith('/') || x.path.split('/').includes('..'));
    if (outside) {
      steps.push({ id: step.id, ok: false, sentence: `Not done: Line writes only inside ${plan.folder}, and this step would write ${outside.path}.` });
      return { ok: false, sentence: `Nothing more was saved: Line writes only inside ${plan.folder}, and a step would write ${outside.path}.`, files: [], findings: [], steps, landed: written };
    }
    const r = applyChange(root, change);
    steps.push({ id: step.id, ok: r.ok, sentence: r.ok ? step.sentence : r.sentence });
    if (!r.ok) {
      return { ok: false, sentence: `Stopped at "${step.sentence.replace(/[.?!]$/, '')}": ${r.sentence.charAt(0).toLowerCase()}${r.sentence.slice(1)}`, files: [], findings: r.findings.map((x) => ({ ...x, file: x.file === '.' ? plan.folder : prefix(x.file) })), steps, landed: written };
    }
    written.push(...r.files.map(prefix));
  }
  return { ok: true, sentence: `Saved. ${plan.summary}`, files: [...new Set(written)], findings: [], steps };
}
