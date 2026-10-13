// #919 -- spec points -> atom steps: the behaviour points a block fully decides, wired from @line/atoms and the small
// blocks in blocks.mjs, after the feature, page and route steps (specSteps.mjs). Deterministic, no LLM, writes nothing.
//
//   pointBlocks(spec, fixtures)        each point -> {id, feature, block, atom, decided, reason}, read from the point's
//                                      quoted labels, messages and routes plus the fixture's fields; and each block's inputs
//   atomSteps(root, {spec, planned})   the steps (line.useAtom, line.setCode, line.setLayoutSlot, line.baseOn, line.addRoute)
//                                      whose inputs are all decided and whose files are on disk, in dependency order;
//                                      `open`: the points left for the model, each with why
// Blocks: filter-sort (a "filter labelled", a "search box labelled", the no-match text; atom filter-sort; no debounce:
// the spec gives no delay and the list is client-side), cart (a quantity field per line, the totals and shipping rule,
// the empty text, the link and add control; no atom fits a browser cart, so a small store block), checkout (the fields
// and checkbox, their messages as a schema; atom validated-submit; a mock order service; the confirmation page).
// Idempotent: a file already holding the block's code, or a page already rewritten, is skipped with why.
import fs from 'node:fs';
import path from 'node:path';
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
const ID_KEYS = ['id', 'slug', 'key', 'sku', 'code'];
const NAME_KEYS = ['name', 'title', 'label'];

/** The fixture's id, name and price fields (strings, a string, a number), or null when one is missing. */
function fieldsOf(fx) {
  if (!fx) return null;
  const row = fx.rows[0] ?? {};
  const keys = Object.keys(row);
  const idKey = ID_KEYS.find((k) => typeof row[k] === 'string');
  const nameKey = NAME_KEYS.find((k) => typeof row[k] === 'string');
  const priceKey = keys.find((k) => typeof row[k] === 'number' && /(price|cost|amount)$/i.test(k));
  return idKey && nameKey && priceKey ? { rel: fx.rel, idKey, nameKey, priceKey, rows: fx.rows } : null;
}

/**
 * Every point's block, and each block's inputs, from the point text and the fixtures.
 * @param {{features: {name: string, story: string, points: {id: string, text: string}[]}[], routes?: {route: string, feature: string}[]}} spec
 * @param {{stem: string, rel: string, rows: Record<string, unknown>[]}[]} fixtures From basePage arrayFixtures.
 * @returns {{points: {id: string, feature: string, block: string|null, atom: string|null, decided: boolean, reason: string}[], blocks: Record<string, any>}}
 */
