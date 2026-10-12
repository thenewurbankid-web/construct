// Line Import, partial migration (ci1, contract.mjs ImportScan / ImportPlan / ImportApplyResult): bring ONE folder of an app
// not built with Line into Line's layout. Static only (AST and import graph, no model):
//
//   scanImport(project, folder)            what the folder holds and what Line proposes; questions only where two rules disagree
//   planImport(project, folder, answers)   the proposals as plan-ready steps (tool + args + sentence), nothing written
//   (Import v2) `folder` may also be `{route}` or `{route, folder}`: a route family (importV2/route.mjs readRouteFamily)
//   seeds the import instead. Only the family's files are read as items, and every feature item goes to ONE feature
//   named after the route (/opportunity -> opportunity); the folder defaults to the closure's common code folder.
//   applyImport(project, folder, answers)  every step chained in a scratch copy, then ONE applyChange (the writer): all or nothing
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
import os from 'node:os';
import path from 'node:path';
import { LineOpError, assertStagedChange } from './contract.mjs';
import { planMoveFile, planBaseOn, planCreateLayout, applyChange } from './ops.mjs';
import { listFiles, findSharedCopies } from '@line/construct-core/profiles/line/checks';
import { WALK_SKIP_DIRS, isGitCheckout } from '@line/construct-core/fs';
import { CODE_EXTENSIONS, NON_ITEM_FILE, SHARED_CONCERNS } from '@line/construct-core/profiles/line/contract';
import { buildLogicMap } from './logicMap.mjs';
import { fileLogicKind } from './importV2/fit.mjs';
import { readPathAliases, resolveImportSpecifier, parseReactSpaRoutes } from '@line/construct-core/route-resolver';
import { appRoute, bindingSpecifier, readRouteFamily, familyFeature, commonFolder, routeLabel } from './importV2/route.mjs';
import { parseToAst, walkAst } from '@construct/ast';
import { createTransaction } from '../transactionalWriter.mjs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { editYamlDocument } from '@line/construct-core/yaml-edit';

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
const KIND_ORDER = { fixtures: 0, workflows: 1, services: 1, domains: 1, components: 2, pages: 3 };
const SINGULAR = { components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture', services: 'service', domains: 'domain' };
/** The logic kinds: no library base, so a feature's one moves in as it is (never split into library + thin item). */
const LOGIC_ITEM_KINDS = new Set(['services', 'domains']);
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

/**
 * The folders worth importing: every folder (to depth 4) holding code, with its code-file count, sorted by path.
 * @param {string} projectRoot The project to scan.
 * @returns {{sourceRoot: string, folders: {path: string, files: number}[]}} The project's absolute root and its code folders.
 */
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

/**
 * The project's import graph over its code files: file -> resolved project-relative targets, and the reverse
 * (importers: who uses a file), plus each file's source and the path aliases used. Import v2 reads reverse users from it.
 * @param {string} projectRoot The project (absolute).
 * @param {string[]} files Project-relative files (non-code files are skipped).
 * @returns {{imports: Map<string, Set<string>>, importers: Map<string, Set<string>>, sources: Map<string, string>, aliases: {prefix: string, target: string}[]}}
 */
export function importGraph(projectRoot, files) {
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

/** Which file a JSX name in `src` (the file at `rel`) was imported from. */
function bindingTarget(projectRoot, graph, rel, src, name) {
  const spec = bindingSpecifier(src, name);
  if (!spec) return null;
  const abs = resolveImportSpecifier(path.join(projectRoot, rel), spec, graph.aliases);
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
function readFolder(projectRoot, folder, scope = /** @type {{only?: Set<string>, family?: string}} */ ({})) {
  const files = listFiles(projectRoot);
  const graph = importGraph(projectRoot, files);
  const routes = readRoutes(projectRoot, graph);
  // Items already in Line's layout inside the folder (its library and features, and Line's own state) are not brought in
  // again; the plan only checks new names against them (resolveClashes). Import v2: a route family reads only its own
  // closure's files, and names one feature after the route.
  const lineOwn = ['library', 'features', 'line'].map((d) => `${folder}/${d}/`);
  // The characterization tests Line generated (characterize.mjs CHAR_DIR) pin the app; they are never items to move.
  const inFolder = files.filter((f) => f.startsWith(`${folder}/`) && !lineOwn.some((d) => f.startsWith(d)) && !f.split('/').includes('__line_characterization__') && (!scope.only || scope.only.has(f)));
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
    const stay = stayInPlace(rel, src);
    if (stay) { unchanged.push({ file: rel, sentence: stay }); continue; }
    const ex = readExports(src);
    if (!ex) { unchanged.push({ file: rel, sentence: `${base} could not be read as code, so it stays where it is.` }); continue; }
    if (ex.components.length) {
      const own = stripExt(base);
      const main = ex.components.find((c) => c.name === own) ?? ex.components[0];
      const name = main.name === 'default' ? own : main.name;
      if (!PASCAL.test(name)) { unchanged.push({ file: rel, sentence: `${base} has no capitalised component name, so it stays where it is.` }); continue; }
      const segs = rel.split('/').slice(0, -1);
      const page = segs.some(isPagesDir) || /Page$/.test(name) || routeOf.has(rel) || appRoute(rel) !== null;
      items.push({ file: rel, kind: page ? 'pages' : 'components', name, exportName: main.name === 'default' ? null : main.name, root: main.root, src, hasDefault: ex.hasDefault, route: routeOf.get(rel) });
    } else if (ex.functions && (/^use[A-Z]/.test(base) || /from\s+['"]react(-dom)?['"]/.test(src))) {
      unchanged.push({ file: rel, sentence: `${base} is a React hook, and a Line workflow holds plain logic without React, so it stays where it is for now.` });
    } else if (ex.functions) {
      // Follow the fit (importV2/fit.mjs): data -> services, pure -> domains, screen flow -> workflows.
      let units = [];
      try { units = buildLogicMap(projectRoot, [rel]).units; } catch { units = []; }
      items.push({ file: rel, kind: fileLogicKind(rel, units), name: stripExt(base), src, hasDefault: ex.hasDefault });
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
    it.folderFeature = scope.family ?? folderFeature(folder, it.file);
    it.family = scope.family;
  }
  return { items, unchanged, routes, graph };
}

/** A Next.js app-router file: the framework finds it by its path (page.tsx, layout.tsx, route.ts, ... under app/), nothing imports it. */
const servedByPath = (rel) => /(?:^|\/)app\/(?:.*\/)?(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[cm]?[jt]sx?$/.test(rel);
/** Path-routed files Import leaves where they are: every app-router file but a page, and the app's middleware and
 * instrumentation. (A page is brought in; its path keeps a one-line link to it.) */
const FRAMEWORK_FILE = /(?:^|\/)app\/(?:.*\/)?(?:layout|template|loading|error|global-error|not-found|default|route)\.[cm]?[jt]sx?$|^(?:src\/)?(?:middleware|instrumentation(?:-client)?)\.[cm]?[jt]sx?$/;

/**
 * Why a file stays where it is at plan time, in one sentence, or null when Import may bring it in (follow-up a):
 * a file Next.js finds by its path (other than a page), or a file LINE-SHARED would refuse inside Line with no typed
 * fix (its own copy of a shared concern, such as an AI route that imports @google/genai).
 * @param {string} rel Project-relative.
 * @param {string} src Its source.
 * @returns {string|null}
 */
export function stayInPlace(rel, src) {
  const base = posix.basename(rel);
  if (FRAMEWORK_FILE.test(rel)) return `${base} stays where it is: Next.js finds it by its path, so it is never moved.`;
  let ast = null;
  try { ast = parseToAst(src); } catch { return null; }
  for (const concern of SHARED_CONCERNS) {
    const hit = findSharedCopies(ast, concern)[0];
    if (hit) return `${base} stays where it is: it ${hit.what}, its own copy of ${concern.concern}, which Line would refuse with no fix it can make (use ${concern.module}).`;
  }
  return null;
}

const pageFeatureOf = (folder, page, family) => (page.startsWith(`${folder}/`) ? (family ?? folderFeature(folder, page)) : null);

/** The questions two rules raise for an item, with the recommended option first. */
function questionsFor(folder, it) {
  if (it.kind === 'pages' || it.pages.length >= 2) return [];
  const qs = [];
  const feature = it.pages.length === 1 ? (pageFeatureOf(folder, it.pages[0], it.family) ?? it.folderFeature) : it.folderFeature;
  if (it.kind === 'components' && GENERIC_UI.includes(it.name)) {
    qs.push({
      id: `generic-name:${it.file}`, file: it.file,
      sentence: `${it.name} sounds like general UI, so it could go to the library, but ${it.pages.length ? 'only one page uses it' : 'no page uses it yet'}; where should it go?`,
      // #887: why the recommended option (the deciding rule) and what each option does.
      hint: `Recommended because ${it.name} is a general UI name, and the library is where every feature can use it (rule generic-name).`,
      options: [
        { id: 'library', sentence: `Put ${it.name} in the library, so every feature can use it.`, effect: `${it.name} becomes library/${it.kind}/${it.name}; the files that import it are pointed at the library copy` },
        { id: `feature:${feature}`, sentence: `Keep ${it.name} in feature ${feature}, where it is used.`, effect: `${it.name} becomes features/${feature}/${it.kind}/${it.name}, based on a library copy` },
      ],
      recommended: 'library',
    });
  } else if (it.pages.length === 1) {
    const pf = pageFeatureOf(folder, it.pages[0], it.family);
    if (pf && pf !== it.folderFeature) {
      qs.push({
        id: `one-page:${it.file}`, file: it.file,
        sentence: `${it.name} sits in the ${it.folderFeature} folder, but only a page of feature ${pf} uses it; which feature should own it?`,
        hint: `Recommended because the only page that uses ${it.name} is in feature ${pf} (rule used-by-pages).`,
        options: [
          { id: `feature:${pf}`, sentence: `Feature ${pf}, where its only page is.`, effect: `${it.name} becomes features/${pf}/${it.kind}/${it.name}, next to the page that uses it` },
          { id: `feature:${it.folderFeature}`, sentence: `Feature ${it.folderFeature}, after its folder.`, effect: `${it.name} becomes features/${it.folderFeature}/${it.kind}/${it.name}, where its folder is` },
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
    } else if (it.pages.length === 1 && pageFeatureOf(folder, it.pages[0], it.family)) {
      it.rules.push('one-page');
      it.target = 'feature';
      it.feature = pageFeatureOf(folder, it.pages[0], it.family);
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
    // A service or domain has no library base: it moves into its feature as it is.
    if (LOGIC_ITEM_KINDS.has(it.kind)) { it.mode = 'move'; continue; }
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
      if (![...(graph.importers.get(it.file) ?? [])].some((u) => libLiving.has(u))) continue;
      // The library may use only the library: a logic item it uses goes there whole; any other item is split.
      if (LOGIC_ITEM_KINDS.has(it.kind)) { it.target = 'library'; it.mode = undefined; } else it.mode = 'split';
      libLiving.add(it.file);
      changed = true;
    }
  }
}

/** Library ids and feature bases, once every item has its final name. */
function finishBases(items) {
  for (const it of items) {
    if (it.target === 'library') { it.libraryId = `${it.kind}/${it.name}`; if (it.kind === 'components') it.level = levelFromSize(it.src); }
    if (it.target === 'feature') it.base = LOGIC_ITEM_KINDS.has(it.kind) ? undefined : it.mode === 'move' ? `components/${it.baseItem.name}` : `${it.kind}/${it.name}`;
  }
}

/** A name for an item, made from its file name: Detail-v2.tsx -> DetailV2 (components, pages), detail-v2.ts -> detailV2. */
function nameFromFile(rel, kind) {
  const words = stripExt(posix.basename(rel)).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  const n = kind === 'components' || kind === 'pages' ? camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
  return /^[A-Za-z]/.test(n) ? n : `${kind === 'components' || kind === 'pages' ? 'Item' : 'item'}${n}`;
}

/** Item names (no extension) already in `<dir>` on disk. */
function namesOnDisk(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => stripExt(e.name)); } catch { return []; }
}

const NAME_OK = { components: PASCAL, pages: PASCAL, workflows: /^[A-Za-z][A-Za-z0-9_-]*$/, services: /^[A-Za-z][A-Za-z0-9_-]*$/, domains: /^[A-Za-z][A-Za-z0-9_-]*$/, fixtures: /^[A-Za-z0-9][A-Za-z0-9_-]*$/ };

/**
 * Name clashes, caught at plan time: two items of the folder that would land at the same place (library/<kind>/<Name>
 * or features/<feature>/<kind>/<Name>), or an item that would land on an item the folder's library or features already
 * hold. The first one (the file named after it, else by path) keeps its name; every other one gets a question whose
 * recommended option is a unique name made from its file name (Detail-v2.tsx -> DetailV2). An answer `name:<Name>`
 * picks another name; it must be a valid, free name. A renamed component or page keeps `exportName` (the name its file
 * exports today), so the step renames the export too.
 * @throws {LineOpError} BAD_NAME when an answer names an invalid or taken name.
 */
function resolveClashes(projectRoot, folder, items, answers) {
  const abs = path.join(projectRoot, folder);
  /** @type {Map<string, {file: string, existing: boolean}>} key -> who holds it */
  const taken = new Map();
  let features = [];
  try { features = fs.readdirSync(path.join(abs, 'features'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { features = []; }
  for (const kind of Object.keys(KIND_ORDER)) {
    for (const n of namesOnDisk(path.join(abs, 'library', kind))) taken.set(`library/${kind}/${n}`, { file: `${folder}/library/${kind}/${n}`, existing: true });
    for (const f of features) for (const n of namesOnDisk(path.join(abs, 'features', f, kind))) taken.set(`features/${f}/${kind}/${n}`, { file: `${folder}/features/${f}/${kind}/${n}`, existing: true });
  }
  const keysOf = (it, name) => [
    ...(it.target === 'library' || it.mode === 'split' ? [`library/${it.kind}/${name}`] : []),
    ...(it.target === 'feature' ? [`features/${it.feature}/${it.kind}/${name}`] : []),
  ];
  const free = (it, name) => keysOf(it, name).every((k) => !taken.has(k));
  // The file named after its item claims the name first; then by path.
  const named = (it) => (stripExt(posix.basename(it.file)) === it.name ? 0 : 1);
  for (const it of [...items].sort((a, b) => named(a) - named(b) || a.file.localeCompare(b.file))) {
    const clash = keysOf(it, it.name).map((k) => taken.get(k)).find(Boolean);
    if (clash) {
      let proposed = nameFromFile(it.file, it.kind);
      for (let n = 2; proposed === it.name || !free(it, proposed); n += 1) proposed = `${nameFromFile(it.file, it.kind)}${n}`;
      const other = posix.basename(clash.file);
      const mine = posix.basename(it.file);
      const q = {
        id: `name-clash:${it.file}`, file: it.file,
        sentence: clash.existing
          ? `${mine} brings ${it.name}, but the folder already has ${it.name} (${other}); what should the new one be called?`
          : `${mine} and ${other} both bring ${it.name}, and Line can hold only one ${SINGULAR[it.kind]} called ${it.name} there; what should the one from ${mine} be called?`,
        hint: `Recommended because ${proposed} comes from its own file name, ${mine}, and no other item has it (rule name-clash).`,
        options: [{ id: `name:${proposed}`, sentence: `Call it ${proposed}, after its file ${mine}.`, effect: `the ${SINGULAR[it.kind]} from ${mine} is called ${proposed}, and its users are pointed at that name` }],
        recommended: `name:${proposed}`,
      };
      const answer = answers?.[q.id];
      let chosen = proposed;
      if (answer !== undefined && answer !== q.recommended) {
        const n = String(answer).startsWith('name:') ? String(answer).slice('name:'.length) : '';
        if (!NAME_OK[it.kind].test(n)) throw new LineOpError(`"${n}" cannot be the name of the ${SINGULAR[it.kind]} from ${mine}; use ${it.kind === 'components' || it.kind === 'pages' ? 'a capitalised name of letters and digits' : 'letters and digits'}, such as ${proposed}.`, 'BAD_NAME');
        if (!free(it, n)) throw new LineOpError(`${n} is taken too, so it cannot be the name of the ${SINGULAR[it.kind]} from ${mine}; pick a free name such as ${proposed}.`, 'BAD_NAME');
        chosen = n;
      }
      it.questions.push(q);
      it.rules.push('name-clash');
      it.clash = { with: clash.file, was: it.name, answered: answer !== undefined };
      const holder = items.find((x) => x.file === clash.file);
      if (holder) (holder.renamedOthers ??= []).push({ file: it.file, name: chosen });
      it.name = chosen;
    }
    for (const k of keysOf(it, it.name)) taken.set(k, { file: it.file, existing: false });
  }
}

/** What a name clash did to an item, for its sentences: '' when none. `files` names the files (plan steps do). */
function clashNote(it, files) {
  const own = (f) => (files ? posix.basename(f) : stripExt(posix.basename(f)));
  const pick = it.clash && !it.clash.answered ? '; you can pick another name' : '';
  if (it.clash && files) return ` ${own(it.clash.with)} also brings ${it.clash.was}, so this one is renamed${pick}.`;
  if (it.clash) return ` It is called ${it.name}, because ${own(it.clash.with)} also brings ${it.clash.was}${pick}.`;
  if (it.renamedOthers?.length) return ` ${it.renamedOthers.map((o) => `The ${it.name} from ${own(o.file)} becomes ${o.name}`).join('. ')}.`;
  return '';
}

function proposalSentence(it) {
  return proposalBase(it) + clashNote(it, false);
}

function proposalBase(it) {
  const used = it.pages.length >= 2 ? `${it.pages.length} pages use it` : it.pages.length === 1 ? 'only one page uses it' : 'no page uses it';
  if (it.target === 'library') {
    const lvl = it.level ? ` as ${it.level === 'atom' ? 'an' : 'a'} ${it.level}` : '';
    const why = it.rules.includes('used-by-pages') ? `, because ${used}` : it.rules.includes('answer') ? (it.answered ? ', as you chose' : ' unless you choose otherwise') : '';
    return `${it.name} goes to the library${lvl}${why}.`;
  }
  const route = it.route ? `, served at ${it.route}` : '';
  if (it.mode === 'move' && !it.baseItem) return `${it.name} goes to feature ${it.feature} as a ${SINGULAR[it.kind]}${route}.`;
  if (it.mode === 'move') return `${it.name} goes to feature ${it.feature}, based on the library ${it.baseItem.name} that it renders${route}.`;
  return `${it.name} goes to feature ${it.feature}${route}; its full code goes to the library and the feature gets a ${SINGULAR[it.kind]} based on it.`;
}

/**
 * What to import: a folder (a string, or {folder}), or a route family ({route}, optionally with the folder it lands in).
 * @param {string} projectRoot
 * @param {string | {folder?: string, route?: string|string[], feature?: string}} target `route`: one route or several
 *   routes that make one feature; `feature` the feature's name (default the first route's family name).
 * @returns {{folder: string, route?: string|string[], family?: string, only?: Set<string>}}
 */
function importTarget(projectRoot, target) {
  if (typeof target === 'string') return { folder: checkFolder(projectRoot, target) };
  const t = /** @type {any} */ (target ?? {});
  if ((typeof t.route === 'string' && t.route) || (Array.isArray(t.route) && t.route.length)) {
    const closure = readRouteFamily(projectRoot, t.route, t.feature ? { feature: t.feature } : {});
    const folder = t.folder ? checkFolder(projectRoot, t.folder) : commonFolder(closure.files);
    if (!folder) throw new LineOpError(`The files of ${routeLabel(t.route)} sit directly in the project root, so name the folder to import them into, such as src.`, 'BAD_FOLDER');
    return { folder, route: t.route, family: closure.feature ?? familyFeature(String([t.route].flat()[0])), only: new Set(closure.files.filter((f) => f.startsWith(`${folder}/`))) };
  }
  if (typeof t.folder === 'string') return { folder: checkFolder(projectRoot, t.folder) };
  throw new LineOpError('Name a folder or a route to import, such as src/alerts or /alerts.', 'BAD_FOLDER');
}

/** Scan and decide (with `answers`, recommended where none). */
function decide(projectRoot, target, answers) {
  const t = importTarget(projectRoot, target);
  const folder = t.folder;
  const { items, unchanged, routes, graph } = readFolder(projectRoot, folder, { only: t.only, family: t.family });
  decideTargets(folder, items, answers);
  decideBases(folder, items, graph);
  resolveClashes(projectRoot, folder, items, answers);
  finishBases(items);
  return { folder, items, unchanged, routes, ...(t.route ? { route: t.route } : {}) };
}

/**
 * Scan one folder of the open project: what it holds and what Line proposes for each item (pure read, no model).
 * @param {string} projectRoot The open project (absolute).
 * @param {string | {folder?: string, route?: string|string[], feature?: string}} folder Project-relative folder, or (Import v2) a route family {route, folder?, feature?} (route: one route or several that make one feature).
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
    ...(d.route ? { route: d.route } : {}),
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
 * @param {string | {folder?: string, route?: string|string[], feature?: string}} folder A folder, or (Import v2) a route family {route, folder?, feature?} (route: one route or several that make one feature).
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
  // Folders whose files stay where they are (hooks, types): listed as line.appFolders so LINE-LAYOUT does not report them.
  const appFolders = [...new Set(d.unchanged.map((u) => local(u.file)).filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].sort();
  add('line.import.mark', { features, ...(appFolders.length ? { appFolders } : {}) }, `Marks ${f} as a Line folder, with a library and ${features.length === 1 ? `the feature ${features[0]}` : `the features ${features.join(', ')}`}${features.length ? '' : ' no features'}.`, 'mark');
  // A Next.js app-router file (page.tsx, layout.tsx, route.ts, ...) is found by its path, not imported: it keeps a
  // one-line link at its old path, or the route it serves is gone.
  const keepShim = (it) => it.outsideUsers.length > 0 || servedByPath(it.file);
  const shimNote = (it) => {
    if (it.outsideUsers.length) return ` Its old file stays as a one-line link, because ${it.outsideUsers.length === 1 ? posix.basename(it.outsideUsers[0]) : `${it.outsideUsers.length} files`} outside the folder use${it.outsideUsers.length === 1 ? 's' : ''} it.`;
    return servedByPath(it.file) ? ` Its old file stays as a one-line link, because Next.js serves ${appRoute(it.file) ?? 'a route'} from it.` : '';
  };
  // A renamed component or page renames its export too (exportName: the name its file exports today).
  const rename = (it) => (it.clash && it.exportName && it.exportName !== it.name ? { exportName: it.exportName } : {});
  // Where two items clash, the step names both files.
  const what = (it) => (it.clash || it.renamedOthers?.length ? `${it.clash ? it.clash.was : it.name} from ${posix.basename(it.file)}` : it.name);
  const as = (it) => (it.clash ? ` as ${it.name}` : '');
  for (const it of items.filter((i) => i.target === 'library' || i.mode === 'split')) {
    const lvl = it.target === 'library' && it.level ? it.level : undefined;
    add('line.import.toLibrary', { from: local(it.file), kind: it.kind, name: it.name, ...rename(it), ...(lvl ? { level: lvl } : {}), keepShim: keepShim(it) },
      `Moves ${what(it)} into the library${as(it)}${lvl ? ` as ${lvl === 'atom' ? 'an' : 'a'} ${lvl}` : ''} and points its users at it.${clashNote(it, true)}${shimNote(it)}`, `lib-${it.name}`);
  }
  for (const it of items.filter((i) => i.mode === 'move')) {
    add('line.import.toFeature', { mode: 'move', from: local(it.file), kind: it.kind, name: it.name, ...rename(it), feature: it.feature, ...(it.base ? { base: it.base } : {}), keepShim: keepShim(it), ...(it.route ? { route: it.route } : {}) },
      `Moves ${what(it)} into feature ${it.feature}${as(it)}${it.baseItem ? `, based on the library ${it.baseItem.name}` : ` as a ${SINGULAR[it.kind]}`}.${clashNote(it, true)}${shimNote(it)}`, `feature-${it.name}`);
  }
  for (const it of items.filter((i) => i.mode === 'split')) {
    const entry = it.kind === 'pages' && servedByPath(it.file) ? local(it.file) : null;
    add('line.import.toFeature', { mode: 'wrap', kind: it.kind, name: it.name, feature: it.feature, base: it.base, ...(it.route ? { route: it.route } : {}), ...(entry ? { entry } : {}) },
      `Adds ${it.name} to feature ${it.feature}, based on the library ${it.name}${it.route ? `, serving ${it.route}` : ''}.${it.clash ? ` It is ${it.clash.was} from ${posix.basename(it.file)}, renamed because ${posix.basename(it.clash.with)} also brings ${it.clash.was}.` : ''}${entry ? ` ${posix.basename(entry)} stays at its path and serves the feature's ${it.name}.` : ''}`, `feature-${it.name}`);
  }
  const lib = items.filter((i) => i.target === 'library').length;
  const feat = items.length - lib;
  const of = d.route ? `the route${Array.isArray(d.route) && d.route.length > 1 ? 's' : ''} ${routeLabel(d.route)}` : f;
  const summary = items.length
    ? `Brings ${items.length} item${items.length === 1 ? '' : 's'} of ${of} into Line in ${steps.length} steps: ${lib} to the library and ${feat} to ${features.length === 1 ? `feature ${features[0]}` : `${features.length} features`}; nothing outside ${f} changes.`
    : `There is nothing in ${f} for Line to bring in.`;
  return { folder: f, ...(d.route ? { route: d.route } : {}), summary, steps: items.length ? steps : [] };
}

// ---------------------------------------------------------------------------------------------
// Steps (plan-ready tools): each returns a StagedChange relative to the folder.

/** A re-export left at an old path so code outside the folder keeps working (under its old name when it was renamed). */
function shimSource(oldRel, newRel, src, renamed) {
  if (posix.extname(oldRel) === '.json') return src;
  let spec = posix.relative(posix.dirname(oldRel), stripExt(newRel));
  if (!spec.startsWith('.')) spec = `./${spec}`;
  const def = /export\s+default\b|export\s*\{[^}]*\bas\s+default\b/.test(src) ? `export { default } from '${spec}';\n` : '';
  // Only a named export needs its old name back; a default export keeps working through `default`.
  const named = renamed && (new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${renamed.to}\\b`).test(src)
    || new RegExp(`export\\s*\\{[^}]*\\b${renamed.to}\\b(?!\\s+as\\s+default)[^}]*\\}`).test(src));
  const old = named ? `export { ${renamed.to} as ${renamed.from} } from '${spec}';\n` : '';
  return `// Moved into Line: ${newRel}. This file stays so code outside this folder keeps working.\nexport * from '${spec}';\n${old}${def}`;
}

/** Put the shim in place of the old file's delete. */
function withShim(change, from, to, keepShim, renamed) {
  if (!keepShim) return change;
  const original = change.files.find((x) => x.path === to)?.content ?? '';
  // A file Next.js finds by its path keeps a route entry: only the default export, re-exported (LINE-OWNER reads it).
  const content = servedByPath(from) && /export\s+default\b|export\s*\{[^}]*\bas\s+default\b/.test(original) ? routeEntrySource(from, to) : shimSource(from, to, original, renamed);
  return { ...change, files: change.files.map((x) => (x.path === from && x.content === null ? { path: from, content } : x)) };
}

/** A Next.js route entry at `entryRel` that serves `pageRel`: one re-export of its default (or of `name` as default). */
function routeEntrySource(entryRel, pageRel, name) {
  let spec = posix.relative(posix.dirname(entryRel), stripExt(pageRel));
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return `// Next.js serves this route from here; the page lives in Line: ${pageRel}.\nexport { ${name ? `${name} as default` : 'default'} } from '${spec}';\n`;
}

/** Where an identifier is a name, not a reference to the binding (a member property, an object or class key, a JSX attribute). */
function isNameOnly(node, parent, key) {
  if (!parent) return false;
  if ((parent.type === 'MemberExpression' || parent.type === 'JSXMemberExpression') && key === 'property' && !parent.computed) return true;
  if (['MethodDefinition', 'PropertyDefinition', 'TSPropertySignature', 'TSMethodSignature'].includes(parent.type) && key === 'key' && !parent.computed) return true;
  if (parent.type === 'JSXAttribute' && key === 'name') return true;
  if (parent.type === 'TSQualifiedName' && key === 'right') return true;
  return false;
}

/**
 * Rename the binding `from` to `to` in one module's source (its declaration and every reference to it), by AST ranges.
 * An object shorthand `{ from }` keeps its key (`{ from: to }`). Null when the source cannot be parsed.
 */
function renameBinding(src, from, to) {
  let ast;
  try { ast = parseToAst(src); } catch { return null; }
  /** @type {Map<number, {end: number, text: string}>} */
  const edits = new Map();
  walkAst(ast, {
    enter(/** @type {any} */ n, /** @type {any} */ parent, /** @type {any} */ key) {
      if ((n.type !== 'Identifier' && n.type !== 'JSXIdentifier') || n.name !== from || !n.range) return;
      if (isNameOnly(n, parent, key)) return;
      if (parent?.type === 'Property' && key === 'key' && !parent.computed) {
        if (parent.shorthand) edits.set(n.range[0], { end: n.range[1], text: `${from}: ${to}` });
        return;
      }
      if (parent?.type === 'Property' && key === 'value' && parent.shorthand) return; // the key above wrote both
      if (!edits.has(n.range[0])) edits.set(n.range[0], { end: n.range[1], text: to });
    },
  });
  let out = src;
  for (const [start, e] of [...edits].sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + e.text + out.slice(e.end);
  return out;
}

/** In a user's source, imports and re-exports of the moved module (its file name is now `base`) take `to` instead of `from`, under the old local name. */
function renameImports(src, base, from, to) {
  const fromModule = (spec) => stripExt(posix.basename(spec)) === base || posix.basename(spec) === base;
  const names = (list) => list.split(',').map((part) => {
    const m = part.match(/^(\s*)(type\s+)?([A-Za-z_$][\w$]*)(\s+as\s+[A-Za-z_$][\w$]*)?(\s*)$/);
    if (!m || m[3] !== from) return part;
    return `${m[1]}${m[2] ?? ''}${to}${m[4] ?? ` as ${from}`}${m[5]}`;
  }).join(',');
  return src
    .replace(/(\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{)([^}]*)(\}\s*from\s*(['"])([^'"]+)\4)/g, (all, head, list, tail, _q, spec) => (fromModule(spec) ? `${head}${names(list)}${tail}` : all))
    .replace(/(\bexport\s+(?:type\s+)?\{)([^}]*)(\}\s*from\s*(['"])([^'"]+)\4)/g, (all, head, list, tail, _q, spec) => (fromModule(spec) ? `${head}${names(list)}${tail}` : all));
}

/**
 * A move whose item gets a new name (a name clash at plan time): the moved file's export `exportName` becomes `name`,
 * and every user the move already re-points imports it under the new name, keeping its own local name.
 */
function withRename(change, to, exportName, name) {
  if (!exportName || exportName === name) return change;
  return {
    ...change,
    files: change.files.map((x) => {
      if (x.content === null || posix.extname(x.path) === '.json') return x;
      if (x.path === to) {
        const renamed = renameBinding(x.content, exportName, name);
        if (renamed === null) throw new LineOpError(`${posix.basename(to)} could not be read as code, so ${exportName} cannot be renamed to ${name}; fix the file or pick its old name.`, 'BAD_NAME');
        return { ...x, content: renamed };
      }
      return { ...x, content: renameImports(x.content, name, exportName, name) };
    }),
  };
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
  const entry = { path: moved, rules, reason: `Imported from ${from}; Line brings it to the pattern step by step.` };
  // In place, so the person's comments and key order stay, and the entry lands in `exceptions:` wherever that key sits.
  const content = editYamlDocument(yml, [{ op: 'push', path: ['exceptions'], value: entry, inlineLists: true }], { label: 'architecture.yml' });
  return { ...change, files: [...change.files.filter((x) => x.path !== 'architecture.yml'), { path: 'architecture.yml', content }] };
}

const libPath = (args) =>`library/${args.kind}/${args.name}${posix.extname(String(args.from))}`;

/** Every tool an import step can name; each is (folderRoot, args) -> StagedChange. */
export const IMPORT_STEP_TOOLS = Object.freeze({
  'line.import.mark': (root, { folder, features = [], appFolders = [] }) => {
    const files = [];
    const keep = appFolders.length ? `line:\n  # Folders Import left in place (hooks, types): not Line items yet.\n  appFolders:\n${appFolders.map((a) => `    - ${a}\n`).join('')}` : '';
    if (!fs.existsSync(path.join(root, 'architecture.yml'))) files.push({ path: 'architecture.yml', content: `# ${folder} was brought into Line by Import; the rest of the project is not a Line project.\nversion: 1\npreset: line\n${keep}` });
    if (!fs.existsSync(path.join(root, 'library'))) files.push(...planCreateLayout(root).files);
    for (const name of features) {
      if (!fs.existsSync(path.join(root, 'features', name, 'spec.md'))) files.push({ path: `features/${name}/spec.md`, content: `# ${name}\n\nBrought into Line from ${folder} by Import. Write what this feature does here.\n` });
    }
    if (!files.length) throw new LineOpError(`${folder} is already marked as a Line folder.`, 'NAME_TAKEN');
    return { summary: `Marks ${folder} as a Line folder.`, files };
  },
  'line.import.toLibrary': (root, { from, kind, name, exportName, level, keepShim }) => {
    const to = libPath({ from, kind, name });
    const renamed = exportName && exportName !== name ? { from: exportName, to: name } : null;
    let change = withRename(planMoveFile(root, { from, to }), to, exportName, name);
    if (level) change = { ...change, files: change.files.map((x) => (x.path === to ? { ...x, content: `// @line-level ${level}\n${x.content}` } : x)) };
    change = withCarriedExceptions(root, withShim(change, from, to, keepShim, renamed), to, from);
    return { ...change, summary: `Moves ${name} into the library.` };
  },
  'line.import.toFeature': (root, { mode, from, kind, name, exportName, feature, base, route, keepShim, entry }) => {
    const addRoute = (c, p) => (route && kind === 'pages' ? { ...c, files: c.files.map((x) => (x.path === p ? { ...x, content: x.content.replace(/^(\/\/ @line-base [^\n]*\n)/, `$1// @line-route ${route}\n`) } : x)) } : c);
    if (mode === 'move') {
      const to = `features/${feature}/${kind}/${name}${posix.extname(String(from))}`;
      const renamed = exportName && exportName !== name ? { from: exportName, to: name } : null;
      const moved = withRename(planMoveFile(root, { from, to, base }), to, exportName, name);
      const change = withCarriedExceptions(root, addRoute(withShim(moved, from, to, keepShim, renamed), to), to, from);
      return { ...change, summary: `Moves ${name} into feature ${feature}.` };
    }
    const change = planBaseOn(root, { libraryId: base, feature, name });
    const page = change.files[0].path;
    // A split page.tsx: its path stays a route entry, now serving the feature's page (which renders the library one).
    const withEntry = entry && fs.existsSync(path.join(root, entry)) ? { ...change, files: [...change.files, { path: entry, content: routeEntrySource(entry, page, name) }] } : change;
    return { ...addRoute(withEntry, page), summary: `Adds ${name} to feature ${feature}, based on the library ${name}.` };
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
 * A scratch copy of the import folder to chain the steps in: `<tmp>/<folder>` (every file of the folder, without
 * node_modules, .next, .git or a nested checkout), with each architecture.yml from the project root down to the folder
 * copied to the same place (so frozen globs and the project's root resolve as they do on the real folder), and a .git
 * marker at the top so nothing above the copy is read. Returns its folder root and a cleanup.
 */
function scratchFolder(projectRoot, folder) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), `construct-import-${process.pid}-`));
  fs.mkdirSync(path.join(top, '.git'));
  const parts = folder.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    const rel = parts.slice(0, i).join('/');
    // architecture.yml (frozen globs, the root), and tsconfig.json (its `paths` aliases, so a move re-points `@/…` imports)
    for (const name of ['architecture.yml', 'tsconfig.json']) {
      const file = path.join(projectRoot, rel, name);
      if (fs.existsSync(file)) { fs.mkdirSync(path.join(top, rel), { recursive: true }); fs.copyFileSync(file, path.join(top, rel, name)); }
    }
  }
  const src = path.join(projectRoot, folder);
  const dest = path.join(top, folder);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !WALK_SKIP_DIRS.has(path.basename(p)) && (p === src || !isGitCheckout(p)) });
  return { root: dest, cleanup: () => { try { fs.rmSync(top, { recursive: true, force: true }); } catch { /* left in tmp */ } } };
}

/**
 * Plan and apply the whole import as ONE change. Every step is planned and landed through applyChange in a scratch copy
 * of the folder, so each step sees the ones before it and is checked on its own; when every step landed there, the net
 * result (what the folder's files are now in the copy) goes to the real folder in one applyChange, one transaction of
 * Construct's writer, with the folder as its root. So it is all-or-nothing: when any step, or the final commit, is
 * refused, nothing is written and the folder stays byte-identical; nothing outside the folder can be written.
 * @param {string} projectRoot
 * @param {string | {folder?: string, route?: string|string[], feature?: string}} folder A folder, or (Import v2) a route family {route, folder?, feature?} (route: one route or several that make one feature).
 * @param {Record<string, string>} [answers]
 * @returns {import('./contract.mjs').ImportApplyResult}
 */
export function applyImport(projectRoot, folder, answers = {}) {
  const plan = planImport(projectRoot, folder, answers);
  const root = path.join(projectRoot, plan.folder);
  const steps = [];
  const prefix = (p) => `${plan.folder}/${p}`;
  const lower = (t) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  const stopped = (step, why, findings = []) => ({
    ok: false,
    sentence: `Nothing was saved: Line stopped at "${step.sentence.split(/(?<=[.?!])\s/)[0].replace(/[.?!]$/, '')}", because ${lower(why.replace(/^Nothing (was|would be) saved: /, ''))}`,
    files: [], findings, steps, .../** @type {any} */ ({ landed: [] }),
  });
  if (!plan.steps.length) return { ok: false, sentence: `Nothing was saved: there is nothing in ${plan.folder} for Line to bring in.`, files: [], findings: [], steps };
  const scratch = scratchFolder(projectRoot, plan.folder);
  try {
    const touched = new Set();
    for (const step of plan.steps) {
      let change;
      try {
        change = planImportStep(scratch.root, step);
      } catch (e) {
        const why = e instanceof LineOpError || /** @type {any} */ (e)?.name === 'LineOpError' ? /** @type {any} */ (e).sentence : 'Line could not plan this step.';
        steps.push({ id: step.id, ok: false, sentence: `Not done: ${lower(why)}` });
        return stopped(step, why);
      }
      const outside = change.files.find((x) => x.path.startsWith('/') || x.path.split('/').includes('..'));
      if (outside) {
        steps.push({ id: step.id, ok: false, sentence: `Not done: Line writes only inside ${plan.folder}, and this step would write ${outside.path}.` });
        return stopped(step, `Line writes only inside ${plan.folder}, and this step would write ${outside.path}.`);
      }
      const r = applyChange(scratch.root, change);
      steps.push({ id: step.id, ok: r.ok, sentence: r.ok ? step.sentence : r.sentence });
      if (!r.ok) return stopped(step, r.sentence, r.findings.map((x) => ({ ...x, file: x.file === '.' ? plan.folder : prefix(x.file) })));
      for (const f of r.files) touched.add(f);
    }
    // The net change: each touched file as it is in the copy now (null where a step removed it), unless it ends as it began.
    const files = [];
    for (const rel of [...touched].sort()) {
      const after = path.join(scratch.root, rel);
      const before = path.join(root, rel);
      const now = fs.existsSync(after) ? fs.readFileSync(after) : null;
      const was = fs.existsSync(before) ? fs.readFileSync(before) : null;
      if (now === null ? was === null : was !== null && now.equals(was)) continue;
      files.push({ path: rel, content: now === null ? null : now.toString('utf8') });
    }
    if (!files.length) return { ok: true, sentence: `Nothing to save: ${plan.folder} is already as the import would leave it.`, files: [], findings: [], steps };
    const r = applyChange(root, { summary: plan.summary, files }, { acceptedIn: scratch.root });
    if (!r.ok) {
      return { ok: false, sentence: `Nothing was saved: every step passed on its own, but the import as a whole was refused: ${lower(r.sentence.replace(/^Nothing was saved: /, ''))}`, files: [], findings: r.findings.map((x) => ({ ...x, file: x.file === '.' ? plan.folder : prefix(x.file) })), steps, .../** @type {any} */ ({ landed: [] }) };
    }
    return { ok: true, sentence: `Saved. ${plan.summary}`, files: r.files.map(prefix), findings: [], steps };
  } finally {
    scratch.cleanup();
  }
}
