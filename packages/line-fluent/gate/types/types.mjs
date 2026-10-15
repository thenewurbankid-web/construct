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
//     Every answer type word must also be a catalog type word (SMITH_TYPES: catalog.json `check`
//     params and receivers, naming.json `typeGens`, and the table's own words); an unknown word fails
//     with the slot's canonical word as the fix.
//  3. kind, conservative, against the C1 entry kind and member name:
//     - ENTRY_KINDS narrows a few entry kinds (a property or index read is `value` or `question`, a
//       constructor is `value` or `copy`); a kind outside the set fails with a set-field `kind` fix.
//     - `question` fails when the entry member is not boolean-ish by name: `is*` / `has*` (camelCase
//       boundary) or one of BOOLEAN_MEMBERS. C1 carries no return type, so a non-question kind on a
//       boolean-ish entry is never flagged; the fix is set only when ENTRY_KINDS leaves one choice.
// skip when decision is `not-expressible`, answer.params is null, or there is no entry.
// makeTypesCheck(entries) binds the C1 entries for runGate's injected `types` slot.

import { readFileSync } from 'node:fs';

const atomsJson = (file) => JSON.parse(readFileSync(new URL(`../../../line-smith/src/atoms/${file}`, import.meta.url), 'utf8'));
const naming = atomsJson('naming.json');
const catalog = atomsJson('catalog.json');
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
  object: ['obj', 'objornull', 'map', 'set', 'weakmap', 'weakset', 'promise', 'list', 'date', 'regex', 'jsonvalue', 'descriptor', 'descriptormap', 'mixed'],
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

// Type words an optional slot also accepts (the param left undefined or nullish).
const ABSENT = ['undef', 'nullish'];

// Every type word the catalog knows: check params in both catalog shapes, receivers, typeGens, table.
function catalogTypeWords() {
  const words = new Set([...Object.values(TYPE_GENS), ...Object.values(CATEGORIES).flatMap((w) => w ?? []), ...ABSENT]);
  const atoms = Array.isArray(catalog.atoms) ? catalog.atoms : Object.values(catalog.atoms ?? {});
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  for (const atom of atoms) {
    for (const c of list(atom.check)) {
      if (c.receiver) words.add(c.receiver);
      for (const p of list(c.params)) {
        const w = Array.isArray(p) ? p[1] : p?.gen;
        if (typeof w === 'string' && !w.startsWith('const:')) words.add(w);
      }
    }
  }
  return Object.freeze([...words].sort());
}
export const SMITH_TYPES = catalogTypeWords();
const SMITH_SET = new Set(SMITH_TYPES);

export const BOOLEAN_MEMBERS = Object.freeze([
  'includes', 'every', 'some', 'startsWith', 'endsWith', 'test', 'isPrototypeOf', 'hasOwnProperty',
  'propertyIsEnumerable', 'global', 'ignoreCase', 'multiline', 'sticky', 'unicode', 'unicodeSets', 'dotAll',
  'done', 'detached', 'resizable', 'growable',
]);

// C1 entry kind -> the C2 kinds it allows. Entry kinds not listed allow every kind.
export const ENTRY_KINDS = Object.freeze({
  property: ['value', 'question'],
  'static-property': ['value', 'question'],
  index: ['value', 'question'],
  construct: ['value', 'copy'],
  class: ['value', 'copy'],
});

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

// A catalog literal choice, `const:["NFC","NFD"]`, stands for its values' primitive word.
function constWord(smith) {
  if (typeof smith !== 'string' || !smith.startsWith('const:')) return null;
  try {
    const values = JSON.parse(smith.slice(6));
    if (!Array.isArray(values) || values.length === 0) return null;
    if (values.every((v) => typeof v === 'string')) return 'text';
    if (values.every((v) => typeof v === 'number')) return 'num';
    if (values.every((v) => typeof v === 'boolean')) return 'bool';
  } catch {
    // not a literal choice
  }
  return null;
}

const knownWord = (smith) => SMITH_SET.has(smith) || constWord(smith) !== null;

// Is `smith` accepted for a TS type? null when the TS type is unmapped.
function compatible(smith, cats) {
  if (cats.length === 0) return null;
  const lit = constWord(smith);
  if (lit) return compatible(lit, cats) || cats.some((c) => typeof c !== 'object' && CATEGORIES[c]?.includes('prim'));
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
  // C1 lists some receivers as an explicit `this` param (Function.prototype.apply); that param is the slot.
  if (entry.params?.[0]?.name === 'this') return null;
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
    if (!knownWord(smith)) {
      const want = canonical(slot.cats) ?? 'mixed';
      errors.push(`Parameter \`${name}\` has type \`${smith}\`, which is not a catalog type word; use \`${want}\`.`);
      corrected.push([name, want]);
      return;
    }
    const ok = !slot.required && ABSENT.includes(smith) ? true : compatible(smith, slot.cats);
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

// One kind error and its fix (null when no single kind is clearly right), or null when the kind is fine.
function kindCheck(kind, entry) {
  if (kind == null) return null;
  const id = entry.id;
  const booleanish = isBooleanish(entry);
  let allowed = ENTRY_KINDS[entry.kind] ?? null;
  if (allowed && !booleanish) allowed = allowed.filter((k) => k !== 'question');
  const fix = allowed?.length === 1 ? allowed[0] : allowed?.includes('value') ? 'value' : null;
  if (kind === 'question' && !booleanish) {
    return {
      error: `Kind \`question\` needs a yes/no member, but ${id} is not one by name (is*, has*, ${BOOLEAN_MEMBERS.join(', ')}); use ${(allowed ?? ['value', 'copy', 'in-place', 'effect']).map((k) => `\`${k}\``).join(', ')}.`,
      fix: allowed?.length === 1 ? allowed[0] : null,
    };
  }
  if (allowed && !allowed.includes(kind)) {
    return {
      error: `Kind \`${kind}\` does not fit ${id}, a ${entry.kind} entry; use ${allowed.map((k) => `\`${k}\``).join(' or ')}.`,
      fix,
    };
  }
  return null;
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

  const kind = kindCheck(answer.kind, entry);
  if (kind) {
    errors.push(kind.error);
    if (kind.fix) fixes.push({ kind: 'set-field', field: 'kind', value: kind.fix });
  }

  return { check: errors.length ? 'fail' : 'pass', errors, fixes, unmapped: res.unmapped };
}

export function checkTypes(answer, { entry } = {}) {
  const { check, errors, fixes } = typeReport(answer, { entry });
  return { check, errors, fixes };
}

// C1 entries -> the (answer) -> CheckResult function runGate injects as `types`. The answer's
// `entry` is matched against C1 `id` (every overload), then `key` (one overload); an unknown entry skips.
export function makeTypesCheck(entries) {
  const byKey = new Map();
  const byId = new Map();
  for (const e of entries ?? []) {
    if (e.key) byKey.set(e.key, [e]);
    if (e.id) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  }
  return (answer) => checkOverloads(answer, byId.get(answer?.entry) ?? byKey.get(answer?.entry) ?? []);
}

// An id with several C1 overloads (`new Date`, `new Date #2`, ...) passes when any overload passes;
// otherwise the overload with the fewest errors (first on a tie) reports.
export function checkOverloads(answer, overloads) {
  let best = null;
  for (const entry of overloads) {
    const r = checkTypes(answer, { entry });
    if (r.check !== 'fail') return r;
    if (!best || r.errors.length < best.errors.length) best = r;
  }
  return best ?? { check: 'skip', errors: [], fixes: [] };
}
