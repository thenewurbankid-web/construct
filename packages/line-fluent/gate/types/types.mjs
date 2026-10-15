// Types gate (docs/line/FLUENT-PLAN-2026-10-15.md, Wave 2 leaf t1-2d-types).
// checkTypes(answer, {entry}) -> CheckResult. Static only (no tsc): compares the C2 answer's
// `params` ([name, smithType] pairs) and `kind` with the C1 reference entry
// ({id, kind, params: [{name, type, optional, rest}]}).
//
// Three checks:
//  1. arity: the answer covers the receiver (first, for `X.prototype.m` entries) and every required
//     entry param; optional and rest params may be missing; extra params are refused unless the
//     entry has a rest param.
//  2. types: each answer param's smith type (the gen words of packages/line-smith catalog.json
//     `check` params and naming.json `typeGens`) must be compatible with the entry's TS type through
//     the closed table below. A TS type the table does not map is not a failure; typeReport counts it.
//  3. kind: conservative. `question` fails only when the entry member is not boolean-ish by name:
//     `is*` / `has*` (camelCase boundary) or one of BOOLEAN_MEMBERS. C1 carries no return type, so a
//     non-question kind on a boolean-ish entry is never flagged, and no kind fix is proposed.
// skip when decision is `not-expressible` or answer.params is null.

import { readFileSync } from 'node:fs';

const naming = JSON.parse(readFileSync(new URL('../../../line-smith/src/atoms/naming.json', import.meta.url), 'utf8'));
const TYPE_GENS = naming.typeGens ?? {};

// ---------------------------------------------------------------- closed mapping table
// TS category -> smith type words accepted for it. `mixed` (anything) is accepted everywhere;
// `prim` (any primitive) is accepted for every primitive category.
export const CATEGORIES = Object.freeze({
  number: ['num', 'nat', 'smallint', 'nzint', 'pos', 'prim', 'mixed'],
  string: ['text', 'shorttext', 'spacedtext', 'numtext', 'isotext', 'digits', 'urlpath', 'urlbase', 'prim', 'mixed'],
  boolean: ['bool', 'prim', 'mixed'],
  bigint: ['bigint', 'smallbigint', 'prim', 'mixed'],
  list: ['list', 'list1', 'nums', 'texts', 'keys', 'pairs', 'anypairs', 'nested', 'set', 'map', 'listornull', 'mixed'],
  fn: ['fn', 'pred', 'cmp', 'fntext', 'fnnested', 'keyfn', 'ctor', 'lazy:prim', 'lazy:num', 'lazy:unit', 'mixed'],
  object: ['obj', 'objornull', 'map', 'set', 'list', 'date', 'regex', 'jsonvalue', 'mixed'],
  regex: ['regex', 'gregex', 'ngregex', 'mixed'],
  date: ['date', 'mixed'],
  key: ['key', 'text', 'shorttext', 'num', 'nat', 'smallint', 'prim', 'mixed'],
  any: null, // any / unknown / a type parameter: every smith type is accepted
});

// The smith word suggested when a param's type is wrong or missing.
export const CANONICAL = Object.freeze({
  number: 'num', string: 'text', boolean: 'bool', bigint: 'bigint', list: 'list', fn: 'fn',
  object: 'obj', regex: 'regex', date: 'date', key: 'key', any: 'prim',
});

const SIMPLE = {
  number: 'number', string: 'string', boolean: 'boolean', bigint: 'bigint', any: 'any', unknown: 'any',
  object: 'object', '{}': 'object', Object: 'object', RegExp: 'regex', Date: 'date', PropertyKey: 'key',
  Function: 'fn',
};
const LIST_GENERIC = /^(?:readonly\s+)?(?:ReadonlyArray|Array|ArrayLike|Iterable|ConcatArray|ReadonlySetLike)<.+>$/;
const TYPE_PARAM = /^(?:[A-Z]|T[A-Z]\w*|This)$/;

