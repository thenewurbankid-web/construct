// Building an app inside Line (bench-ecom M1): the three planners a builder needs that no other Line tool covers.
// Contract: contract.mjs CreateFeatureRequest, AddRouteRequest, SetCodeRequest; each returns a StagedChange and writes
// nothing. The plan runner lands the change through applyChange (Construct's transactional writer + the Line validate
// gate), so every rule (LINE-BASE, LINE-DIR, LINE-OWNER, ...) still decides whether it lands.
//
//   planCreateFeature(root, {name, story, points})   features/<name>/spec.md in Line's spec format (featureText.mjs)
//   planAddRoute(root, {route, page})                an app-router route entry re-exporting one feature page
//                                                    (LINE-OWNER routeEntryFeature), plus `@line-route` on the page
//   planSetCode(root, {file, code, contentHash?})    the whole content of one library or feature file ("View/edit
//                                                    code"): a new file, or an existing one at the hash it was read at
import fs from 'node:fs';
import path from 'node:path';
import { jsxParseError } from '@construct/ast';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS, ITEM_KINDS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { hashOf } from '../pagesEditor.mjs';
import { LineOpError } from './contract.mjs';
import { featureNameProblem } from './newProject.mjs';
import { typeCheckStaged, importFixes, typeRefusal } from './typeGate.mjs';
import { appLayoutFile, layoutFixesFor } from './shell.mjs';

const posix = path.posix;
const layoutOf = (root) => resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const oneLine = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
/** A max on what one setCode step may write, so a step stays reviewable. */
export const MAX_CODE_BYTES = 64 * 1024;

/** A root-relative path with no escape (no "..", no absolute, no backslash), or null. */
function cleanRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0') || path.isAbsolute(p)) return null;
  const segs = p.split('/');
  return segs.some((s) => s === '' || s === '.' || s === '..' || s === 'node_modules' || s.startsWith('.')) ? null : p;
}

/**
 * features/<name>/spec.md for a new feature: its title, one story and its numbered acceptance points.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').CreateFeatureRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} BAD_FEATURE, BAD_ARGS or NAME_TAKEN.
 */
export function planCreateFeature(root, { name, story, points } = /** @type {any} */ ({})) {
  const problem = featureNameProblem(name);
  if (problem) throw new LineOpError(problem, 'BAD_FEATURE');
  const n = String(name).trim();
  const s = oneLine(story);
  if (!s) throw new LineOpError('Say the feature\'s story in one sentence, for example "As a shopper, I want to browse products, so that I can find one to buy."', 'BAD_ARGS');
  const list = Array.isArray(points) ? points.map(oneLine).filter(Boolean) : [];
  if (!list.length) throw new LineOpError('Give the feature at least one acceptance point: one thing a person can do, that a test can check.', 'BAD_ARGS');
  const { features } = layoutOf(root);
  const content = `# ${n}\n\n## ${s}\n\n${list.map((p) => `- ${p}`).join('\n')}\n`;
  if (fs.existsSync(path.join(root, features, n))) {
    // bench-gaps 6: the new-project flow makes a first feature with a placeholder spec, so "create" usually means "fill".
    const file = `${features}/${n}/spec.md`;
    const before = readOrNull(path.join(root, file));
    if (before === content) throw new LineOpError(`The feature ${n} already exists with exactly this spec; go on with its pages and components.`, 'NAME_TAKEN');
    const fix = { id: 'NAME_TAKEN/use-existing', sentence: `Use the existing feature ${n}: write this story and these points into its spec.md.`, step: { tool: 'line.setCode', args: { file, code: content, ...(before === null ? {} : { contentHash: hashOf(before) }) } } };
    throw new LineOpError(`The feature ${n} already exists${before !== null && isPlaceholderSpec(before) ? ' with a placeholder spec' : ''}; use it: write this story and these points into its spec.md (fixes[0].step).`, 'NAME_TAKEN', undefined, [fix]);
  }
  return { summary: `Creates the feature ${n} with its spec (${list.length} acceptance point${list.length === 1 ? '' : 's'}).`, files: [{ path: `${features}/${n}/spec.md`, content }] };
}

/**
 * Whether a spec.md is still the new-project placeholder (newProject.mjs: "Describe one thing a person can do in ...").
 * @param {string} text The spec.md content.
 * @returns {boolean}
 */
export const isPlaceholderSpec = (text) => /^- Describe one thing a person can do in /m.test(String(text));

/**
 * Every feature page of the project, as root-relative files (features/<f>/pages/<Name>.tsx), sorted.
 * @param {string} root Project root.
 * @returns {string[]}
 */
