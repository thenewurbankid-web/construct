// #933 -- a page's shape and data source, read from the spec's own words (no point ids, no domain words). Deterministic,
// pure, writes nothing; the seed (specSteps.mjs) and the open-work card (openWork.mjs pointStep, emptyPage) both use it.
//
//   routeEvidence(feature, route, routes)   the points of `feature` that are about the page at `route`: the ones that put
//                                           a page there or name it (not as a link target, "opens `/x`"), and the ones that
//                                           name none of the feature's routes when `route` is its first; never a point
//                                           every page shows (a nav link)
//   pageShape({route, points, label})       the closed set: 'list' | 'form' | 'detail', or null with an honest reason
//   pointRole(text)                         'nav-count' (every page shows a link with a count: the layout's nav slot) |
//                                           'empty' (the text a page shows when it has nothing: its empty slot) | null
//   memberState(spec, feature, routes)      whether the feature's items are the member's own selection kept across pages
//                                           (a store), with the spec's words that say so; null when they are not
//   storeHint(feature)                      the store generator call for such a selection (construct create store, #927)
//
// The shape rules (first that holds wins):
//   a route with a parameter (/x/:id)                                  -> detail (one record)
//   "fields labelled", two labelled inputs in one point, a validation
//   message per field or aria-invalid, or "a/the form"                 -> form
//   "lists", "each <thing> with", "N at a time", "Page N of M", a sort,
//   filter or search control                                           -> list, unless it also reads as one record
//   "by <field>", "<x>'s name/title as its main heading", "unknown id",
//   "the <x> number (text starting", a table page called "one <x>"     -> detail, unless it also reads as a list
//   both list and one record, or neither                               -> null: the builder's call, with why
const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "/books/<id>" or "/books/[id]" -> "/books/:id". */
export const lineRoute = (r) => String(r).trim().replace(/<([A-Za-z]\w*)>/g, ':$1').replace(/\[([A-Za-z]\w*)\]/g, ':$1');
export const pascal = (s) => String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

