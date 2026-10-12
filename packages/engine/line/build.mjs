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
  if (fs.existsSync(path.join(root, features, n))) throw new LineOpError(`The feature ${n} already exists; change its spec.md with line.setCode instead.`, 'NAME_TAKEN');
  const content = `# ${n}\n\n## ${s}\n\n${list.map((p) => `- ${p}`).join('\n')}\n`;
  return { summary: `Creates the feature ${n} with its spec (${list.length} acceptance point${list.length === 1 ? '' : 's'}).`, files: [{ path: `${features}/${n}/spec.md`, content }] };
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
    throw new LineOpError(`A route serves a feature page: name a file like ${features}/<feature>/pages/<Name>.tsx.`, 'UNKNOWN_ITEM');
  }
  const source = readOrNull(path.join(root, rel));
  if (source === null) throw new LineOpError(`There is no page ${rel}; create it first (line.baseOn on a library page, or line.setCode).`, 'UNKNOWN_ITEM');
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
  const where = () => new LineOpError(`Line writes code only inside ${library}/<kind>/ or ${features}/<feature>/<kind>/ (kinds: ${ITEM_KINDS.join(', ')}), plus a feature's spec.md; "${file}" is not such a file.`, 'UNKNOWN_ITEM');
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
  return { summary: `${before === null ? 'Creates' : 'Rewrites'} ${rel}.`, files: [{ path: rel, content }] };
}