// Receiver of `Owner.prototype.member` -> TS category.
const RECEIVERS = {
  Array: 'list', String: 'string', Number: 'number', BigInt: 'bigint', Boolean: 'boolean', Date: 'date',
  RegExp: 'regex', Map: 'object', Set: 'object', WeakMap: 'object', WeakSet: 'object', Object: 'object',
  Function: 'fn', Iterator: 'list',
};
const RECEIVER_NAMES = { list: 'list', string: 'text', number: 'n', bigint: 'n', boolean: 'flag', date: 'date', regex: 'pattern', fn: 'fn', object: 'obj' };

export const BOOLEAN_MEMBERS = Object.freeze(['includes', 'every', 'some', 'startsWith', 'endsWith', 'test', 'isPrototypeOf', 'hasOwnProperty']);

// ---------------------------------------------------------------- TS type -> category
function stripParens(t) {
  let s = t.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0 && i < s.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

// Split at a top-level separator (`|` or `=>`), ignoring nested brackets.
function topSplit(s, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('(<[{'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && s[i - 1] !== '=')) depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i).trim());
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

// TS type text -> list of categories (a union yields several), [] when unmapped.
export function tsCategories(type) {
  if (typeof type !== 'string') return [];
  const raw = type.trim();
  if (TYPE_GENS[raw]) return [{ gen: TYPE_GENS[raw] }];
  const s = stripParens(raw);
  if (topSplit(s, '=>').length > 1) return ['fn'];
  const alts = topSplit(s, '|').map(stripParens).filter((a) => a !== 'undefined' && a !== 'null');
  if (alts.length > 1) return [...new Set(alts.flatMap((a) => tsCategories(a)))];
  const one = alts[0] ?? '';
  if (one !== s) return tsCategories(one);
  if (/^"[^"]*"$/.test(one)) return ['string'];
  if (SIMPLE[one]) return [SIMPLE[one]];
  if (TYPE_PARAM.test(one)) return ['any'];
  if (/\[\]$/.test(one) || LIST_GENERIC.test(one)) return ['list'];
  return [];
}

// Is `smith` accepted for a TS type? null when the TS type is unmapped.
function compatible(smith, cats) {
  if (cats.length === 0) return null;
  return cats.some((c) => {
    if (typeof c === 'object') return smith === c.gen || smith === 'mixed';
    const ok = CATEGORIES[c];
    return ok === null || ok.includes(smith);
  });
}

function canonical(cats) {
  const c = cats[0];
  if (c === undefined) return null;
  return typeof c === 'object' ? c.gen : CANONICAL[c];
}

// ---------------------------------------------------------------- entry shape
function receiverOf(entry) {
  const m = /^([A-Za-z0-9_$]+)\.prototype\./.exec(entry.id ?? '');
  if (!m) return null;
  const cat = RECEIVERS[m[1]] ?? (/Array$/.test(m[1]) ? 'list' : null);
  return { owner: m[1], cats: cat ? [cat] : [], name: RECEIVER_NAMES[cat] ?? 'self' };
}

function memberOf(entry) {
  return String(entry.id ?? '').split('.').pop().replace(/\(\)$/, '');
}

export function isBooleanish(entry) {
  const m = memberOf(entry);
  return /^(is|has)(?=[A-Z]|$)/.test(m) || BOOLEAN_MEMBERS.includes(m);
}

// Expected slots: [{name, cats, required, rest, receiver}]
function slots(entry, withReceiver) {
  const out = [];
  const recv = withReceiver ? receiverOf(entry) : null;
  if (recv) out.push({ name: recv.name, label: `the ${recv.owner} receiver`, cats: recv.cats, required: true, rest: false, receiver: true });
  for (const p of entry.params ?? []) {
    let cats = tsCategories(p.type);
    if (p.rest) {
      // A rest param may be written as the array or as one element.
      const elem = /^(?:readonly\s+)?(.+)\[\]$/.exec(stripParens(p.type ?? ''));
      if (elem) cats = [...new Set([...cats, ...tsCategories(elem[1])])];
    }
    out.push({ name: p.name, label: `\`${p.name}\``, cats, required: !p.optional && !p.rest, rest: !!p.rest, receiver: false });
  }
  return out;
}