export function pointBlocks(spec, fixtures) {
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
    const fx = fixtureFor(fixtures, f.name, textOf(f), 'list');
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

  // cart: the page with a quantity field per line; its totals, empty text, link, checkout link; the add control.
  const cartP = all.find((p) => /\bquantity field labelled "[^"<]*<[^>]+>"/i.test(p.text) && /\bpage at `\//.test(p.text));
  if (cartP) {
    const f = cartP.f;
    const pt = (re) => f.points.find((p) => re.test(p.text)) ?? all.find((p) => re.test(p.text));
    const fx = fieldsOf(fixtureFor(fixtures, f.name, textOf(f)));
    const route = lineRoute(/\bpage at `(\/[^`\s]*)`/.exec(cartP.text)?.[1] ?? '');
    const heading = /\bmain heading "([^"]+)"/.exec(cartP.text)?.[1];
    const qtyPrefix = /\bquantity field labelled "([^"<]*)<[^>]+>"/i.exec(cartP.text)?.[1];
    const lineP = pt(/\bquantity of 0 removes the line\b/i);
    const removeP = pt(/\bbutton "[^"<]*<[^>]+>" removes\b/i);
    const removePrefix = removeP ? /\bbutton "([^"<]*)<[^>]+>" removes\b/i.exec(removeP.text)?.[1] ?? null : null;
    const totalsP = pt(/\bshows "[^"]+", "[^"]+" and "[^"]+"/);
    const tl = totalsP ? quotedList(/\bshows ("[^"]+", "[^"]+" and "[^"]+")/.exec(totalsP.text)?.[1] ?? '') : [];
    const rule = totalsP ? /\bshipping is \$(\d+(?:\.\d+)?), or \$0(?:\.00)? when the subtotal is \$(\d+(?:\.\d+)?) or more\b/i.exec(totalsP.text) : null;
    const labels = tl.length === 3 ? { subtotal: tl[0], shipping: tl[1], total: tl[2] } : { subtotal: 'Subtotal', shipping: null, total: 'Total' };
    const emptyP = pt(/\bempty cart says "[^"]+"/i);
    const empty = emptyP ? /\bempty cart says "([^"]+)"/i.exec(emptyP.text)?.[1] : null;
    const keptP = pt(/\bkept after the page is reloaded\b/i);
    const toCheckoutP = pt(/"[^"]+" link or button opens `\/[^`]*`/);
    const checkout = toCheckoutP ? (([, label, r]) => ({ label, route: lineRoute(r) }))(/"([^"]+)" link or button opens `(\/[^`]*)`/.exec(toCheckoutP.text)) : null;
    const linkP = pt(/\blink whose name starts with "[^"]+"[^;]*number of items[^;]*;\s*it opens `\/[^`]*`/i);
    const link = linkP ? (([, label, r]) => ({ label, route: lineRoute(r) }))(/\blink whose name starts with "([^"]+)"[^;]*;\s*it opens `(\/[^`]*)`/i.exec(linkP.text)) : null;
    const addP = all.find((p) => /\bfield labelled "[^"]+" \(default \d+, at least \d+\) and an? "[^"]+" button add/i.test(p.text));
    const am = addP ? /\bfield labelled "([^"]+)" \(default (\d+), at least (\d+)\) and an? "([^"]+)" button add[^]*?\bsays "([^"]+)"/i.exec(addP.text) : null;
    const add = am ? { qtyLabel: am[1], def: Number(am[2]), min: Number(am[3]), button: am[4], status: am[5], feature: addP.feature } : null;
    const ok = Boolean(fx && route && heading && qtyPrefix && empty);
    const why = !fx ? 'no fixture has the id, name and price a cart line needs' : 'the cart page point does not quote its heading, quantity label and empty text';
    if (ok) blocks.cart = { feature: f.name, route, fixture: fx, heading, qtyPrefix, removePrefix, labels, shipping: rule ? { fee: Number(rule[1]), freeFrom: Number(rule[2]) } : null, empty, checkout, link, add };
    mark(cartP, 'cart', null, ok, ok ? 'cart block: a line per item with its quantity field and line total on the library list page' : why);
    if (lineP && lineP !== cartP) mark(lineP, 'cart', null, ok && Boolean(totalsP), ok ? 'cart block: a quantity change updates the store and every total; 0 removes the line' : why);
    if (removeP) mark(removeP, 'cart', null, ok && Boolean(removePrefix), ok ? 'cart block: a Remove button per line' : why);
    if (totalsP && totalsP !== lineP) mark(totalsP, 'cart', null, ok && Boolean(rule) && tl.length === 3, ok && rule ? 'cart block: the quoted totals and the shipping rule as written' : 'the shipping rule is not in the form "shipping is $X, or $0.00 when the subtotal is $Y or more"');
    if (emptyP && emptyP !== cartP) mark(emptyP, 'cart', null, ok, ok ? 'cart block: the quoted empty text, and no checkout when empty' : why);
    if (keptP) mark(keptP, 'cart', null, ok, ok ? 'cart block: the store keeps the lines in localStorage' : why);
    if (toCheckoutP && f.points.includes(toCheckoutP)) mark(toCheckoutP, 'cart', null, ok && Boolean(checkout), ok ? 'cart block: the quoted checkout link' : why);
    if (linkP) mark(linkP, 'cart', null, ok && Boolean(link), ok ? 'cart block: a CartLink "<label> (<count>)" in the app shell nav' : why);
    if (addP) mark(addP, 'cart', null, ok && Boolean(add), ok && add ? 'cart block: an AddToCart control (quantity, button, status) beside the detail page' : 'the add point does not quote its field, default, minimum, button and status');
  }

  // checkout: the form page (fields, checkbox, messages), the summary, placing the order, the confirmation, the empty cart.
  const formP = all.find((p) => /\bfields labelled "/.test(p.text) && /\bpage at `\//.test(p.text));
  if (formP) {
    const f = formP.f;
    const pt = (re) => f.points.find((p) => re.test(p.text));
    const route = lineRoute(/\bpage at `(\/[^`\s]*)`/.exec(formP.text)?.[1] ?? '');
    const heading = /\bmain heading "([^"]+)"/.exec(formP.text)?.[1];
    const labels = quotedList(/\bfields labelled ((?:"[^"]+"(?:,\s*|\s+and\s+)?)+)/.exec(formP.text)?.[1] ?? '');
    const boxLabel = /\bcheckbox labelled "([^"]+)"/.exec(formP.text)?.[1] ?? null;
    const msgP = pt(/\bshows a message for each invalid field \(/i);
    const messages = msgP ? quotedList(/\(([^)]*)\)/.exec(msgP.text.slice(msgP.text.indexOf('message for each')))?.[1] ?? '') : [];
    const words = (s) => (String(s).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !['i', 'a', 'the', 'to', 'is', 'be', 'must', 'enter', 'valid'].includes(w));
    /** @type {{key: string, label: string, rule: string, message: string, digits?: number}[]} */
    const fields = labels.map((label) => ({ key: camel(label), label, rule: 'required', message: `${label} is required` }));
    let checkbox = boxLabel ? { key: camel(words(boxLabel).at(-1) ?? 'accepted'), label: boxLabel, message: '' } : null;
    let mapped = Boolean(msgP);
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
    const summaryP = pt(/\border summary with each product, its quantity and the order total\b/i);
    const placeP = pt(/"[^"]+" button places the order through a mock order service, empties the cart and opens `\/[^`]*`/);
    const pm = placeP ? /"([^"]+)" button places the order through a mock order service, empties the cart and opens `(\/[^`]*)`/.exec(placeP.text) : null;
    const confP = pt(/\bconfirmation page has the main heading "[^"]+"/);
    const cm = confP ? /\bconfirmation page has the main heading "([^"]+)"[^]*?\border number \(text starting "([^"]+)"\)[^]*?\blink "([^"]+)" to `(\/[^`]*)`/.exec(confP.text) : null;
    const emptyP = pt(/\bwith an empty cart says "[^"]+" with a link to the products\b/i);
    const em = emptyP ? /\bwith an empty cart says "([^"]+)"/i.exec(emptyP.text) : null;
    const cart = blocks.cart;
    const ok = Boolean(cart && route && heading && labels.length && mapped && pm);
    const why = !cart ? 'the cart block is not seeded, and the checkout reads the cart' : !pm ? 'no point quotes the button that places the order and the route it opens' : 'a message does not name its field, or a rule is not one of required, valid email, N digits';
    if (ok) blocks.checkout = { feature: f.name, route, heading, fields, checkbox, button: pm?.[1], next: lineRoute(pm?.[2] ?? ''), empty: em?.[1] ?? cart.empty,
      confirm: cm ? { route: lineRoute(pm?.[2] ?? ''), heading: cm[1], orderPrefix: cm[2], link: { label: cm[3], route: lineRoute(cm[4]) } } : null };
    mark(formP, 'checkout', 'validated-submit', ok, ok ? 'validated-submit: the quoted fields and checkbox on the library form page' : why);
    if (msgP) mark(msgP, 'checkout', 'validated-submit', ok, ok ? 'validated-submit: each quoted message as its field\'s rule (aria-invalid by TextField)' : why);
    if (summaryP) mark(summaryP, 'checkout', null, ok, ok ? 'cart block: the cart lines and total beside the form' : why);
    if (placeP) mark(placeP, 'checkout', 'validated-submit', ok, ok ? 'validated-submit then a mock order service; the cart is cleared and the route opened' : why);
    if (confP) mark(confP, 'checkout', null, ok && Boolean(cm), ok && cm ? 'the confirmation page on the library detail page, from the last order' : 'the confirmation point does not quote its heading, order-number text and link');
    if (emptyP) mark(emptyP, 'checkout', null, ok && Boolean(em), ok ? 'the cart\'s empty text and a link to the products instead of the form' : why);
  }
  return { points, blocks };
}

