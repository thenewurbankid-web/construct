// #908 -- each feature's unfinished work, as concrete next steps (contract.mjs OpenWork). Static, deterministic, reads
// files only: a builder (a small model or a person) sees what is left of every feature on every plan answer, instead of
// a bare "ok" while a page is unrouted or renders nothing.
//
//   openWork(root, {spec?})   per feature in spec order: its open items (a missing feature or spec, a page with no
//                             @line-route with the exact line.addRoute step, a page that renders its library page with no
//                             children and imports no data, spec points no file of the feature covers) and its points
//                             with their labels; `current` is the first feature with open work, not the last touched
//   workText(work, {cap})     the card a builder reads: open count, the current feature, its next items and its points
//                             (open ones first) under the #886 adaptive cap
//   pointLabels(text)         the quoted labels of one acceptance point ("Products", "Quantity for ")
//   pointStep(o)              #917: the one concrete next call for an uncovered point: line.setCode on the feature page
//                             that should show it (its real contentHash), or the line.baseOn that creates the feature's
//                             page when it has none (pure; the spec->steps pass, #914, may reuse it)
//   pointSlot(src, point)     #920: the page's real code with one marked slot comment where the point goes (parses)
//   slotOf(code)              #920: the slot (or the old "<the whole file ...>" placeholder) still in sent code, or null
//
// `spec` is the target spec ({features: [{name, story, points: [{id, text}]}]}, e.g. a SPEC.md the builder works from);
// without one, each feature's own spec.md is the spec (featureText.mjs parseSpec), in folder order.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { parseSpec } from './featureText.mjs';
import { featurePages, isPlaceholderSpec } from './build.mjs';
import { hashOf } from '../pagesEditor.mjs';
import { jsxParseError } from '@construct/ast';

const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const dirs = (abs) => { try { return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; } };
const baseName = (file) => path.posix.basename(file).replace(/\.[^.]+$/, '');
const ID_TEXT = /^([A-Z][A-Z0-9]*-\d+):\s+(.+)$/;
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` has `word` as a whole word ("Cart" is not in "CartPage"). */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_])${esc(word)}([^A-Za-z0-9_]|$)`).test(text);

/**
 * The quoted labels of an acceptance point: each "..." in its text that does not start lower-case (that is typed input,
 * like "mug"), cut before a placeholder (<name>) and an example count ("Cart (3)" -> "Cart"). These are the names a
 * test finds the UI by (roles and labels).
 * @param {string} text
 * @returns {string[]}
 */
export function pointLabels(text) {
  const out = [];
  for (const m of String(text).matchAll(/"([^"]+)"/g)) {
    const l = m[1].split('<')[0].replace(/\s*\(\d+\)\s*$/, '').trim();
    // A lower-case quote is an example of typed input ("mug"), not a label the UI shows.
    if (l && !/^[a-z]/.test(l) && !out.includes(l)) out.push(l);
  }
  return out;
}