export function featurePages(root) {
  const { features } = layoutOf(root);
  const out = [];
  let names = [];
  try { names = fs.readdirSync(path.join(root, features), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); } catch { names = []; }
  for (const f of names.sort()) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, features, f, 'pages')); } catch { files = []; }
    for (const n of files.sort()) if (CODE_EXTENSIONS.includes(posix.extname(n)) && !/^index\.|\.(test|spec|stories)\./.test(n)) out.push(`${features}/${f}/pages/${n}`);
  }
  return out;
}

/** The library pages (library/pages/<Name>.tsx) as library ids ("pages/ListPage"), sorted. */
function libraryPageIds(root) {
  const { library } = layoutOf(root);
  try { return fs.readdirSync(path.join(root, library, 'pages')).filter((n) => CODE_EXTENSIONS.includes(posix.extname(n))).map((n) => `pages/${n.replace(/\.[^.]+$/, '')}`).sort(); } catch { return []; }
}

/** How well a page file matches what a builder wrote for it ("catalog", "ListPage", a wrong path): higher is closer. */
function pageScore(file, asked) {
  const a = String(asked ?? '').toLowerCase();
  const segs = file.toLowerCase().split('/');
  const name = segs[segs.length - 1].replace(/\.[^.]+$/, '');
  return (a.includes(segs[1]) ? 2 : 0) + (a.includes(name) ? 1 : 0);
}

/** bench-gaps 1: the feature pages a route can serve, as typed fixes (each one line.addRoute step), closest first. */
function routeFixes(root, route, asked, max = 8) {
  return featurePages(root)
    .map((page, i) => ({ page, i, score: pageScore(page, asked) }))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, max)
    .map(({ page }) => ({ id: `UNKNOWN_ITEM/page:${page}`, sentence: `Serve ${posix.basename(page).replace(/\.[^.]+$/, '')} of feature ${page.split('/').at(-3)} at ${route}.`, step: { tool: 'line.addRoute', args: { route, page } } }));
}

