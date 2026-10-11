// Line Import v2 -- the import loop's ops on a real project (importLoop.mjs LoopOps), so the Import agent maps,
// characterizes and checks every step on disk. Three of them are STAND-INS for pieces other branches own; each keeps the
// contract's shape (docs/line/import-v2/CONTRACT.md) and is swapped at merge:
//
//   readRouteFamily(root, route)    -> RouteClosure   [iv2-fit]  core route-resolver (Next.js app/ or the react-router
//                                       table in src/App.tsx), excludes [] (DEFAULT_TRACE_EXCLUDES is one app's list)
//   buildLogicMap(root, files)      -> LogicMap       [iv2-map]  the prototype's unit kinds on @construct/ast's ESTree
//   characterize(root, closure, map)-> CharTest[]     [iv2-tests] the app's existing tests that import the route's files
//                                       (iv2-tests writes new ones: one per branch / handler group)
//
// Everything else is the loop's own: the tests run in the app's own runner (importVerify.mjs runCharTests), the
// behaviour check is core check-change's path-mapped variant (importVerify.mjs checkBehaviour), the baseline map and
// sources are written through Construct's transactional writer inside the folder (<folder>/line/logic-map.json,
// <folder>/line/import-baseline.json), and each step's ImportLoopState is appended to the plan records, slotted
// (records.mjs createImportLoopRecorder).
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError } from './contract.mjs';
import { createTransaction } from '../transactionalWriter.mjs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { readPathAliases, resolveImportSpecifier, traceRouteFiles, resolveUrlToFolder, findRouteEntryFile, parseReactSpaRoutes } from '@line/construct-core/route-resolver';
import { parseToAst } from '@construct/ast';
import { folderRootOf } from './importTools.mjs';
import { unitFingerprint, compareLogicMaps, mapSummary } from './importLoopStandIns.mjs';
import { runCharTests, checkBehaviour, testRunnerOf } from './importVerify.mjs';
import { createImportLoopRecorder } from './records.mjs';

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'line']);
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };

/**
 * Write one file under `<folder>/` through Construct's transactional writer with the folder as root; the writer's check
 * refuses it only when it adds a problem for that one file (the "only new problems" rule of applyChange).
 * @param {string} root
 * @param {string} folder
 * @param {string} rel Folder-relative path, such as line/import-plan.json.
 * @param {string} content
 * @returns {void}
 */
export function writeFolderFile(root, folder, rel, content) {
  const fr = folderRootOf(root, folder);
  const key = (v) => `${v.rule}\u0000${v.file}\u0000${v.message}`;
  const txn = createTransaction(fr);
  try {
    txn.writeFile(rel, content);
    const r = txn.commit({
      validate: (shadow) => {
        const files = [rel];
        const before = new Set(aggregateValidation(fr, enforcersForRoot(fr), { files }).violations.map(key));
        const added = aggregateValidation(shadow, enforcersForRoot(shadow), { files }).violations.filter((v) => !before.has(key(v)));
        return { violations: added, ok: !added.some((v) => v.severity === 'error') };
      },
    });
    if (!r.committed) throw new LineOpError(`${rel} could not be saved: ${lower(asSentence(r.violations.find((v) => v.severity === 'error')?.message ?? 'the checks refused it'))}`, 'NOT_SAVED');
  } catch (e) {
    txn.reset();
    if (/** @type {any} */ (e)?.name === 'LineOpError') throw e;
    throw new LineOpError(`${rel} could not be saved on disk.`, 'NOT_SAVED', String(/** @type {any} */ (e)?.message ?? e));
  }
}

/**
 * The code files of a folder (project-relative), without tests, stories, declarations and Line's own state.
 * @param {string} root
 * @param {string} folder
 * @returns {string[]}
 */
export function folderCodeFiles(root, folder) {
  const out = [];
  const visit = (abs, top) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.') || (SKIP_DIRS.has(e.name) && (e.name !== 'line' || top))) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) visit(p, false);
      else if (CODE.test(e.name) && !TEST.test(e.name) && !e.name.endsWith('.d.ts')) out.push(toRel(root, p));
    }
  };
  const abs = path.join(root, folder);
  if (fs.existsSync(abs)) visit(abs, true);
  return out.sort();
}