/**
 * The atom and block steps for the project at `root` (see the header).
 * @param {string} root Project root.
 * @param {{spec: any, planned?: {tool: string, args?: any, state?: string}[]}} o
 * @returns {{steps: any[], skipped: {kind: string, feature: string, reason: string}[], open: {point: string, feature: string, reason: string}[]}}
 */
export function atomSteps(root, { spec, planned = [] }) {
  const { library: lib, features } = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const { points, blocks } = pointBlocks(spec, arrayFixtures(root, { library: lib }));
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
  const SPEC_TEXT = (id) => spec.features.flatMap((f) => f.points).find((p) => p.id === id)?.text ?? '';
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

  const cb = blocks.cart;
  let cartUc = false;
  const ucCart = `${lib}/usecases/useCart.ts`;
  if (cb) {
    const svc = `${lib}/services/cart.ts`;
    const s = newFile(svc, B.cartService({ storageKey: 'line-cart' }), cb.feature, 'CART-7', `${ids('cart').join(', ')}: the cart lives in the browser (localStorage) as lines {id, qty}, shared by every feature, so it is a library service.`);
    if (s) cartUc = newFile(ucCart, B.cartUsecase({ file: ucCart, serviceFile: svc, fixture: cb.fixture, shipping: cb.shipping }), cb.feature, 'CART-5', `The cart's items, count and totals${cb.shipping ? ` (shipping $${cb.shipping.fee.toFixed(2)}, free from $${cb.shipping.freeFrom.toFixed(2)})` : ''} for pages: useCart.`);
    else waits(cb.feature, svc);
    if (cartUc) {
      if (cb.link) {
        const linkFile = `${lib}/components/CartLink.tsx`;
        const l = newFile(linkFile, B.cartLink({ file: linkFile, usecaseFile: ucCart, label: cb.link.label, route: cb.link.route }), cb.feature, 'CART-1', `CART-1: a link "${cb.link.label} (<count>)" to ${cb.link.route}, for every page.`);
        const layoutRel = appLayoutFile(root);
        const parsed = parseAppLayout(disk(layoutRel) ?? '');
        const nav = parsed?.slots.nav ?? [];
        if (!parsed) skip(cb.feature, `${layoutRel} is not Line's app shell, so the cart link is the builder's call`);
        else if (!l) waits(cb.feature, linkFile);
        else if (!nav.some((e) => e.startsWith(`${linkFile}#`))) push({ tool: 'line.setLayoutSlot', args: { slot: 'nav', components: [...nav, `${linkFile}#CartLink`] }, kind: 'block', feature: cb.feature, point: 'CART-1', why: 'CART-1: every page shows the cart link: the app shell\'s nav.' }, 'nav');
      }
      if (cb.add) {
        const addFile = `${lib}/components/AddToCart.tsx`;
        const pid = points.find((p) => p.block === 'cart' && p.feature === cb.add.feature)?.id ?? null;
        const ok = newFile(addFile, B.addToCart({ file: addFile, lib, usecaseFile: ucCart, ...cb.add }), cb.add.feature, pid, `${pid}: "${cb.add.qtyLabel}" (default ${cb.add.def}, at least ${cb.add.min}) and "${cb.add.button}" add to the cart and say "${cb.add.status}".`);
        const detail = pages.find((p) => p.file.split('/').at(-3) === cb.add.feature && /@line-route\s+\S*:/.test(p.src));
        if (!detail) waits(cb.add.feature, `the detail page of ${cb.add.feature}`);
        else if (!ok) waits(cb.add.feature, addFile);
        else if (!detail.src.includes('<AddToCart ')) rewrite(detail, stub(detail.src) ? B.productWithAdd(detail.src, { file: detail.file, componentFile: addFile }) : null, cb.add.feature, pid, `${pid}: ${posix.basename(detail.file)} shows AddToCart beside the ${cb.add.feature}.`);
      }
      const page = pageAt(cb.route);
      if (!page) waits(cb.feature, `the page at ${cb.route}`);
      else {
        const code = B.cartPage({ head: head(page.src), file: page.file, lib, usecaseFile: ucCart, heading: cb.heading, qtyPrefix: cb.qtyPrefix, removePrefix: cb.removePrefix, labels: cb.labels, empty: cb.empty, checkout: cb.checkout });
        const own = points.filter((p) => p.block === 'cart' && p.decided && p.feature === cb.feature && !/link whose name/i.test(SPEC_TEXT(p.id))).map((p) => p.id).join(', ');
        if (page.src !== code) rewrite(page, stub(page.src) ? code : null, cb.feature, own, `${own}: ${posix.basename(page.file)} lists the cart's lines with their quantity fields and totals ("${cb.heading}").`);
      }
    }
  }

  const kb = blocks.checkout;
  if (kb && cartUc) {
    const svc = `${features}/${kb.feature}/services/orders.ts`;
    const uc = `${features}/${kb.feature}/usecases/placeOrder.ts`;
    const says = ids('checkout').join(', ');
    const a = useAtom('validated-submit', kb.feature, says, `${says}: the checkout form is validated against its rules before the order is placed, which is the validated-submit atom; copy it into the library atoms.`);
    const s = newFile(svc, B.ordersService(), kb.feature, 'CHK-4', 'CHK-4: the order is placed through a mock order service in the app (no network).');
    const u = a && s ? newFile(uc, B.orderUsecase({ file: uc, atomFile: `${lib}/atoms/validated-submit.ts`, serviceFile: svc, fields: kb.fields, checkbox: kb.checkbox }), kb.feature, 'CHK-2', `CHK-2: the form's rules (${kb.fields.map((f) => f.label).join(', ')}${kb.checkbox ? `, ${kb.checkbox.label}` : ''}) as a schema for the validated-submit atom, then the order service.`) : (waits(kb.feature, `${svc} and the validated-submit atom`), false);
    const page = pageAt(kb.route);
    if (!page) waits(kb.feature, `the page at ${kb.route}`);
    else if (u) {
      const code = B.checkoutPage({ head: head(page.src), file: page.file, lib, cartUsecaseFile: ucCart, usecaseFile: uc, heading: kb.heading, button: kb.button, fields: kb.fields, checkbox: kb.checkbox, labels: cb.labels, empty: kb.empty, productsRoute: blocks.filter?.route ?? '/', next: kb.next });
      if (page.src !== code) rewrite(page, stub(page.src) ? code : null, kb.feature, says, `CHK-1, CHK-3, CHK-6: ${posix.basename(page.file)} is the "${kb.heading}" form with the order summary, or the empty-cart text.`);
    }
    if (kb.confirm) {
      const c = kb.confirm;
      const conf = pageAt(c.route);
      const name = `${camel(c.route.split('/').filter(Boolean).at(-1) ?? 'confirmation').replace(/^./, (x) => x.toUpperCase())}Page`;
      const file = `${features}/${kb.feature}/pages/${name}.tsx`;
      if (!conf) {
        if (!has(file)) push({ tool: 'line.baseOn', args: { libraryId: 'pages/DetailPage', feature: kb.feature, name }, kind: 'page', feature: kb.feature, point: 'CHK-5', route: c.route, base: 'pages/DetailPage', why: `CHK-5: the confirmation page shows one order: ${name} is based on the library DetailPage.` }, `${kb.feature}/${name}`);
        else push({ tool: 'line.addRoute', args: { route: c.route, page: file }, kind: 'route', feature: kb.feature, point: 'CHK-5', route: c.route, why: `CHK-4 opens ${c.route}: serve ${name} there.` }, c.route);
      } else if (u) {
        const code = B.confirmationPage({ head: head(conf.src), file: conf.file, lib, usecaseFile: uc, heading: c.heading, orderPrefix: c.orderPrefix, link: c.link });
        if (conf.src !== code) rewrite(conf, stub(conf.src) ? code : null, kb.feature, 'CHK-5', `CHK-5: ${posix.basename(conf.file)} says "${c.heading}" with the order number, the products, the total paid and "${c.link.label}".`);
      }
    }
  }
  const covered = new Set(['page']);
  return { steps, skipped, open: points.filter((p) => !p.decided && !covered.has(String(p.block))).map((p) => ({ point: p.id, feature: p.feature, reason: p.reason })) };
}
