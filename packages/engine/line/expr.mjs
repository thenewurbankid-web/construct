// Expressions (System 1 groundwork) -- evaluate a Line expression (contract.mjs LineExpr) against a facts snapshot
// (facts.mjs LineFacts). An interpreter over plain JSON: no eval, no Function, no code strings; a path reads only a
// value's OWN fields of plain objects and lists, so "constructor" or "__proto__" are simply missing. A valid
// expression never throws; an invalid one is refused in one sentence (contract.mjs exprProblem).
//
//   evaluate(facts, expr) -> {ok, failed: [{path, sentence}]}   each failed part as one plain-English sentence
//   claimOf(expr)         -> a short phrase saying what the expression claims (for "None of these holds: ...")
import { exprProblem } from './contract.mjs';

const MISSING = undefined;
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Read `segs` from `base`: own fields of objects, positions of lists; anything else is missing. */
function resolve(base, segs) {
  let v = base;
  for (const s of segs) {
    if (Array.isArray(v)) { v = Number.isInteger(s) && s < v.length ? v[s] : MISSING; continue; }
    if (isPlainObj(v) && typeof s === 'string' && own(v, s)) { v = v[s]; continue; }
    return MISSING;
  }
  return v;
}

/** A file path or id starting a sentence keeps its case ("features/orders/... does not exist yet."). */
const nameFirst = (s) => /^[^\s]*[/.]/.test(s) || /^"/.test(s);
const cap = (s) => (nameFirst(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));
const low = (s) => (nameFirst(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const end = (s) => { const t = cap(String(s).trim().replace(/\s+/g, ' ')); return /[.?!]$/.test(t) ? t : `${t}.`; };
const cut = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/**
 * A value as a reader sees it.
 * @param {unknown} v
 * @returns {string}
 */
export function show(v) {
  if (v === MISSING) return 'missing';
  if (v === null) return 'empty';
  if (typeof v === 'string') return `"${cut(v)}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) { const j = JSON.stringify(v); return j.length <= 60 ? j : `a list of ${v.length}`; }
  return `an object with ${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`;
}

const rest = (segs) => segs.map((s) => (Number.isInteger(s) ? `item ${Number(s) + 1}` : String(s))).join(' ');
const of = (tail, whole) => (tail.length ? `the ${rest(tail)} of ${whole}` : whole);

/**
 * A path into the facts in words: "features/orders/components/StatusBadge.tsx", "the hash of a.tsx", "feature orders".
 * @param {(string|number)[]} segs
 * @returns {string}
 */
export function pathLabel(segs) {
  const [head, key, ...tail] = segs;
  if (head === 'files' && key !== undefined) return of(tail, String(key));
  if (head === 'library' && key !== undefined) return of(tail, `library item ${key}`);
  if (head === 'features' && key !== undefined) return of(tail, `feature ${key}`);
  if (head === 'structure') {
    if (key === 'project' && !tail.length) return 'the project\'s structure hash';
    if (key === 'library' && !tail.length) return 'the library\'s structure hash';
    if (key === 'features' && tail.length) {
      const [f, k, layer] = tail;
      if (k === 'hash') return `the structure hash of feature ${f}`;
      if (k === 'layers' && layer !== undefined) return `the structure hash of the ${layer} layer of feature ${f}`;
      return of(tail.slice(1), `the structure of feature ${f}`);
    }
  }
  if (head === 'findings') return of(segs.slice(1), 'the findings');
  if (head === 'findingsNew') return of(segs.slice(1), 'the new problems');
  if (head === 'plan') return key === undefined ? 'the plan' : `the plan's ${rest(segs.slice(1))}`;
  return segs.length === 1 ? `the ${rest(segs)}` : of(segs.slice(1), `the ${rest([head])}`);
}

/** How an element of a list is named in a sentence: its name, path or id, else its position. */
const elementName = (el, i) => {
  for (const k of ['name', 'path', 'id', 'key']) if (isPlainObj(el) && typeof el[k] === 'string' && el[k]) return el[k];
  return `item ${i + 1}`;
};

const WORD = { lt: 'less than', le: 'at most', gt: 'more than', ge: 'at least' };
const isLiteral = (e) => e === null || typeof e !== 'object' || 'lit' in e;

/**
 * @typedef {{facts: any, item?: {value: any, name: string}}} Ctx
 * @typedef {{v: any, label: string}} Val
 */

/** The value of a node and how to name it. */
function value(e, ctx) {
  if (e === null || typeof e !== 'object') return { v: e, label: show(e) };
  const [op] = Object.keys(e); const a = e[op];
  if (op === 'lit') return { v: a, label: show(a) };
  if (op === 'path') return { v: resolve(ctx.facts, a), label: pathLabel(a) };
  if (op === 'item') {
    const name = ctx.item ? ctx.item.name : 'the item';
    return { v: ctx.item ? resolve(ctx.item.value, a) : MISSING, label: a.length ? `the ${rest(a)} of ${name}` : name };
  }
  if (op === 'count') {
    const x = value(a, ctx);
    const n = Array.isArray(x.v) || typeof x.v === 'string' ? x.v.length : isPlainObj(x.v) ? Object.keys(x.v).length : 0;
    return { v: n, label: `the number of ${x.label}` };
  }
  return { v: test(e, ctx, true).ok, label: claimOf(e) };
}

/** Compare two JSON values deeply. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => own(b, k) && same(a[k], b[k]));
}
const ordered = (a, b) => (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
const compare = (op, a, b) => {
  if (op === 'eq') return same(a, b);
  if (op === 'ne') return !same(a, b);
  if (!ordered(a, b)) return false;
  return op === 'lt' ? a < b : op === 'le' ? a <= b : op === 'gt' ? a > b : a >= b;
};
const member = (n, h) => (Array.isArray(h) ? h.some((x) => same(x, n)) : typeof h === 'string' ? typeof n === 'string' && h.includes(n) : isPlainObj(h) ? typeof n === 'string' && own(h, n) : false);

/**
 * A short phrase for what `e` claims, without the facts: "features/a.tsx exists", "name "Badge"".
 * @param {any} e
 * @returns {string}
 */
export function claimOf(e) {
  if (e === null || typeof e !== 'object') return show(e);
  const [op] = Object.keys(e); const a = e[op];
  const lbl = (x) => (x !== null && typeof x === 'object' && 'item' in x ? (x.item.length ? rest(x.item) : 'the item') : x !== null && typeof x === 'object' && 'path' in x ? pathLabel(x.path) : x !== null && typeof x === 'object' && 'count' in x ? `the number of ${lbl(x.count)}` : x !== null && typeof x === 'object' && 'lit' in x ? show(x.lit) : typeof x === 'object' && x !== null ? `(${claimOf(x)})` : show(x));
  switch (op) {
    case 'lit': return show(a);
    case 'path': case 'item': case 'count': return lbl(e);
    case 'exists': return `${lbl(a)} exists`;
    case 'eq': return `${lbl(a[0])} ${isLiteral(a[1]) ? lbl(a[1]) : `equal to ${lbl(a[1])}`}`;
    case 'ne': return `${lbl(a[0])} other than ${lbl(a[1])}`;
    case 'lt': case 'le': case 'gt': case 'ge': return `${lbl(a[0])} ${WORD[op]} ${lbl(a[1])}`;
    case 'in': return `${lbl(a[0])} in ${lbl(a[1])}`;
    case 'and': return a.map(claimOf).join(' and ');
    case 'or': return a.map(claimOf).join(' or ');
    case 'not': return `not ${claimOf(a)}`;
    case 'every': return `every item of ${lbl(a[0])} with ${claimOf(a[1])}`;
    case 'some': return `an item of ${lbl(a[0])} with ${claimOf(a[1])}`;
    default: return op;
  }
}

/**
 * Test `e` as a predicate; `want` is the truth it should have. Failures say what is actually so.
 * @returns {{ok: boolean, failed: {path: string, sentence: string}[]}}
 */
function test(e, ctx, want, at = '') {
  const pass = { ok: true, failed: [] };
  const no = (sentence, p = at) => ({ ok: false, failed: [{ path: p, sentence: end(sentence) }] });
  if (e === null || typeof e !== 'object' || 'lit' in e || 'path' in e || 'item' in e || 'count' in e) {
    const x = value(e, ctx);
    const truth = Boolean(x.v);
    if (truth === want) return pass;
    if (want) return no(x.v === MISSING ? `${x.label} does not exist yet` : `${x.label} is ${show(x.v)}`);
    return no(`${x.label} is ${show(x.v)}, and it should not be`);
  }
  const [op] = Object.keys(e); const a = e[op]; const here = at ? `${at}.${op}` : op;
  if (op === 'not') return test(a, ctx, !want, here);
  if (op === 'exists') {
    const x = value(a, ctx);
    const truth = x.v !== MISSING && x.v !== null;
    if (truth === want) return pass;
    return no(want ? `${x.label} does not exist yet` : `${x.label} already exists`);
  }
  if (op in WORD || op === 'eq' || op === 'ne') {
    const l = value(a[0], ctx); const r = value(a[1], ctx);
    const truth = compare(op, l.v, r.v);
    if (truth === want) return pass;
    const other = isLiteral(a[1]) ? show(r.v) : `${r.label} (${show(r.v)})`;
    if (l.v === MISSING) return no(`${l.label} does not exist yet, so it is not ${op === 'eq' ? '' : op === 'ne' ? 'other than ' : `${WORD[op]} `}${other}`);
    if ((op === 'eq' && want) || (op === 'ne' && !want)) return no(`${l.label} is ${show(l.v)}, not ${other}`);
    if ((op === 'ne' && want) || (op === 'eq' && !want)) return no(`${l.label} is ${show(l.v)}, and it should not be`);
    if (!ordered(l.v, r.v)) return no(`${l.label} is ${show(l.v)}, which cannot be compared with ${other}`);
    return no(want ? `${l.label} is ${show(l.v)}, not ${WORD[op]} ${other}` : `${l.label} is ${show(l.v)}, which is ${WORD[op]} ${other}, and it should not be`);
  }
  if (op === 'in') {
    const n = value(a[0], ctx); const h = value(a[1], ctx);
    const truth = member(n.v, h.v);
    if (truth === want) return pass;
    const nl = isLiteral(a[0]) ? show(n.v) : n.label;
    if (want) return no(h.v === MISSING ? `${h.label} does not exist yet, so ${nl} is not in it` : `${nl} is not in ${h.label}`);
    return no(`${nl} is in ${h.label}, and it should not be`);
  }
  if (op === 'and' || op === 'or') {
    const parts = a.map((x, i) => ({ x, r: test(x, ctx, true, `${here}[${i}]`) }));
    const truth = op === 'and' ? parts.every((p) => p.r.ok) : parts.some((p) => p.r.ok);
    if (truth === want) return pass;
    // and wanted true / or wanted false: each part on its own says what is wrong.
    if (op === 'and' && want) return { ok: false, failed: parts.flatMap((p) => p.r.failed) };
    if (op === 'or' && !want) return { ok: false, failed: parts.flatMap((p, i) => (p.r.ok ? test(p.x, ctx, false, `${here}[${i}]`).failed : [])) };
    if (op === 'or') return no(`None of these holds: ${a.map(claimOf).join('; ')}`);
    return no(`All of these hold, and they should not all: ${a.map(claimOf).join('; ')}`);
  }
  if (op === 'every' || op === 'some') {
    const list = value(a[0], ctx);
    if (!Array.isArray(list.v)) {
      // Not a list: nothing in it, so `some` is false and `every` is false too (a missing list proves nothing).
      if (!want) return pass;
      return no(list.v === MISSING ? `${list.label} does not exist yet` : `${list.label} is not a list`);
    }
    const results = list.v.map((el, i) => ({ i, el, r: test(a[1], { facts: ctx.facts, item: { value: el, name: elementName(el, i) } }, true, `${here}[1]`) }));
    const bad = results.filter((x) => !x.r.ok); const good = results.filter((x) => x.r.ok);
    const truth = op === 'every' ? bad.length === 0 : good.length > 0;
    if (truth === want) return pass;
    if (op === 'every' && want) {
      const first = bad[0];
      const lead = bad.length === 1 ? `1 of ${results.length} in ${list.label} fails` : `${bad.length} of ${results.length} in ${list.label} fail; the first`;
      return { ok: false, failed: [{ path: first.r.failed[0]?.path ?? here, sentence: end(`${lead}: ${first.r.failed.map((f) => low(f.sentence).replace(/[.?!]$/, '')).join('; ')}`) }] };
    }
    if (op === 'some' && want) return no(results.length ? `Nothing in ${list.label} has ${claimOf(a[1])}` : `${list.label} is empty, so nothing in it has ${claimOf(a[1])}`);
    if (op === 'some') return no(`In ${list.label}, ${elementName(good[0].el, good[0].i)} has ${claimOf(a[1])}, and nothing should`);
    return no(`All ${results.length} in ${list.label} have ${claimOf(a[1])}, and they should not all`);
  }
  return no(`"${op}" is not an operator`);
}

/**
 * Evaluate `expr` against `facts`. Never throws: an invalid expression is one failed sentence at path "".
 * @param {any} facts A LineFacts snapshot (or any plain JSON).
 * @param {unknown} expr
 * @returns {import('./contract.mjs').ExprEvaluation}
 */
export function evaluate(facts, expr) {
  const why = exprProblem(expr);
  if (why) return { ok: false, failed: [{ path: '', sentence: end(`This expression cannot be checked: ${low(why)}`) }] };
  const r = test(expr, { facts }, true);
  return { ok: r.ok, failed: r.ok ? [] : r.failed.length ? r.failed : [{ path: '', sentence: 'The check did not hold.' }] };
}