// ------------------------------------------------------------------------------------------------- read [iv2-fit]
/**
 * RouteClosure of a route and its sub-routes (a route family: `/opportunity` and `/opportunity/*`): every file the
 * route's entries import, traced with no excludes. Next.js App Router (`app/` or `src/app/`) or a react-router table
 * (`src/App.tsx`). Stand-in for iv2-fit's readRouteFamily.
 * @param {string} root
 * @param {string} route A URL path such as /alerts.
 * @returns {{appRoot: string, routes: {route: string, entry: string}[], files: string[], external: string[]}}
 */
export function readRouteFamily(root, route) {
  if (typeof route !== 'string' || !route.startsWith('/')) throw new LineOpError(`"${route}" is not a route; a route starts with /, like /alerts.`, 'BAD_ROUTE');
  const { aliases } = readPathAliases(root);
  const entries = [];
  const appDir = ['src/app', 'app'].map((d) => path.join(root, d)).find((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
  if (appDir) {
    let folder;
    try { folder = resolveUrlToFolder(appDir, route); } catch { throw new LineOpError(`The app has no route ${route}.`, 'UNKNOWN_ROUTE'); }
    const visit = (dir, url) => {
      try { entries.push({ route: url, entry: findRouteEntryFile(dir) }); } catch { /* a folder without a page */ }
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) visit(path.join(dir, e.name), /^\(.*\)$/.test(e.name) ? url : `${url}/${e.name}`);
    };
    visit(folder, route);
  } else {
    const table = ['src/App.tsx', 'src/App.jsx'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
    if (!table) throw new LineOpError(`Line found no route table (app/ or src/App.tsx) to read ${route} from.`, 'UNKNOWN_ROUTE');
    const source = fs.readFileSync(table, 'utf8');
    const imports = new Map();
    for (const m of source.matchAll(/import\s+(?:(\w+)|\{([^}]*)\})(?:\s*,\s*\{([^}]*)\})?\s+from\s+['"]([^'"]+)['"]/g)) {
      const names = [m[1], ...(m[2] ?? '').split(','), ...(m[3] ?? '').split(',')].filter(Boolean).map((n) => n.trim().split(/\s+as\s+/).pop());
      for (const n of names) imports.set(n, m[4]);
    }
    for (const r of parseReactSpaRoutes(source)) {
      if (r.path !== route && !r.path.startsWith(`${route}/`)) continue;
      const spec = imports.get(r.component);
      const file = spec ? resolveImportSpecifier(table, spec, aliases) : null;
      if (file) entries.push({ route: r.path, entry: file });
    }
    if (!entries.length) throw new LineOpError(`The app has no route ${route}.`, 'UNKNOWN_ROUTE');
  }
  const files = new Set();
  const external = new Set();
  for (const e of entries) {
    for (const f of traceRouteFiles(e.entry, { aliases, excludes: [] })) files.add(toRel(root, f));
    for (const f of files) {
      for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) if (!resolveImportSpecifier(path.join(root, f), m[1], aliases)) external.add(m[1].split('/').slice(0, m[1].startsWith('@') ? 2 : 1).join('/'));
    }
  }
  return { appRoot: root, routes: entries.map((e) => ({ route: e.route, entry: toRel(root, e.entry) })), files: [...files].filter((f) => CODE.test(f)).sort(), external: [...external].sort() };
}