// Align answer params with slots. Returns {errors, corrected (null if no clear correction), unmapped}.
function align(answerParams, sl, id) {
  const errors = [];
  let unmapped = 0;
  let clear = true;
  const corrected = [];
  const restSlot = sl.length && sl[sl.length - 1].rest ? sl[sl.length - 1] : null;

  answerParams.forEach(([name, smith], i) => {
    const slot = sl[i] ?? restSlot;
    if (!slot) {
      errors.push(`Parameter \`${name}\` is extra: ${id} takes ${sl.length} parameter${sl.length === 1 ? '' : 's'}; remove \`${name}\`.`);
      return;
    }
    const ok = compatible(smith, slot.cats);
    if (ok === null) unmapped++;
    if (ok === false) {
      const want = canonical(slot.cats);
      errors.push(`Parameter \`${name}\` has type \`${smith}\`, but ${slot.label} of ${id} is ${slot.cats.map((c) => (typeof c === 'object' ? c.gen : c)).join(' or ')}; use \`${want}\`.`);
      if (want) corrected.push([name, want]);
      else clear = false;
      return;
    }
    corrected.push([name, smith]);
  });

  for (let i = answerParams.length; i < sl.length; i++) {
    const slot = sl[i];
    if (!slot.required) continue;
    const want = canonical(slot.cats);
    errors.push(`${slot.receiver ? 'The receiver' : `Parameter ${slot.label}`} of ${id} is missing; add [${JSON.stringify(slot.name)}, ${JSON.stringify(want ?? 'mixed')}].`);
    if (want) corrected.push([slot.name, want]);
    else clear = false;
  }
  return { errors, corrected: clear ? corrected : null, unmapped };
}

// ---------------------------------------------------------------- public
// Full report: the CheckResult plus `unmapped` (answer params whose entry TS type is not in the table).
export function typeReport(answer, { entry } = {}) {
  const skip = { check: 'skip', errors: [], fixes: [], unmapped: 0 };
  if (!answer || answer.decision === 'not-expressible' || answer.params == null || !entry) return skip;
  const id = entry.id;
  const params = answer.params;
  const errors = [];
  const fixes = [];

  const full = slots(entry, true);
  let res = align(params, full, id);
  const recv = receiverOf(entry);
  if (res.errors.length && recv) {
    // The common mistake: the receiver was left out. Say so in one sentence when that alone fixes it.
    const bare = align(params, slots(entry, false), id);
    if (bare.errors.length === 0) {
      const want = canonical(recv.cats) ?? 'mixed';
      const first = [recv.name, want];
      res = {
        errors: [`The receiver of ${id} is missing; add [${JSON.stringify(recv.name)}, ${JSON.stringify(want)}] as the first parameter.`],
        corrected: [first, ...params],
        unmapped: bare.unmapped,
      };
    }
  }
  errors.push(...res.errors);
  if (res.errors.length && res.corrected) fixes.push({ kind: 'set-field', field: 'params', value: res.corrected });

  if (answer.kind === 'question' && !isBooleanish(entry)) {
    errors.push(`Kind \`question\` needs a yes/no member, but ${id} is not one by name (is*, has*, ${BOOLEAN_MEMBERS.join(', ')}); use \`value\`, \`copy\`, \`in-place\` or \`effect\`.`);
  }

  return { check: errors.length ? 'fail' : 'pass', errors, fixes, unmapped: res.unmapped };
}

export function checkTypes(answer, { entry } = {}) {
  const { check, errors, fixes } = typeReport(answer, { entry });
  return { check, errors, fixes };
}