/** Routes an acceptance point names in backticks ("/", "/products/<id>" -> "/products/:id"); `at` only "The page at `/x`". */
function routesIn(text, at) {
  const re = at ? /\bpage at `(\/[^`\s]*)`/g : /`(\/[^`\s]*)`/g;
  return [...String(text).matchAll(re)].map((m) => m[1].replace(/<([A-Za-z]\w*)>/g, ':$1').replace(/\[([A-Za-z]\w*)\]/g, ':$1'));
}

/** A feature's spec.md as {story, points} (ids "CAT-1" when the point starts with one, else parseSpec's "s1.p1"). */
function ownSpec(text) {
  const stories = parseSpec(text ?? '');
  const story = stories[0]?.text ?? '';
  const points = stories.flatMap((s) => s.points).map((p) => { const m = ID_TEXT.exec(p.text); return m ? { id: m[1], text: m[2] } : p; });
  return { story, points };
}

/** spec.md content as line.createFeature writes it. */
const specContent = (name, story, points) => `# ${name}\n\n## ${story}\n\n${points.map((p) => `- ${p.id}: ${p.text}`).join('\n')}\n`;

/**
 * @typedef {{kind: 'feature'|'spec'|'page'|'data'|'route'|'point', feature: string, sentence: string,
 *   step?: {tool: string, args: any}, point?: {id: string, text: string, labels: string[]}, file?: string}} OpenItem
 * @typedef {{id: string, text: string, labels: string[], covered: boolean|null}} WorkPoint
 * @typedef {{name: string, story: string, exists: boolean, points: WorkPoint[], open: OpenItem[]}} WorkFeature
 * @typedef {{features: WorkFeature[], current: string|null, count: number, first: OpenItem|null}} OpenWork
 */

/**
 * Each feature's unfinished work, in spec order (see the header).
 * @param {string} root Project root.
 * @param {{spec?: {features: {name: string, story: string, points: {id: string, text: string}[]}[]} | null}} [o]
 * @returns {OpenWork}
 */
export function openWork(root, { spec = null } = {}) {
  const layout = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const fdir = layout.features;
  const onDisk = dirs(path.join(root, fdir));
  const given = spec?.features ?? [];
  const order = [...given.map((f) => f.name), ...onDisk.filter((n) => !given.some((f) => f.name === n))];
  const pages = featurePages(root).map((file) => {
    const src = readOrNull(path.join(root, file)) ?? '';
    return { file, feature: file.split('/').at(-3), src, route: /@line-route\s+(\S+)/.exec(src)?.[1] ?? null, base: /@line-base\s+(\S+)/.exec(src)?.[1] ?? null };
  });
  const served = new Set(pages.map((p) => p.route).filter(Boolean));
  // Each feature's "page at" routes: a route another feature's spec puts its page at is never offered to this one.
  const specOf = (name) => {
    const g = given.find((f) => f.name === name);
    if (g) return { story: g.story, points: g.points, from: 'spec' };
    const own = readOrNull(path.join(root, fdir, name, 'spec.md'));
    return { ...ownSpec(own), from: own !== null && isPlaceholderSpec(own) ? 'placeholder' : 'own' };
  };
  const specs = new Map(order.map((n) => [n, specOf(n)]));
  const pageAt = new Map(order.map((n) => [n, [...new Set(specs.get(n).points.flatMap((p) => routesIn(p.text, true)))]]));
  const libraryPages = (() => { try { return fs.readdirSync(path.join(root, layout.library, 'pages')).filter((n) => CODE_EXTENSIONS.includes(path.extname(n))).map((n) => `pages/${baseName(n)}`).sort(); } catch { return []; } })();
  const fixtures = (() => { try { return fs.readdirSync(path.join(root, layout.library, 'fixtures')).filter((n) => n.endsWith('.json')).sort().map((n) => `${layout.library}/fixtures/${n}`); } catch { return []; } })();

  const features = order.map((name) => {
    const sp = specs.get(name);
    const exists = onDisk.includes(name);
    /** @type {OpenItem[]} */
    const open = [];
    const own = pages.filter((p) => p.feature === name);
    const sources = exists ? featureSources(root, path.join(fdir, name)) : '';
    const points = sp.points.map((p) => {
      const labels = pointLabels(p.text);
      const covered = !exists ? false : hasWord(sources, p.id) ? true : labels.length ? labels.every((l) => hasWord(sources, l)) : null;
      return { id: p.id, text: p.text, labels, covered };
    });
    if (!exists) {
      open.push({ kind: 'feature', feature: name, sentence: `Feature ${name} does not exist yet; create it with its story and its ${sp.points.length} points.`,
        step: { tool: 'line.createFeature', args: { name, story: sp.story, points: sp.points.map((p) => `${p.id}: ${p.text}`) } } });
      return { name, story: sp.story, exists, points, open };
    }
    if (sp.from === 'spec') {
      const file = `${fdir}/${name}/spec.md`;
      const text = readOrNull(path.join(root, file));
      if (text === null || isPlaceholderSpec(text)) {
        open.push({ kind: 'spec', feature: name, file, sentence: `${file} is ${text === null ? 'missing' : 'still the placeholder'}; write the feature's story and its ${sp.points.length} points into it.`,
          step: { tool: 'line.setCode', args: { file, code: specContent(name, sp.story, sp.points), ...(text === null ? {} : { contentHash: hashOf(text) }) } } });
      }
    } else if (sp.from === 'placeholder') {
      open.push({ kind: 'spec', feature: name, file: `${fdir}/${name}/spec.md`, sentence: `${fdir}/${name}/spec.md is still the placeholder; write the feature's story and its acceptance points into it (line.setCode).` });
    }
    if (!own.length) {
      const at = pageAt.get(name)?.[0];
      open.push({ kind: 'page', feature: name, sentence: `Feature ${name} has no page yet${at ? ` (its spec puts one at ${at})` : ''}; create one with line.baseOn on a library page (${libraryPages.map((l) => l.split('/')[1]).join(', ') || 'none in the library'}), then add its route.` });
    }
    // Routes this feature's pages should serve: its own "page at" routes, then other routes its points name that no
    // other feature's spec claims; minus what is served already.
    const claimedElsewhere = new Set(order.filter((n) => n !== name).flatMap((n) => pageAt.get(n) ?? []));
    const wanted = [...new Set([...(pageAt.get(name) ?? []), ...sp.points.flatMap((p) => routesIn(p.text, false)).filter((r) => !claimedElsewhere.has(r))])].filter((r) => !served.has(r));
    const unrouted = own.filter((p) => !p.route);
    const routeItems = unrouted.map((p, i) => {
      const route = wanted[i];
      return route
        ? { kind: /** @type {const} */ ('route'), feature: name, file: p.file, sentence: `${baseName(p.file)} is served at no route; serve it at ${route}.`, step: { tool: 'line.addRoute', args: { route, page: p.file } } }
        : { kind: /** @type {const} */ ('route'), feature: name, file: p.file, sentence: `${baseName(p.file)} is served at no route, and the spec names none left for it; serve it with line.addRoute {"route": "/<route>", "page": "${p.file}"}.` };
    });
    const dataItems = own.map((p) => emptyPage(root, layout, p, fixtures)).filter(Boolean);
    // A page that only forwards its props (a fresh line.baseOn wrapper) cannot be routed until it has its own content.
    const forwards = (file) => { const src = own.find((p) => p.file === file)?.src ?? ''; return /export\s+(?:default\s+)?function\s+\w+\s*\(\s*(?:props\b|\{)/.test(src); };
    for (const r of routeItems) {
      const d = dataItems.find((x) => x?.file === r.file);
      if (d && forwards(r.file)) { open.push(d, r); dataItems.splice(dataItems.indexOf(d), 1); } else open.push(r);
    }
    open.push(.../** @type {OpenItem[]} */ (dataItems));
    for (const p of points.filter((x) => x.covered === false)) {
      const missing = p.labels.filter((l) => !hasWord(sources, l));
      const step = pointStep({ feature: name, point: p, pages: own, libraryPages, pageAt: pageAt.get(name) ?? [] });
      open.push({ kind: 'point', feature: name, point: { id: p.id, text: p.text, labels: p.labels },
        sentence: `${p.id} is not covered yet: no file of ${name} has ${missing.map((l) => `"${l}"`).join(', ')}.`, ...(step ? { step } : {}) });
    }
    return { name, story: sp.story, exists, points, open };
  });
  const cur = features.find((f) => f.open.length) ?? null;
  return { features, current: cur?.name ?? null, count: features.reduce((n, f) => n + f.open.length, 0), first: cur?.open[0] ?? null };
}

/**
 * #917 (pilot-qwen-7b-r4-s2 calls.jsonl:17, "CAT-2 is not covered yet" with no step): the one concrete next call for an
 * uncovered spec point. The feature has a page: line.setCode on the page that should show it (the page serving a route
 * the point names, else the page at the feature's spec route, else its first page), with the page's real contentHash
 * and its code with one marked slot for the point (#920, pointSlot). It has none: the line.baseOn that creates it
 * (DetailPage for a route with a parameter, FormPage for a form, else ListPage; whichever the library has), named after
 * that library page. Pure.
 * @param {{feature: string, point: {id: string, text: string}, pages: {file: string, route: string|null, src: string}[],
 *   libraryPages?: string[], pageAt?: string[]}} o `pages`: the feature's pages; `libraryPages`: the library's page ids
 *   ("pages/ListPage"); `pageAt`: the routes the feature's spec puts its pages at.
 * @returns {{tool: string, args: any} | null} Null when there is no page and no library page to base one on.
 */
export function pointStep({ feature, point, pages, libraryPages = [], pageAt = [] }) {
  const named = routesIn(point.text, false);
  const page = pages.find((p) => p.route && named.includes(p.route)) ?? pages.find((p) => p.route && pageAt.includes(p.route)) ?? pages[0] ?? null;
  if (page) {
    return { tool: 'line.setCode', args: { file: page.file, code: pointSlot(page.src, point).code, contentHash: hashOf(page.src) } };
  }
  const want = [...named, ...pageAt].some((r) => /:/.test(r)) ? 'pages/DetailPage' : /\b(form|field|submit|place order|checkout)\b/i.test(point.text) ? 'pages/FormPage' : 'pages/ListPage';
  const libraryId = libraryPages.includes(want) ? want : libraryPages[0];
  if (!libraryId) return null;
  return { tool: 'line.baseOn', args: { libraryId, feature, name: libraryId.split('/').pop() } };
}

const SLOT = /(\{[ \t]*)?\/\*[ \t]*([A-Z][A-Z0-9]*-\d+): (.*?) [\u2014\u2013-]+ add it here[ \t]*\*\/([ \t]*\})?/;
/**
 * #920 (pilot-qwen-7b-r5 calls.jsonl:15, prose sent 8 times as code): `src` with one marked slot for the point: a JSX
 * comment child before the last closing tag, else a comment above the first export; always code that parses. Pure.
 * @param {string} src @param {{id: string, text: string}} point
 * @returns {{code: string, line: number}} `line`: the slot's line (1-based).
 */
export function pointSlot(src, { id, text }) {
  const mark = `/* ${id}: ${(text.length > 100 ? `${text.slice(0, 97)}...` : text).replace(/\*\//g, '* /')} \u2014 add it here */`;
  const lines = src.split('\n');
  const at = (i, l) => { const c = [...lines.slice(0, i), l, ...lines.slice(i)].join('\n'); return jsxParseError(c) ? null : { code: c, line: i + 1 }; };
  const close = lines.map((l) => /^\s*<\/[A-Za-z][\w.]*\s*>/.test(l)).lastIndexOf(true);
  const exp = Math.max(0, lines.findIndex((l) => /^export\s/.test(l)));
  return (close >= 0 && at(close, `${/^\s*/.exec(lines[close])?.[0]}  {${mark}}`)) || at(exp, mark) || { code: `${mark}\n${src}`, line: 1 };
}

/**
 * #920: the slot a point step's skeleton marks, still in `code` (`rest`: the code without it), or the prose placeholder
 * of a suggestion or an example ("<the whole file ...>"; `prose`); null when `code` is neither.
 * @param {unknown} code
 * @returns {{prose: boolean, id: string|null, text: string|null, line?: number, rest?: string} | null}
 */
export function slotOf(code) {
  if (typeof code !== 'string') return null;
  const m = SLOT.exec(code);
  if (m) {
    const before = code.slice(0, m.index); const after = code.slice(m.index + m[0].length);
    const start = before.lastIndexOf('\n') + 1; const eol = after.indexOf('\n');
    const alone = !before.slice(start).trim() && !(eol < 0 ? after : after.slice(0, eol)).trim();
    return { prose: false, id: m[2], text: m[3], line: before.split('\n').length, rest: alone ? code.slice(0, start) + (eol < 0 ? '' : after.slice(eol + 1)) : before + after };
  }
  if (!/^\s*<(?:the|a|an|your|from)\b[^<>=/]*>\s*$/i.test(code)) return null;
  const p = /showing ([A-Z][A-Z0-9]*-\d+): ([^]*?)>\s*$/.exec(code);
  return { prose: true, id: p?.[1] ?? null, text: p?.[2] ?? null };
}

/** The code of every file of one feature folder (its pages, components and the rest), joined. */
function featureSources(root, rel) {
  const out = [];
  const walk = (d, depth) => {
    let es = [];
    try { es = fs.readdirSync(path.join(root, d), { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = path.posix.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(r, depth + 1);
      else if (e.isFile() && CODE_EXTENSIONS.includes(path.extname(e.name))) out.push(readOrNull(path.join(root, r)) ?? '');
    }
  };
  walk(rel.split(path.sep).join('/'), 0);
  return out.join('\n');
}

/**
 * A page that renders its library page with no content: the base takes children, the page passes none (no closing tag,
 * no children prop, no .map) and imports nothing but the library's pages and components. Null when it renders content.
 * @returns {OpenItem|null}
 */
function emptyPage(root, layout, p, fixtures) {
  if (!p.base) return null;
  const name = p.base.split('/').pop();
  const ext = CODE_EXTENSIONS.find((x) => fs.existsSync(path.join(root, layout.library, `${p.base}${x}`)));
  const base = ext ? readOrNull(path.join(root, layout.library, `${p.base}${ext}`)) : null;
  if (!base || !/\bchildren\??\s*:/.test(base) || !new RegExp(`<${name}\\b`).test(p.src)) return null;
  if (new RegExp(`</${name}\\s*>`).test(p.src) || /\bchildren\s*=/.test(p.src) || /\.map\s*\(/.test(p.src)) return null;
  const specs = [...p.src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const data = specs.filter((s) => s.startsWith('.') && !new RegExp(`/${layout.library.split('/').pop()}/(pages|components)/`).test(s));
  const page = baseName(p.file);
  const hint = data.length ? '' : ` and imports no data${fixtures.length ? ` (the library has ${fixtures.join(', ')})` : ''}`;
  return { kind: 'data', feature: p.feature, file: p.file,
    sentence: `${page} renders ${name} with no content: it passes no children${hint}. Write ${page} with line.setCode on ${p.file}: load the items and render one per item as ${name}'s children.` };
}

/**
 * One open item as a builder reads it: the sentence, then the exact step when there is one (#920: its code in full, never
 * cut; with `full` false, a code step is only announced: an item above changes its file, so its contentHash too).
 * @param {{sentence: string, step?: {tool: string, args: any}|null}} it An open item. @param {boolean} [full]
 * @returns {string}
 */
export const itemText = (it, full = true) => (!it.step ? it.sentence : !full && it.step.args?.code ? `${it.sentence} Its step, with the code, comes once the items above land.`
  : `${it.sentence} Step: ${it.step.tool} ${JSON.stringify(it.step.args, (k, v) => (typeof v === 'string' && v.length > 160 && k !== 'code' ? `${v.slice(0, 157)}...` : v))}`);

/**
 * The work card: how much is open, the current feature, its next items (up to 3) and its points, open ones first, under
 * `cap` (#886: 5, or 15 when the same open item repeats). Empty when nothing is open and there is no feature.
 * @param {OpenWork} work @param {{cap?: number, feature?: string}} [o] `feature`: show that feature's card instead.
 * @returns {string}
 */
export function workText(work, { cap = 5, feature } = {}) {
  const f = work.features.find((x) => x.name === (feature ?? work.current)) ?? (feature ? null : work.features[0]);
  if (!f) return '';
  const per = work.features.filter((x) => x.open.length).map((x) => `${x.name} ${x.open.length}`).join(', ');
  const head = work.count ? `Open work: ${work.count} item${work.count === 1 ? '' : 's'} remain (${per}).` : 'Open work: none; every feature has its pages, routes and points.';
  const lines = [head, `Current feature: ${f.name} (${f.story})`];
  if (f.open.length) lines.push(`Next in ${f.name}:`, ...f.open.slice(0, 3).map((it, i) => `${i + 1}. ${itemText(it, !f.open.slice(0, i).some((x) => x.step?.args?.code && x.step.args.file === it.step?.args?.file))}`), ...(f.open.length > 3 ? [`(${f.open.length - 3} more)`] : []));
  const pts = [...f.points.filter((p) => p.covered === false), ...f.points.filter((p) => p.covered !== false)];
  if (pts.length) {
    const shown = pts.slice(0, cap);
    lines.push(`Points of ${f.name}${shown.length < pts.length ? ` (${shown.length} of ${pts.length}, open first)` : ''}:`,
      ...shown.map((p) => `- ${p.id}${p.covered === false ? ' [open]' : p.covered ? ' [covered]' : ''}: ${p.text}`));
  }
  return lines.join('\n');
}
