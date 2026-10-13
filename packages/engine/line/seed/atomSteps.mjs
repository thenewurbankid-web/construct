// #919 -- spec points -> atom steps: the behaviour points a block fully decides, wired from @line/atoms and the small
// blocks in blocks.mjs, after the feature, page and route steps (specSteps.mjs). Deterministic, no LLM, writes nothing.
//
//   pointBlocks(spec, fixtures)        each point -> {id, feature, block, atom, decided, reason}, read from the point's
//                                      quoted labels, messages and routes plus the fixture's fields; and each block's inputs
//   atomSteps(root, {spec, planned})   the steps (line.useAtom, line.setCode, line.setLayoutSlot, line.baseOn, line.addRoute)
//                                      whose inputs are all decided and whose files are on disk, in dependency order;
//                                      `open`: the points left for the model, each with why; `claimed`: every point a
//                                      block or recipe took (decided or not); `claimedRoutes`: the routes a recipe pages
// Blocks: filter-sort (a "filter labelled", a "search box labelled", the no-match text; atom filter-sort; no debounce:
// the spec gives no delay and the list is client-side), and the recipes of examples/*.json (#933): a recipe is a worked
// example of the mapping (a shop's selection with totals, and the validated form that submits it), data, not code. Its
// anchor must match a point; its roles find the points that give the block its inputs (named groups); its files, steps
// and texts are filled from those inputs and the matched point ids. A recipe that `needs` another applies only where the
// other's anchor matched. So no point id or domain word is written here, and a spec in other words matches no recipe.
// Idempotent: a file already holding the block's code, or a page already rewritten, is skipped with why.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { hashOf } from '../../pagesEditor.mjs';
import { featurePages } from '../build.mjs';
import { arrayFixtures, fixtureFor } from '../basePage.mjs';
import { appLayoutFile, parseAppLayout } from '../shell.mjs';
import { atomSource } from './useAtom.mjs';
import * as B from './blocks.mjs';