/** With no feature page yet: create one (line.baseOn a library page) in the feature the request names, else in each. */
function newPageFixes(root, asked) {
  const { features } = layoutOf(root);
  let names = [];
  try { names = fs.readdirSync(path.join(root, features), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { names = []; }
  const a = String(asked ?? '').toLowerCase();
  const named = names.filter((f) => a.includes(f.toLowerCase()));
  const pascal = (f) => `${f.replace(/(^|[-_])([a-z0-9])/g, (_m, _s, c) => c.toUpperCase())}Page`;
  return (named.length ? named : names).flatMap((feature) => libraryPageIds(root).map((libraryId) => ({
    id: `UNKNOWN_ITEM/base-on:${feature}:${libraryId}`,
    sentence: `Create ${pascal(feature)} in feature ${feature}, based on the library page ${libraryId.split('/')[1]}; then add the route for it.`,
    step: { tool: 'line.baseOn', args: { libraryId, feature, name: pascal(feature) } },
  }))).slice(0, 6);
}

/**
 * The app-router folder of the project: src/app when the project has one, else app.
 * @param {string} root Project root.
 * @returns {string}
 */
export function appDirOf(root) {
  return fs.existsSync(path.join(root, 'src', 'app')) ? 'src/app' : 'app';
}

/**
 * A route as app-router folders: "/" -> "", "/products/:id" or "/products/[id]" -> "products/[id]".
 * @param {string} route
 * @returns {string}
 * @throws {LineOpError} BAD_ROUTE.
 */
export function routeFolders(route) {
  const bad = () => new LineOpError(`"${route}" is not a route Line can serve; write it like "/", "/cart" or "/products/:id".`, 'BAD_ROUTE');
  if (typeof route !== 'string' || !route.startsWith('/')) throw bad();
  const segs = route.split('/').filter(Boolean);
  const out = segs.map((s) => {
    const p = /^:([A-Za-z][A-Za-z0-9_]*)$/.exec(s) || /^\[([A-Za-z][A-Za-z0-9_]*)\]$/.exec(s);
    if (p) return `[${p[1]}]`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw bad();
    return s;
  });
  return out.join('/');
}

/** The route in Line's form ("/products/:id"), as `@line-route` says it. */
const routeOf = (folders) => `/${folders.split('/').filter(Boolean).map((s) => s.replace(/^\[(.*)\]$/, ':$1')).join('/')}`;

/**
 * A route entry for one feature page: `<app>/<route>/page.tsx` re-exports the page as the route's default export, and
 * the page gets its `@line-route` pragma (one route per page; LINE-OWNER refuses two features claiming one route).
 * @param {string} root Project root.
 * @param {import('./contract.mjs').AddRouteRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} BAD_ROUTE, UNKNOWN_ITEM, NO_EXPORT or NAME_TAKEN.
 */
export function planAddRoute(root, { route, page } = /** @type {any} */ ({})) {
  const folders = routeFolders(route);
  const { features } = layoutOf(root);
  const rel = cleanRel(page);
  const segs = rel ? rel.slice(features.length + 1).split('/') : [];
  if (!rel || !rel.startsWith(`${features}/`) || segs.length !== 3 || segs[1] !== 'pages' || !CODE_EXTENSIONS.includes(posix.extname(rel))) {
    const fixes = routeFixes(root, route, page);
    if (!fixes.length) fixes.push(...newPageFixes(root, page));
    const some = fixes.slice(0, 3).map((f) => f.step.args.page).join(', ');
    throw new LineOpError(`A route serves a feature page: name a file like ${features}/<feature>/pages/<Name>.tsx${fixes.length ? ` (the feature pages are ${some}${fixes.length > 3 ? ', ...' : ''}; each is in fixes)` : '; there is no feature page yet, so create one first with line.baseOn on a library page'}.`, 'UNKNOWN_ITEM', undefined, fixes);
  }
  const source = readOrNull(path.join(root, rel));
  if (source === null) {
    const feature = segs[0];
    const name = posix.basename(rel).replace(/\.[^.]+$/, '');
    const hasFeature = fs.existsSync(path.join(root, features, feature));
    const create = hasFeature && /^[A-Z][A-Za-z0-9]*$/.test(name)
      ? libraryPageIds(root).map((libraryId) => ({ id: `UNKNOWN_ITEM/base-on:${libraryId}`, sentence: `Create ${name} in feature ${feature}, based on the library page ${libraryId.split('/')[1]}; then add the route again.`, step: { tool: 'line.baseOn', args: { libraryId, feature, name } } }))
      : [];
    throw new LineOpError(`There is no page ${rel}; create it first (line.baseOn on a library page, or line.setCode), or serve a page that exists.`, 'UNKNOWN_ITEM', undefined, [...routeFixes(root, route, page, 4), ...create].slice(0, 8));
  }
  const named = /export\s+(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)/.exec(source) || /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/.exec(source);
  const hasDefault = /export\s+default\b/.test(source);
  if (!named && !hasDefault) throw new LineOpError(`The page ${rel} exports no component, so there is nothing for the route to show.`, 'NO_EXPORT');
  const app = appDirOf(root);
  const entry = folders ? `${app}/${folders}/page.tsx` : `${app}/page.tsx`;
  if (['tsx', 'ts', 'jsx', 'js'].some((x) => fs.existsSync(path.join(root, entry.replace(/\.tsx$/, `.${x}`))))) {
    throw new LineOpError(`The route ${routeOf(folders)} already has a page (${entry}); pick another route.`, 'NAME_TAKEN');
  }
  let spec = posix.relative(posix.dirname(entry), rel).replace(/\.[cm]?[jt]sx?$/, '');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  const content = named ? `export { ${named[1]} as default } from '${spec}';\n` : `export { default } from '${spec}';\n`;
  const lineRoute = routeOf(folders);
  const files = [{ path: entry, content }];
  const claimed = /@line-route\s+(\S+)/.exec(source);
  if (claimed && claimed[1] !== lineRoute) throw new LineOpError(`The page ${rel} already serves ${claimed[1]}; one page serves one route.`, 'NAME_TAKEN');
  if (!claimed) {
    const lines = source.split('\n');
    let at = 0;
    while (at < lines.length && /^\s*\/\/\s*@line-/.test(lines[at])) at += 1;
    lines.splice(at, 0, `// @line-route ${lineRoute}`);
    files.push({ path: rel, content: lines.join('\n') });
  }
  return { summary: `Serves ${posix.basename(rel).replace(/\.[^.]+$/, '')} of feature ${segs[0]} at ${lineRoute}.`, files };
}

/**
 * The whole content of one file in the library or a feature: a code file of a known kind, a fixture (.json) or a
 * feature's spec.md. An existing file is replaced only at the hash it was read at (plan-cli `read`, line.fragments).
 * @param {string} root Project root.
 * @param {import('./contract.mjs').SetCodeRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM, STALE, BAD_CODE or NO_CHANGE.
 */
export function planSetCode(root, { file, code, contentHash } = /** @type {any} */ ({})) {
  const { library, features } = layoutOf(root);
  const rel = cleanRel(file);
  const where = () => new LineOpError(`Line writes code only inside ${library}/<kind>/ or ${features}/<feature>/<kind>/ (kinds: ${ITEM_KINDS.join(', ')}), plus a feature's spec.md; "${file}" is not such a file.`, 'UNKNOWN_ITEM', undefined, appFileFixes(root, rel, code));
  if (!rel) throw where();
  const segs = rel.split('/');
  const ext = posix.extname(rel);
  const inLib = rel.startsWith(`${library}/`) && segs.length >= library.split('/').length + 2 && ITEM_KINDS.includes(segs[library.split('/').length]);
  const fBase = features.split('/').length;
  const isSpec = rel.startsWith(`${features}/`) && segs.length === fBase + 2 && segs[fBase + 1] === 'spec.md';
  const inFeature = rel.startsWith(`${features}/`) && segs.length >= fBase + 3 && ITEM_KINDS.includes(segs[fBase + 1]);
  if (!isSpec && !inLib && !inFeature) throw where();
  const kind = isSpec ? null : segs[inLib ? library.split('/').length : fBase + 1];
  const okExt = isSpec ? ext === '.md' : kind === 'fixtures' ? ext === '.json' || CODE_EXTENSIONS.includes(ext) : CODE_EXTENSIONS.includes(ext);
  if (!okExt) throw where();
  if (isSpec && !fs.existsSync(path.join(root, features, segs[fBase]))) throw new LineOpError(`There is no feature ${segs[fBase]}; create it with line.createFeature.`, 'UNKNOWN_FEATURE');
  if (typeof code !== 'string' || !code.trim()) throw new LineOpError('The code is empty; write the whole file.', 'BAD_CODE');
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new LineOpError(`The file is over ${MAX_CODE_BYTES / 1024} KB; split it into smaller items.`, 'BAD_CODE');
  const content = code.endsWith('\n') ? code : `${code}\n`;
  const before = readOrNull(path.join(root, rel));
  if (before !== null) {
    if (typeof contentHash !== 'string' || contentHash !== hashOf(before)) {
      throw new LineOpError(`${rel} already exists; read it first and pass its contentHash, so a change made meanwhile is never overwritten.`, 'STALE');
    }
    if (before === content) throw new LineOpError('Nothing changed; this is the code that is already there.', 'NO_CHANGE');
  } else if (contentHash !== undefined) {
    throw new LineOpError(`${rel} does not exist yet, so leave contentHash out to create it.`, 'STALE');
  }
  if (ext === '.json') {
    try { JSON.parse(content); } catch (e) { throw new LineOpError('This fixture is not valid JSON, so nothing was saved.', 'BAD_CODE', /** @type {Error} */ (e).message); }
  } else if (!isSpec) {
    const err = jsxParseError(content);
    if (err) throw new LineOpError('This code does not parse, so nothing was saved.', 'BAD_CODE', err);
  }
  const files = [{ path: rel, content }];
  // bench-gaps 3: the file and the files that import it are type-checked as the change would leave them.
  const types = isSpec || ext === '.json' ? null : typeCheckStaged(root, files);
  const warnings = [];
  if (types && types.errors.length) {
    if (!types.slow) {
      const { sentence, detail } = typeRefusal(types.errors);
      throw new LineOpError(sentence, 'TYPE_ERROR', detail, importFixes(root, { library, features }, rel, content, contentHash, types.errors));
    }
    for (const d of types.errors) warnings.push({ sentence: `The saved code may not compile (${d.message.split('\n')[0].replace(/[.?!]$/, '')}).`, rule: d.code, severity: 'warning', file: d.file, line: d.line });
  }
  return { summary: `${before === null ? 'Creates' : 'Rewrites'} ${rel}.`, files, ...(types ? { typeCheck: { ms: types.ms, slow: types.slow } } : {}), ...(warnings.length ? { warnings } : {}) };
}

/**
 * bench-gaps 1/2: a whole-file write to an app-router file is refused (Line owns app/), but what it meant has a tool:
 * the root layout -> line.setLayoutSlot with the components its code renders; a route entry -> line.addRoute for the
 * feature page it imports (else every feature page at that route).
 * @param {string} root @param {string|null} rel @param {unknown} code
 * @returns {{id: string, sentence: string, step: {tool: string, args: Record<string, unknown>}}[]}
 */
function appFileFixes(root, rel, code) {
  if (!rel) return [];
  const app = appDirOf(root);
  if (rel === appLayoutFile(root) || rel === appLayoutFile(root).replace(/\.tsx$/, '.jsx')) return layoutFixesFor(root, String(code ?? ''));
  const m = new RegExp(`^${app}/((?:[^/]+/)*)page\\.[jt]sx?$`).exec(rel);
  if (!m) return [];
  const route = `/${m[1].split('/').filter(Boolean).map((x) => x.replace(/^\[(.*)\]$/, ':$1')).join('/')}`;
  const asked = [...String(code ?? '').matchAll(/from\s*['"]([^'"]+)['"]/g)].map((x) => x[1]).join(' ');
  return routeFixes(root, route, asked, 6);
}

/**
 * bench-gaps 1 (PAGE-002/003/005, COMPONENT-003): a page or component may not import an application layer
 * (services/, workflows/, domain); it reaches it through a usecase of its own feature (or, in the library, a library
 * usecase), the Line way the pilot builder found by hand. Writes `<area>/usecases/<name>.ts` re-exporting the module
 * (unless that usecase already does) and re-points the import in `file`. Pure.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').UseViaUsecaseRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM or NOTHING_TO_DO.
 */
export function planUseViaUsecase(root, { file, specifier } = /** @type {any} */ ({})) {
  const { library, features } = layoutOf(root);
  const rel = cleanRel(file);
  const source = rel && CODE_EXTENSIONS.includes(posix.extname(rel)) ? readOrNull(path.join(root, rel)) : null;
  if (!rel || source === null) throw new LineOpError(`There is no code file ${file} in the library or a feature.`, 'UNKNOWN_ITEM');
  const spec = String(specifier ?? '');
  const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp(`import\\s+([^;]*?)\\s*from\\s*(['"])${esc}\\2`).exec(source);
  if (!spec || !decl) throw new LineOpError(`${posix.basename(rel)} does not import "${spec}", so there is nothing to re-point.`, 'NOTHING_TO_DO');
  const fBase = features.split('/').length;
  const segs = rel.split('/');
  const area = rel.startsWith(`${features}/`) ? `${features}/${segs[fBase]}` : rel.startsWith(`${library}/`) ? library : null;
  if (!area) throw new LineOpError(`${rel} is not in the library or a feature.`, 'UNKNOWN_ITEM');
  // The module it imports, as a project file.
  const base = spec.startsWith('.') ? posix.normalize(posix.join(posix.dirname(rel), spec)) : spec.replace(/^[@~#]\//, '');
  const target = ['', ...CODE_EXTENSIONS, ...CODE_EXTENSIONS.map((x) => `/index${x}`)].map((x) => `${base}${x}`).find((p) => posix.extname(p) && fs.existsSync(path.join(root, p)));
  if (!target) throw new LineOpError(`"${spec}" is not a file of this project, so Line cannot put a usecase in front of it.`, 'UNKNOWN_ITEM');
  const name = posix.basename(target).replace(/\.[^.]+$/, '').replace(/^index$/, posix.basename(posix.dirname(target)));
  const dir = `${area}/usecases`;
  const fromUsecase = (() => { const s = posix.relative(dir, target.replace(/\.[^.]+$/, '').replace(/\/index$/, '')); return s.startsWith('.') ? s : `./${s}`; })();
  const hasDefault = /^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(decl[1].replace(/^type\s+/, ''));
  const body = `// A usecase in front of ${target}: pages and components reach application logic through a usecase (Line's layer rule).\nexport * from '${fromUsecase}';\n${hasDefault ? `export { default } from '${fromUsecase}';\n` : ''}`;
  let usecase = null;
  for (let i = 0; i < 20 && !usecase; i += 1) {
    const candidate = `${dir}/${name}${i ? `Usecase${i > 1 ? i : ''}` : ''}.ts`;
    const there = readOrNull(path.join(root, candidate));
    if (there === null || there === body) usecase = { path: candidate, exists: there !== null };
  }
  if (!usecase) throw new LineOpError(`The usecases folder ${dir} has no free name for ${name}.`, 'NAME_TAKEN');
  let to = posix.relative(posix.dirname(rel), usecase.path.replace(/\.ts$/, ''));
  if (!to.startsWith('.')) to = `./${to}`;
  const content = source.replace(decl[0], decl[0].replace(new RegExp(`(['"])${esc}\\1$`), `$1${to}$1`));
  const files = [{ path: rel, content }];
  if (!usecase.exists) files.push({ path: usecase.path, content: body });
  return { summary: `Imports ${name} into ${posix.basename(rel)} through the usecase ${usecase.path} instead of directly.`, files };
}