// ------------------------------------------------------------------------------------------------- map [iv2-map]
/** @type {[RegExp, string][]} */
const CALLS = [
  [/^use(State|Reducer)$/, 'state'], [/^use(Effect|LayoutEffect)$/, 'effect'], [/^use(Memo|Callback)$/, 'derived'], [/^use\w+(Query|Mutation)$/, 'data'],
  [/router\.(push|replace|back|refresh)|^navigate$|URLSearchParams/, 'navigation'], [/searchParams\.get|params\.get/, 'url-read'],
  [/(analyticsService|matomo|track)/, 'analytics'], [/maxToast|toast/i, 'toast'], [/localStorage|sessionStorage/, 'storage'], [/^(fetch|axios)(\.|$)/, 'io'],
];
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The logic units of one file (the prototype's kinds, docs/line/import-v2/logicmap.mjs). */
function unitsOfFile(rel, source) {
  let ast;
  try { ast = parseToAst(source); } catch { return []; }
  const text = (n) => source.slice(n.range[0], n.range[1]);
  const lineOf = (n) => source.slice(0, n.range[0]).split('\n').length;
  const units = []; const ids = {}; const same = {};
  const stack = [];
  const fnName = (n, parent) => {
    if (n.id?.name) return n.id.name;
    if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
    if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition') && parent.key?.name) return parent.key.name;
    if (parent?.type === 'JSXExpressionContainer' && stack.at(-1)?.node?.type === 'JSXAttribute') return `on:${stack.at(-1).node.name.name}`;
    return '<anon>';
  };
  const add = (kind, node, detail, basis = detail, own = null) => {
    const fn = own ?? [...stack].reverse().find((s) => s.fn && s.fn !== '<anon>')?.fn ?? '<module>';
    const k = `${fn}:${kind}`; ids[k] = (ids[k] ?? 0) + 1;
    const norm = String(basis).replace(/\s+/g, ' ').trim();
    const sk = `${kind}\u0000${fn}\u0000${norm}`; same[sk] = (same[sk] ?? 0) + 1;
    units.push({ id: `${rel}#${k}:${ids[k]}`, fingerprint: unitFingerprint(kind, fn, norm, same[sk]), kind, file: rel, fn, line: lineOf(node), detail: String(detail).replace(/\s+/g, ' ').slice(0, 140) });
  };
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    const fn = FN_TYPES.has(node.type) ? fnName(node, parent) : null;
    stack.push({ node, fn });
    if (node.type === 'IfStatement') add('branch', node, `if (${text(node.test)})`);
    else if (node.type === 'ConditionalExpression') add('branch', node, `${text(node.test)} ? …`);
    else if (node.type === 'SwitchCase') add('branch', node, node.test ? `case ${text(node.test)}` : 'default');
    else if (node.type === 'LogicalExpression' && parent?.type === 'JSXExpressionContainer') add('render-if', node, text(node.left));
    else if (node.type === 'CallExpression') {
      const callee = text(node.callee);
      const arg0 = node.arguments[0] ? text(node.arguments[0]) : '';
      const hit = CALLS.find(([re]) => re.test(callee));
      if (hit) {
        const name = parent?.type === 'VariableDeclarator' ? `${text(parent.id)} = ` : '';
        add(hit[1], node, hit[1] === 'effect' || hit[1] === 'derived' ? `deps ${node.arguments[1] ? text(node.arguments[1]) : 'none'}` : `${name}${callee}(${arg0.slice(0, 80)})`, `${name}${callee}(${arg0})${hit[1] === 'effect' || hit[1] === 'derived' ? ` ${node.arguments[1] ? text(node.arguments[1]) : ''}` : ''}`);
      }
    } else if (node.type === 'JSXAttribute' && /^on[A-Z]/.test(node.name?.name ?? '') && node.value) add('handler', node, `${node.name.name}=${text(node.value).slice(0, 80)}`, `${node.name.name}=${text(node.value)}`);
    else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const d = node.declaration;
      if (d.type === 'FunctionDeclaration') add('export', node, `function ${d.id?.name}`, undefined, d.id?.name ?? null);
      else if (d.type === 'VariableDeclaration') { const names = d.declarations.map((x) => text(x.id)).join(','); add('export', node, names, undefined, names); }
    } else if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      const name = d?.type === 'Identifier' ? d.name : d?.id?.name ?? 'default';
      add('export', node, d?.type === 'FunctionDeclaration' ? `default function ${name}` : `default ${name}`, undefined, name);
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'range' || key === 'loc') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => visit(c, node));
      else if (v && typeof v.type === 'string') visit(v, node);
    }
    stack.pop();
  };
  visit(ast, null);
  return units;
}

/**
 * LogicMap of a list of project files: every decision, effect, data call, navigation, handler and export, each with a
 * fingerprint that survives a move. Stand-in for iv2-map's buildLogicMap.
 * @param {string} root
 * @param {string[]} files Project-relative.
 * @returns {{root: string, files: string[], units: any[], counts: Record<string, number>}}
 */
export function buildLogicMap(root, files) {
  const list = [...new Set(files)].filter((f) => CODE.test(f) && fs.existsSync(path.join(root, f))).sort();
  const units = list.flatMap((f) => unitsOfFile(f, fs.readFileSync(path.join(root, f), 'utf8')));
  return { root, files: list, units, counts: mapSummary({ units }).counts };
}