const posix = path.posix;
const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const lineRoute = (r) => String(r).trim().replace(/<([A-Za-z]\w*)>/g, ':$1').replace(/\[([A-Za-z]\w*)\]/g, ':$1');
const camel = (s) => { const w = String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []; return w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join(''); };
const quotedList = (s) => [...String(s).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const plainList = (s) => String(s).split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
const rx = (r) => new RegExp(r.re, r.flags ?? '');
/** A recipe text with its {input} and {#role} (the matched point's id) filled; an unknown name is left as written. */
const fill = (tpl, vars) => String(tpl).replace(/\{(#?\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
const ID_KEYS = ['id', 'slug', 'key', 'sku', 'code'];
const NAME_KEYS = ['name', 'title', 'label'];

/** The recipes of every examples/*.json, in file order. */
export const RECIPES = (() => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'examples');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  return names.flatMap((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).recipes ?? []);
})();

/** The fixture's id, name and amount fields (strings, a string, a number whose name matches `amount`), or null. */
function fieldsOf(fx, amount) {
  if (!fx) return null;
  const row = fx.rows[0] ?? {};
  const keys = Object.keys(row);
  const idKey = ID_KEYS.find((k) => typeof row[k] === 'string');
  const nameKey = NAME_KEYS.find((k) => typeof row[k] === 'string');
  const amountKey = keys.find((k) => typeof row[k] === 'number' && amount.test(k));
  // #935: `wrapped` (rows under "value") and `via` (another feature's index export) travel with it to the generated import.
  return idKey && nameKey && amountKey ? { rel: fx.rel, idKey, nameKey, amountKey, rows: fx.rows, ...(fx.wrapped ? { wrapped: true } : {}), ...(fx.via ? { via: fx.via } : {}) } : null;
}

/** A validated form's fields from the quoted labels, checkbox and messages: each message mapped to its field and rule. */
function formFields(labels, boxLabel, messages, hasMessages) {
  const words = (s) => (String(s).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !['i', 'a', 'the', 'to', 'is', 'be', 'must', 'enter', 'valid'].includes(w));
  /** @type {{key: string, label: string, rule: string, message: string, digits?: number}[]} */
  const fields = labels.map((label) => ({ key: camel(label), label, rule: 'required', message: `${label} is required` }));
  let checkbox = boxLabel ? { key: camel(words(boxLabel).at(-1) ?? 'accepted'), label: boxLabel, message: '' } : null;
  let mapped = hasMessages;
  for (const m of messages) {
    const byLabel = fields.find((x) => m.toLowerCase().includes(x.label.toLowerCase())) ?? fields.find((x) => words(x.label).some((w) => words(m).includes(w)));
    const toBox = checkbox && words(checkbox.label).filter((w) => words(m).includes(w)).length >= 2;
    if (toBox && checkbox) { checkbox = { ...checkbox, message: m }; continue; }
    if (!byLabel) { mapped = false; continue; }
    byLabel.message = m;
    const digits = /\bmust be (\d+) digits\b/i.exec(m);
    byLabel.rule = /\bvalid email\b/i.test(m) ? 'email' : digits ? 'digits' : /\bis required\b/i.test(m) ? 'required' : (mapped = false, 'required');
    if (digits) byLabel.digits = Number(digits[1]);
  }
  if (checkbox && !checkbox.message) mapped = false;
  return { fields, checkbox, mapped };
}

/**
 * Every point's block, and each block's inputs, from the point text and the fixtures.
 * @param {{features: {name: string, story: string, points: {id: string, text: string}[]}[], routes?: {route: string, feature: string}[]}} spec
 * @param {{stem: string, rel: string, rows: Record<string, unknown>[]}[]|((feature: string) => {stem: string, rel: string, rows: Record<string, unknown>[]}[])} fixtures
 *   From basePage arrayFixtures: one list for every feature, or (#935 feature modules) the list a feature sees.
 * @param {any[]} [recipes] The worked examples to apply (default: examples/*.json).
 * @returns {{points: {id: string, feature: string, block: string|null, atom: string|null, decided: boolean, reason: string}[], blocks: Record<string, any>}}
 */
export function pointBlocks(spec, fixtures, recipes = RECIPES) {
  const fixturesOf = typeof fixtures === 'function' ? fixtures : () => fixtures;
  /** @type {{id: string, feature: string, block: string|null, atom: string|null, decided: boolean, reason: string}[]} */
  const points = [];
  const all = spec.features.flatMap((f) => f.points.map((p) => ({ ...p, feature: f.name, f })));
  const textOf = (f) => `${f.story}\n${f.points.map((p) => p.text).join('\n')}`;
  const mark = (p, block, atom, decided, reason) => points.push({ id: p.id, feature: p.feature, block, atom, decided, reason });
  const routeOf = (feature) => (spec.routes ?? []).filter((r) => r.feature === feature).map((r) => r.route);
  /** @type {Record<string, any>} */
  const blocks = {};

  // filter-sort: the list page's filter, search and no-match text.
  for (const f of spec.features) {
    const filterP = f.points.find((p) => /\bfilter labelled "[^"]+" offers /i.test(p.text));
    const searchP = f.points.find((p) => /\bsearch box labelled "[^"]+" filters the list by /i.test(p.text));
    if (!filterP && !searchP) continue;
    const fx = fixtureFor(fixturesOf(f.name), f.name, textOf(f), 'list');
    const row = fx?.rows[0] ?? {};
    let filter = null;
    if (filterP && fx) {
      const m = /\bfilter labelled "([^"]+)" offers ([^;.]+)/i.exec(filterP.text);
      const key = m && Object.keys(row).find((k) => camel(k) === camel(m[1]) && typeof row[k] === 'string');
      const opts = m ? plainList(m[2]) : [];
      const all = opts.find((o) => /^all$/i.test(o));
      const values = opts.filter((o) => o !== all);
      const have = key ? [...new Set(fx.rows.map((r) => r[key]))] : [];
      if (key && all && values.length === have.length && values.every((v) => have.includes(v))) filter = { key, label: m[1], all, values };
    }
    let search = null;
    if (searchP && fx) {
      const m = /\bsearch box labelled "([^"]+)" filters the list by ([a-z ]+?)(?: as you type|,|\.|$)/i.exec(searchP.text);
      const key = m && (m[2].match(/[a-z]+/gi) ?? []).reverse().find((w) => typeof row[w] === 'string');
      if (key) search = { label: m[1], key };
    }
    const emptyP = f.points.find((p) => /\bno \w+ match(es)?\b/i.test(p.text));
    const empty = emptyP ? (/\bno \w+ match(?:es)?\b[^"]*"([^"]+)"/i.exec(emptyP.text)?.[1] ?? null) : null;
    const route = routeOf(f.name).find((r) => !r.includes(':')) ?? null;
    const ok = Boolean(fx && route && (filter || search));
    if (ok) blocks.filter = { feature: f.name, route, fixture: fx, filter, search, empty };
    const why = !fx ? 'the spec does not say which fixture the list shows' : !route ? 'the route table gives the list no route' : '';
    if (filterP) mark(filterP, 'filter-sort', 'filter-sort', ok && Boolean(filter), filter && ok ? 'filter-sort: a Select of the quoted options over the fixture field of that name' : why || 'the options or the field do not match the fixture');
    if (searchP) mark(searchP, 'filter-sort', 'filter-sort', ok && Boolean(search), search && ok ? `filter-sort: a search box over the ${search.key} field, ignoring case` : why || 'the field it searches is not a fixture field');
    if (emptyP) mark(emptyP, 'filter-sort', 'filter-sort', ok && Boolean(empty), empty && ok ? 'filter-sort: the quoted text as the list\'s empty state' : 'no quoted no-match text, or no filter or search to empty the list');
  }

  // #933: the recipes (examples/*.json), each a worked example of the mapping, applied where its anchor matches.
  /** @type {Record<string, {ok: boolean, feature: string}>} */
  const applied = {};
  for (const rc of recipes) {
    if (rc.needs && !applied[rc.needs]) continue;
    const roleTest = (role) => (p) => role.find.every((r) => rx(r).test(p.text));
    const anchor = all.find(roleTest(rc.roles[0]));
    if (!anchor) continue;
    const f = anchor.f;
    const own = all.filter((p) => p.feature === f.name);
    /** @type {Record<string, any>} */
    const pts = {};
    /** @type {Record<string, string>} */
    const inp = {};
    for (const role of rc.roles) {
      const test = roleTest(role);
      const p = role === rc.roles[0] ? anchor : role.scope === 'all' ? all.find(test) : role.scope === 'feature' ? own.find(test) : (own.find(test) ?? all.find(test));
      if (!p) continue;
      pts[role.role] = p;
      for (const r of role.extract ?? []) {
        const m = rx(r).exec(p.text);
        for (const [k, v] of Object.entries(m?.groups ?? {})) if (v !== undefined && !(k in inp)) inp[k] = v;
      }
    }
    const route = inp.route ? lineRoute(inp.route) : '';
    /** @type {Record<string, unknown>} */
    let have = { ...inp, route };
    let block = null;
    if (rc.kind === 'selection') {
      const fx = fieldsOf(fixtureFor(fixturesOf(f.name), f.name, textOf(f)), rx(rc.fixtureNumber));
      const tl = inp.totals ? quotedList(inp.totals) : [];
      const rule = inp.fee ? { fee: Number(inp.fee), freeFrom: Number(inp.freeFrom) } : null;
      const add = inp.status ? { qtyLabel: inp.qtyLabel, def: Number(inp.def), min: Number(inp.min), button: inp.button, status: inp.status, feature: pts.add.feature } : null;
      have = { ...have, fixture: fx, totals3: tl.length === 3 };
      block = { kind: rc.kind, feature: f.name, route, fixture: fx, heading: inp.heading, qtyPrefix: inp.qtyPrefix, removePrefix: inp.removePrefix ?? null,
        labels: tl.length === 3 ? tl : rc.defaultLabels, rule, empty: inp.empty,
        next: inp.nextLabel ? { label: inp.nextLabel, route: lineRoute(inp.nextRoute) } : null,
        link: inp.linkLabel ? { label: inp.linkLabel, route: lineRoute(inp.linkRoute) } : null, add };
    } else if (rc.kind === 'submit') {
      const need = applied[rc.needs]?.ok ? blocks[rc.needs] : null;
      const labels = quotedList(inp.labels ?? '');
      const { fields, checkbox, mapped } = formFields(labels, inp.boxLabel ?? null, inp.messages ? quotedList(inp.messages) : [], Boolean(pts.messages));
      have = { ...have, needs: need, labels: labels.length, mapped };
      const next = lineRoute(inp.next ?? '');
      block = { kind: rc.kind, needs: rc.needs, feature: f.name, route, heading: inp.heading, fields, checkbox, button: inp.button, next, empty: inp.empty ?? need?.empty,
        done: inp.doneHeading ? { route: next, heading: inp.doneHeading, numberPrefix: inp.numberPrefix, link: { label: inp.doneLinkLabel, route: lineRoute(inp.doneLinkRoute) } } : null };
    }
    const ok = Boolean(block) && rc.ok.every((k) => Boolean(have[k]));
    applied[rc.block] = { ok, feature: f.name };
    if (ok) blocks[rc.block] = { ...block, recipe: rc, pts };
    const why = fill((rc.whyNot.find((w) => !w.unless || !have[w.unless]) ?? rc.whyNot.at(-1)).text, { needs: rc.needs ? applied[rc.needs]?.feature : null, feature: f.name });
    const marked = new Set();
    for (const role of rc.roles) {
      const p = pts[role.role];
      if (!p || marked.has(p.id)) continue;
      marked.add(p.id);
      const decided = ok && (role.requires ?? []).every((k) => Boolean(have[k]));
      const reason = role.missing ? (ok && (role.explain ?? []).every((k) => Boolean(have[k])) ? role.decided : role.missing) : ok ? role.decided : why;
      mark(p, rc.block, role.atom ?? null, decided, reason);
    }
  }
  return { points, blocks };
}

/**
 * The atom and block steps for the project at `root` (see the header).
 * @param {string} root Project root.
 * @param {{spec: any, planned?: {tool: string, args?: any, state?: string}[]}} o
 * @returns {{steps: any[], skipped: {kind: string, feature: string, reason: string}[], open: {point: string, feature: string, reason: string}[], claimed: string[], claimedRoutes: string[]}}
 */
export function atomSteps(root, { spec, planned = [] }) {
  const { library: lib, features } = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  // #935: each feature sees its own fixtures, those its imported features export from their index, then the library's.
  const seen = new Map();
  const fixturesOf = (name) => { if (!seen.has(name)) seen.set(name, arrayFixtures(root, { library: lib, features }, name)); return seen.get(name); };
  const { points, blocks } = pointBlocks(spec, fixturesOf);
  const open = planned.filter((s) => !['done', 'cancelled', 'skipped'].includes(String(s.state ?? '')));
  const disk = (rel) => readOrNull(path.join(root, rel));
  const pages = featurePages(root).map((file) => ({ file, src: disk(file) ?? '' }));
  const pageAt = (route) => pages.find((p) => /@line-route\s+(\S+)/.exec(p.src)?.[1] === route) ?? null;
  const head = (src) => `${src.split('\n').filter((l, i, a) => a.slice(0, i + 1).every((x) => /^\s*\/\/\s*@line-/.test(x))).join('\n')}\n`;
  const stub = (src) => !/\buse[A-Z]\w*\(/.test(src);
  /** @type {any[]} */
  const steps = [];
  /** @type {{kind: string, feature: string, reason: string}[]} */
  const skipped = [];
  const ids = (block) => points.filter((p) => p.block === block && p.decided).map((p) => p.id);
  const has = (rel) => disk(rel) !== null;
  const queued = (tool, key) => open.some((s) => s.tool === tool && (s.args?.file === key || s.args?.atom === key || s.args?.route === key || (tool === 'line.setLayoutSlot' && s.args?.slot === key) || (tool === 'line.baseOn' && `${s.args?.feature}/${s.args?.name}` === key)));
  const skip = (feature, reason) => skipped.push({ kind: 'behaviour', feature, reason });
  const push = (step, key) => { if (queued(step.tool, key)) skip(step.feature, `the plan already has ${step.tool} for ${key}`); else steps.push(step); };
  const useAtom = (atom, feature, point, why) => {
    const rel = `${lib}/atoms/${atom}.ts`;
    const now = disk(rel);
    if (now === atomSource(atom)) return true;
    if (now !== null) { skip(feature, `${rel} differs from the shipped atom`); return true; }
    push({ tool: 'line.useAtom', args: { atom }, kind: 'atom', feature, point, why }, atom);
    return false;
  };
  /** A whole new file: written when missing; on disk = done; true when the file is on disk. */
  const newFile = (rel, code, feature, point, why) => {
    const now = disk(rel);
    if (now !== null) { if (now !== code && now !== `${code}\n`) skip(feature, `${rel} exists and was changed since the seed wrote it`); return true; }
    push({ tool: 'line.setCode', args: { file: rel, code }, kind: 'block', feature, point, why }, rel);
    return false;
  };
  /** A page rewrite at the hash it has now, when it is still the stub line.baseOn wrote. */
  const rewrite = (page, code, feature, point, why) => {
    if (!code) { skip(feature, `${page.file} is not the page the seed based it on, so the builder rewrites it`); return; }
    if (page.src === code) return;
    push({ tool: 'line.setCode', args: { file: page.file, code, contentHash: hashOf(page.src) }, kind: 'block', feature, point, why }, page.file);
  };
  const waits = (feature, what) => skip(feature, `waits until ${what} lands`);

  const fb = blocks.filter;
  if (fb) {
    const page = pageAt(fb.route);
    const fn = `filter${fb.fixture.stem[0].toUpperCase()}${camel(fb.fixture.stem).slice(1)}`;
    const ucFile = `${features}/${fb.feature}/usecases/${fn}.ts`;
    const says = ids('filter-sort').join(', ');
    const a = useAtom('filter-sort', fb.feature, says, `${says}: the list filters and searches its rows, which is the filter-sort atom; copy it into the library atoms.`);
    const u = newFile(ucFile, B.filterUsecase({ file: ucFile, atomFile: `${lib}/atoms/filter-sort.ts`, fn, filterKey: fb.filter?.key ?? null, searchKey: fb.search?.key ?? null }), fb.feature, says, `${says}: ${fn} filters the ${fb.fixture.stem} by the filter and the search through the filter-sort atom.`);
    if (!page) waits(fb.feature, `the page at ${fb.route}`);
    else if (!a || !u) waits(fb.feature, `${ucFile} and the filter-sort atom`);
    else if (!page.src.includes(`'${B.spec(page.file, ucFile)}'`)) {
      rewrite(page, stub(page.src) ? B.catalogWithFilters(page.src, { file: page.file, lib, usecaseFile: ucFile, fn, filter: fb.filter, search: fb.search, empty: fb.empty }) : null, fb.feature, says,
        `${says}: ${posix.basename(page.file)} gets ${[fb.filter ? `the "${fb.filter.label}" filter` : '', fb.search ? `the "${fb.search.label}" search` : '', fb.empty ? `"${fb.empty}" when nothing matches` : ''].filter(Boolean).join(', ')}.`);
    }
  }

  /** The usecase file of each selection block whose usecase is on disk. */
  /** @type {Record<string, string>} */
  const ready = {};
  const roleIds = (pts) => Object.fromEntries(Object.entries(pts).map(([k, p]) => [`#${k}`, p.id]));
  for (const [name, sb] of Object.entries(blocks).filter(([, b]) => b.kind === 'selection')) {
    const rc = sb.recipe; const T = rc.templates; const W = rc.steps;
    const vars = { lib, features, feature: sb.feature, ...roleIds(sb.pts) };
    const file = (k) => fill(rc.files[k], vars);
    const svc = file('service');
    const uc = file('usecase');
    let ucReady = false;
    const s = newFile(svc, B[T.service]({ storageKey: rc.storageKey }), sb.feature, sb.pts.kept?.id ?? null, fill(W.service, { ...vars, ids: ids(name).join(', ') }));
    if (s) {
      const rule = sb.rule ? fill(W.rule, { fee: sb.rule.fee.toFixed(2), freeFrom: sb.rule.freeFrom.toFixed(2) }) : '';
      ucReady = newFile(uc, B[T.usecase]({ file: uc, serviceFile: svc, fixture: sb.fixture, rule: sb.rule }), sb.feature, sb.pts.totals?.id ?? null, fill(W.usecase, { ...vars, rule }));
    } else waits(sb.feature, svc);
    if (!ucReady) continue;
    ready[name] = uc;
    if (sb.link) {
      const linkFile = file('link');
      const l = newFile(linkFile, B[T.link]({ file: linkFile, usecaseFile: uc, label: sb.link.label, route: sb.link.route }), sb.feature, sb.pts.link.id, fill(W.link, { ...vars, linkLabel: sb.link.label, linkRoute: sb.link.route }));
      const layoutRel = appLayoutFile(root);
      const parsed = parseAppLayout(disk(layoutRel) ?? '');
      const nav = parsed?.slots.nav ?? [];
      if (!parsed) skip(sb.feature, fill(W.notShell, { layout: layoutRel }));
      else if (!l) waits(sb.feature, linkFile);
      else if (!nav.some((e) => e.startsWith(`${linkFile}#`))) push({ tool: 'line.setLayoutSlot', args: { slot: 'nav', components: [...nav, `${linkFile}#${rc.files.linkExport}`] }, kind: 'block', feature: sb.feature, point: sb.pts.link.id, why: fill(W.nav, vars) }, 'nav');
    }
    if (sb.add) {
      const addFile = file('add');
      const pid = points.find((p) => p.block === name && p.feature === sb.add.feature)?.id ?? null;
      const av = { ...vars, ...sb.add, '#add': pid };
      const ok = newFile(addFile, B[T.add]({ file: addFile, lib, usecaseFile: uc, ...sb.add }), sb.add.feature, pid, fill(W.add, av));
      const detail = pages.find((p) => p.file.split('/').at(-3) === sb.add.feature && /@line-route\s+\S*:/.test(p.src));
      if (!detail) waits(sb.add.feature, `the detail page of ${sb.add.feature}`);
      else if (!ok) waits(sb.add.feature, addFile);
      else if (!detail.src.includes(`<${rc.files.addTag} `)) rewrite(detail, stub(detail.src) ? B[T.detail](detail.src, { file: detail.file, componentFile: addFile }) : null, sb.add.feature, pid, fill(W.detail, { ...av, page: posix.basename(detail.file), addFeature: sb.add.feature }));
    }
    const page = pageAt(sb.route);
    if (!page) waits(sb.feature, `the page at ${sb.route}`);
    else {
      const code = B[T.page]({ head: head(page.src), file: page.file, lib, usecaseFile: uc, heading: sb.heading, qtyPrefix: sb.qtyPrefix, removePrefix: sb.removePrefix, labels: sb.labels, empty: sb.empty, next: sb.next });
      const own = points.filter((p) => p.block === name && p.decided && p.feature === sb.feature && p.id !== sb.pts.link?.id).map((p) => p.id).join(', ');
      if (page.src !== code) rewrite(page, stub(page.src) ? code : null, sb.feature, own, fill(W.page, { ...vars, own, page: posix.basename(page.file), heading: sb.heading }));
    }
  }

  for (const [name, kb] of Object.entries(blocks).filter(([, b]) => b.kind === 'submit')) {
    const sb = blocks[kb.needs];
    if (!ready[kb.needs]) continue;
    const rc = kb.recipe; const T = rc.templates; const W = rc.steps;
    const vars = { lib, features, feature: kb.feature, ...roleIds(kb.pts) };
    const svc = fill(rc.files.service, vars);
    const uc = fill(rc.files.usecase, vars);
    const atom = rc.roles[0].atom;
    const says = ids(name).join(', ');
    const a = useAtom(atom, kb.feature, says, fill(W.atom, { ...vars, ids: says }));
    const s = newFile(svc, B[T.service](), kb.feature, kb.pts.place?.id ?? null, fill(W.service, vars));
    const fieldLabels = `${kb.fields.map((f) => f.label).join(', ')}${kb.checkbox ? `, ${kb.checkbox.label}` : ''}`;
    const u = a && s ? newFile(uc, B[T.usecase]({ file: uc, atomFile: `${lib}/atoms/${atom}.ts`, serviceFile: svc, fields: kb.fields, checkbox: kb.checkbox }), kb.feature, kb.pts.messages?.id ?? null, fill(W.usecase, { ...vars, fieldLabels }))
      : (waits(kb.feature, `${svc} and the ${atom} atom`), false);
    const page = pageAt(kb.route);
    if (!page) waits(kb.feature, `the page at ${kb.route}`);
    else if (u) {
      const code = B[T.page]({ head: head(page.src), file: page.file, lib, selectionUsecaseFile: ready[kb.needs], usecaseFile: uc, heading: kb.heading, button: kb.button, fields: kb.fields, checkbox: kb.checkbox, labels: sb.labels, empty: kb.empty, listRoute: blocks.filter?.route ?? '/', next: kb.next });
      if (page.src !== code) rewrite(page, stub(page.src) ? code : null, kb.feature, says, fill(W.page, { ...vars, page: posix.basename(page.file), heading: kb.heading }));
    }
    if (kb.done) {
      const c = kb.done;
      const conf = pageAt(c.route);
      const pname = `${camel(c.route.split('/').filter(Boolean).at(-1) ?? kb.feature).replace(/^./, (x) => x.toUpperCase())}Page`;
      const file = `${features}/${kb.feature}/pages/${pname}.tsx`;
      const point = kb.pts.confirm?.id ?? null;
      if (!conf) {
        if (!has(file)) push({ tool: 'line.baseOn', args: { libraryId: 'pages/DetailPage', feature: kb.feature, name: pname }, kind: 'page', feature: kb.feature, point, route: c.route, base: 'pages/DetailPage', why: fill(W.doneBase, { ...vars, name: pname }) }, `${kb.feature}/${pname}`);
        else push({ tool: 'line.addRoute', args: { route: c.route, page: file }, kind: 'route', feature: kb.feature, point, route: c.route, why: fill(W.doneRoute, { ...vars, route: c.route, name: pname }) }, c.route);
      } else if (u) {
        const code = B[T.done]({ head: head(conf.src), file: conf.file, lib, usecaseFile: uc, heading: c.heading, numberPrefix: c.numberPrefix, link: c.link });
        if (conf.src !== code) rewrite(conf, stub(conf.src) ? code : null, kb.feature, point, fill(W.done, { ...vars, page: posix.basename(conf.file), doneHeading: c.heading, doneLinkLabel: c.link.label }));
      }
    }
  }
  const covered = new Set(['page']);
  return { steps, skipped, open: points.filter((p) => !p.decided && !covered.has(String(p.block))).map((p) => ({ point: p.id, feature: p.feature, reason: p.reason })), claimed: points.map((p) => p.id),
    claimedRoutes: Object.values(blocks).map((b) => b.done?.route).filter(Boolean) };
}