/** The routes a point names in backticks, each with whether it is only a link target ("opens `/x`", "to `/x`"). */
export function namedRoutes(text) {
  return [...String(text).matchAll(/`(\/[^`\s]*)`/g)].map((m) => {
    const before = String(text).slice(Math.max(0, m.index - 24), m.index);
    const at = /\bpage at\s*$/i.test(before);
    return { route: lineRoute(m[1]), at, target: !at && /\b(?:opens|open|to|returns to|link to)\s*$/i.test(before) };
  });
}

const NAV_COUNT = /\bevery page shows a link\b[^.]*?(?:\(\d+\)|number of|count)/i;
const EMPTY_TEXT = /\b(?:with no \w+|with none|when (?:it is |there is )?(?:empty|nothing)|an empty \w+|when nothing is left)\b[^"]*?\bsays? "([^"]+)"/i;

/** 'nav-count' | 'empty' | null, and the quoted empty text for 'empty'. */
export function pointRole(text) {
  if (NAV_COUNT.test(String(text))) return { role: 'nav-count', label: /\blink whose name starts with "([^"]+)"/i.exec(String(text))?.[1] ?? null };
  const e = EMPTY_TEXT.exec(String(text));
  return e ? { role: 'empty', text: e[1] } : null;
}

/**
 * The points of a feature that are about its page at `route` (see the header).
 * @param {{name: string, points: {id: string, text: string}[]}} feature
 * @param {string} route In Line's form.
 * @param {string[]} routes The feature's page routes, in spec order.
 * @returns {{id: string, text: string}[]}
 */
export function routeEvidence(feature, route, routes) {
  const first = routes[0] === route;
  return feature.points.filter((p) => {
    if (pointRole(p.text)?.role === 'nav-count') return false;
    const named = namedRoutes(p.text);
    if (named.some((n) => n.route === route && !n.target)) return true;
    if (named.some((n) => routes.includes(n.route) && !n.target)) return false;
    return first;
  });
}

const LIST = [
  [/\blists?\b/i, 'lists'], [/\beach (?:[\w-]+ ){0,3}with\b/i, 'each <x> with'], [/\b[\w-]+ at a time\b/i, 'at a time'],
  [/\bPage \d+ of \d+\b/, 'Page N of M'], [/\b(?:sort|filter|search)\w*\b/i, 'a sort, filter or search'],
  [/\b(?:all|every) \d+ \w+/i, 'all N'],
];
const FORM = [
  [/\bfields labelled\b/i, 'fields labelled'], [/\baria-invalid\b/i, 'aria-invalid'], [/\bmessage for each\b/i, 'a message for each field'],
  [/\b(?:a|the) form\b/i, 'a form'],
];
const DETAIL = [
  [/\bby <\w+>/i, 'by <field>'], [/'s (?:name|title) as its main heading\b/i, 'its name as the main heading'], [/\bunknown id\b/i, 'an unknown id'],
  [/\bthe [\w-]+ number \(text starting\b/i, 'one record\'s number'], [/^one \w+/i, 'one record'],
];
const hits = (rules, text) => rules.filter(([re]) => re.test(text)).map(([, w]) => w);
const quote = (p) => `${p.id} "${p.text.length > 60 ? `${p.text.slice(0, 57)}...` : p.text}"`;

/**
 * The page's shape from its route and the points about it (see the header). Pure.
 * @param {{route: string, points: {id: string, text: string}[], label?: string}} o `label`: the route table's page column.
 * @returns {{shape: 'list'|'form'|'detail'|null, base: string|null, reason: string, signals: string[]}}
 */
export function pageShape({ route, points, label = '' }) {
  const base = (shape) => ({ list: 'pages/ListPage', form: 'pages/FormPage', detail: 'pages/DetailPage' })[shape];
  const out = (shape, reason, signals = []) => ({ shape, base: shape ? base(shape) : null, reason, signals });
  if (/:/.test(route)) return out('detail', `${route} has a parameter: one record`, ['a route parameter']);
  const texts = [...points.map((p) => ({ p, t: p.text })), ...(label ? [{ p: null, t: label }] : [])];
  const form = texts.flatMap(({ p, t }) => {
    const twoInputs = (t.match(/\b(?:field|text box|choice|checkbox|control|select) labelled "/gi) ?? []).length >= 2;
    return [...hits(FORM, t), ...(twoInputs ? ['two labelled inputs'] : [])].map((w) => ({ p, w }));
  });
  if (form.length) return out('form', `${form[0].p ? form[0].p.id : 'the route table'} reads as a form (${[...new Set(form.map((x) => x.w))].join(', ')})`, form.map((x) => x.w));
  const list = texts.flatMap(({ p, t }) => hits(LIST, t).map((w) => ({ p, w })));
  const detail = texts.flatMap(({ p, t }) => hits(DETAIL, t).map((w) => ({ p, w })));
  const who = (xs) => [...new Set(xs.map((x) => (x.p ? x.p.id : 'the route table')))].join(', ');
  if (list.length && detail.length) {
    return out(null, `the page at ${route} reads both as a list (${who(list)}: ${list[0].w}) and as one record (${who(detail)}: ${detail[0].w})`);
  }
  if (list.length) return out('list', `${who(list)} reads as a list (${[...new Set(list.map((x) => x.w))].join(', ')})`, list.map((x) => x.w));
  if (detail.length) return out('detail', `${who(detail)} reads as one record (${[...new Set(detail.map((x) => x.w))].join(', ')})`, detail.map((x) => x.w));
  if (!points.length) return out(null, `no point says what the page at ${route} shows${label ? ` (the route table calls it "${label}")` : ''}`);
  return out(null, `${points.map(quote).join('; ')} do not say whether the page at ${route} lists items, is a form or shows one record`);
}

/**
 * Whether a feature's items are the member's own selection kept across pages, so a store and not a fixture: a link every
 * page shows with their count opens its route, the spec says they are kept when the page is reloaded, or a point adds
 * something to them by the feature's name ("adds the book to the member's picks"). Pure.
 * @param {{features: {name: string, points: {id: string, text: string}[]}[]}} spec
 * @param {string} feature @param {string[]} routes The feature's page routes.
 * @returns {{because: string[]}|null} The spec's words that say so, each "ID: ...".
 */
export function memberState(spec, feature, routes) {
  const f = spec.features.find((x) => x.name === feature);
  if (!f) return null;
  const forms = [...new Set([feature, feature.replace(/s$/, '')])].map(esc).join('|');
  const because = [];
  for (const g of spec.features) for (const p of g.points) {
    if (pointRole(p.text)?.role === 'nav-count' && namedRoutes(p.text).some((n) => routes.includes(n.route))) because.push(`${p.id}: every page shows their count`);
    else if (g === f && /\bkept (?:when|after) the page is reloaded\b/i.test(p.text)) because.push(`${p.id}: they are kept when the page is reloaded`);
    else if (new RegExp(`\\badd(?:s|ed)?\\b[^.;]*?\\bto (?:the |your |my |the member's )(?:${forms})\\b`, 'i').test(p.text)) because.push(`${p.id}: it adds to them`);
  }
  return because.length ? { because } : null;
}

/** The store generator call for a feature's member selection (packages/core/store.mjs, #927). */
export const storeHint = (feature) => `construct create store ${pascal(feature)} --feature ${feature} --shape list`;