// ------------------------------------------------------------------------------------------------- tests [iv2-tests]
function testFilesOf(root) {
  const out = [];
  const visit = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) visit(p);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) out.push(p);
    }
  };
  visit(root);
  return out;
}

/**
 * CharTest[] for a closure: the app's own tests that import one of its files, each pinned to the units of the files it
 * imports. Stand-in for iv2-tests (which writes new tests in the app's runner, one per branch or handler group).
 * @param {string} root
 * @param {{files: string[]}} closure
 * @param {{units: any[]}} map
 * @param {string} runner
 * @returns {{file: string, runner: string, kind: 'pure'|'render'|'interaction'|'machine', unitFingerprints: string[], title: string}[]}
 */
export function characterize(root, closure, map, runner) {
  const { aliases } = readPathAliases(root);
  const inClosure = new Set(closure.files);
  const tests = [];
  for (const abs of testFilesOf(root)) {
    const source = fs.readFileSync(abs, 'utf8');
    const hit = new Set();
    for (const m of source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const to = resolveImportSpecifier(abs, m[1], aliases) ?? ['.mjs', '.js'].map((x) => (m[1].startsWith('.') ? path.resolve(path.dirname(abs), m[1]) : '')).find((p) => p && fs.existsSync(p));
      if (to && inClosure.has(toRel(root, to))) hit.add(toRel(root, to));
    }
    if (!hit.size) continue;
    const rel = toRel(root, abs);
    tests.push({ file: rel, runner, kind: /** @type {'render'|'pure'} */ (/render|screen\.|@testing-library/.test(source) ? 'render' : 'pure'), unitFingerprints: map.units.filter((u) => hit.has(u.file)).map((u) => u.fingerprint), title: path.basename(rel) });
  }
  return tests;
}

// ------------------------------------------------------------------------------------------------- the ops
/**
 * The import loop's ops on a real project (importLoop.mjs LoopOps), for one folder.
 * @param {string} root
 * @param {string} folder
 * @param {{recorder?: {record: (state: any) => any}}} [o]
 * @returns {any}
 */
export function createLogicOnDisk(root, folder, o = {}) {
  const FILES = { 'logic-map': 'line/logic-map.json', baseline: 'line/import-baseline.json' };
  const recorder = o.recorder ?? createImportLoopRecorder(root);
  const load = async (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, folder, FILES[name]), 'utf8')); } catch (e) {
      if (/** @type {any} */ (e)?.code === 'ENOENT') return null;
      throw e;
    }
  };
  return {
    standIn: 'disk',
    closure: async (_r, f, route) => (route ? readRouteFamily(root, route) : { appRoot: root, routes: [], files: folderCodeFiles(root, f), external: [] }),
    // The map now: the closure's files that are still there, and every code file of the folder (where moved files land).
    buildMap: async (_r, f, closure) => buildLogicMap(root, [...(closure?.files ?? []), ...folderCodeFiles(root, f)]),
    compare: async (before, after) => compareLogicMaps(before, after),
    characterize: async (_r, _f, closure, map) => {
      const runner = testRunnerOf(root);
      const tests = characterize(root, closure, map, runner);
      return { tests, sentence: tests.length ? `Line found ${tests.length} test file${tests.length === 1 ? '' : 's'} of the app that cover these files (${runner}).` : 'The app has no tests for these files yet, so Line checks behaviour with the logic map and the behaviour check.' };
    },
    runTests: async (_r, f, tests) => runCharTests(root, f, tests),
    behaviour: async (_r, f, diff) => checkBehaviour(root, diff, (await load('baseline'))?.sources ?? {}, f),
    save: async (name, data) => {
      // The baseline keeps each file's source, for the behaviour check after the files moved.
      const body = name === 'logic-map' ? data : { sources: Object.fromEntries((data.files ?? []).filter((x) => fs.existsSync(path.join(root, x))).map((x) => [x, fs.readFileSync(path.join(root, x), 'utf8')])) };
      writeFolderFile(root, folder, FILES[name], `${JSON.stringify(body)}\n`);
    },
    load,
    record: (state) => recorder.record(state),
  };
}
