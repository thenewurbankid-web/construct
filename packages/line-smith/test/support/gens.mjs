// Argument generators for the catalog equivalence checks. Each name here is what
// src/atoms/curated.json and the generator (scripts/gen-atoms.mjs) write into `check`.
import fc from 'fast-check';

const regexSources = [
  ['a', ''], ['a', 'g'], ['b+', 'gi'], ['^a', 'm'], ['(a)(b)?', 'g'], ['x*', 'y'], ['\\s', 'u'], ['a(?<n>b)', 'd'], ['[ab]', 'g'], ['', 'g'],
];
const fresh = (list) => fc.constantFrom(...list).map(([s, f]) => new RegExp(s, f));

const key = fc.constantFrom('a', 'b', 'c', 'length', 'toString', 'constructor', '0');
const shortUnit = fc.constantFrom('a', 'b', '$', '&', ' ');
const prim = fc.oneof(
  fc.integer({ min: -20, max: 20 }),
  fc.double(),
  fc.string({ maxLength: 5 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(NaN),
  fc.constant(-0),
  fc.bigInt({ min: -5n, max: 5n }),
);
const text = fc.oneof(fc.string({ maxLength: 12 }), fc.string({ unit: 'binary', maxLength: 6 }), fc.string({ unit: shortUnit, maxLength: 6 }));
const shorttext = fc.string({ unit: shortUnit, maxLength: 6 });
const num = fc.oneof(fc.integer({ min: -5, max: 40 }), fc.double());
const date = fc.oneof({ weight: 9, arbitrary: fc.date({ min: new Date(-8.64e15), max: new Date(8.64e15), noInvalidDate: true }) }, { weight: 1, arbitrary: fc.constant(null).map(() => new Date(NaN)) });
const obj = fc.dictionary(key, prim, { maxKeys: 4 });
const list = fc.array(prim, { maxLength: 6 });

export const gens = {
  unit: fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
  urlpath: fc.oneof(fc.constantFrom('/books', 'books?id=3', '../up', '#top', '?q=a b', 'https://other.test/x', '//cdn.test/y', ''), fc.webPath()),
  urlbase: fc.constantFrom('https://example.test/a/b', 'https://example.test/', 'http://localhost:8080/app/'),
  rawtemplate: fc.array(fc.string({ maxLength: 3 }), { maxLength: 4 }).map((raw) => ({ raw })),
  descriptor: fc.record({ value: prim, writable: fc.boolean(), enumerable: fc.boolean(), configurable: fc.boolean() }, { requiredKeys: [] }),
  descriptormap: fc.dictionary(key, fc.record({ value: prim, writable: fc.boolean(), enumerable: fc.boolean(), configurable: fc.boolean() }, { requiredKeys: [] }), { maxKeys: 3 }),
  prim,
  text,
  shorttext,
  spacedtext: fc.string({ unit: fc.constantFrom('a', ' ', '\t', '\n', ' ', '﻿'), maxLength: 8 }),
  num,
  nat: fc.integer({ min: 0, max: 20 }),
  smallint: fc.integer({ min: -5, max: 5 }),
  pos: fc.integer({ min: 1, max: 5 }),
  nzint: fc.oneof(fc.integer({ min: -3, max: -1 }), fc.integer({ min: 1, max: 3 })),
  digits: fc.integer({ min: 0, max: 4 }),
  bool: fc.boolean(),
  bigint: fc.bigInt({ min: -1000n, max: 1000n }),
  smallbigint: fc.bigInt({ min: -6n, max: 6n }),
  key,
  keys: fc.array(key, { maxLength: 3 }),
  obj,
  objornull: fc.oneof(obj, fc.constant(null), fc.constant(undefined)),
  mixed: fc.oneof(prim, list, obj, date, fc.constant(null).map(() => new Map([[1, 2]])), fc.constant(null).map(() => /a/g)),
  nullish: fc.oneof(fc.constant(null), fc.constant(undefined), prim),
  undef: fc.constant(undefined),
  list,
  list1: fc.array(prim, { minLength: 1, maxLength: 6 }),
  listornull: fc.oneof(list, fc.constant(null), fc.constant(undefined)),
  nums: fc.array(fc.double(), { maxLength: 6 }),
  texts: fc.array(text, { maxLength: 5 }),
  nested: fc.array(fc.oneof(prim, fc.array(prim, { maxLength: 3 }), fc.array(fc.array(prim, { maxLength: 2 }), { maxLength: 2 })), { maxLength: 5 }),
  pairs: fc.array(fc.tuple(key, prim), { maxLength: 4 }),
  anypairs: fc.array(fc.tuple(prim, prim), { maxLength: 4 }),
  regex: fresh(regexSources),
  gregex: fresh(regexSources.filter(([, f]) => f.includes('g'))),
  ngregex: fresh(regexSources.filter(([, f]) => !f.includes('g'))),
  date,
  isotext: fc.oneof(date.map((d) => (Number.isNaN(d.getTime()) ? 'not a date' : d.toISOString())), fc.string({ maxLength: 8 })),
  numtext: fc.oneof(fc.string({ maxLength: 6 }), num.map(String), fc.constantFrom(' 12px', '0x1A', '1e3', '-0', '.5', 'Infinity', '08', '  -7.5e-2abc')),
  jsonvalue: fc.jsonValue({ maxDepth: 2 }),
  pred: fc.func(fc.boolean()),
  fn: fc.func(prim),
  cmp: fc.func(fc.integer({ min: -2, max: 2 })),
  fntext: fc.func(shorttext),
  fnnested: fc.func(fc.oneof(prim, fc.array(prim, { maxLength: 3 }))),
  keyfn: fc.func(fc.constantFrom('x', 'y', 'z', 'toString')),
  ctor: fc.constantFrom(Date, Array, Object, RegExp, Map, Error),
  map: fc.array(fc.tuple(prim, prim), { maxLength: 4 }).map((e) => new Map(e)),
  set: list.map((a) => new Set(a)),
  weakmap: fc.constant(null).map(() => new WeakMap()),
  weakset: fc.constant(null).map(() => new WeakSet()),
  promise: prim.map((v) => Promise.resolve(v)),
};

/** The fast-check arbitrary for a generator name ("lazy:x" and "const:[...]" included). */
export function arb(name) {
  if (name.startsWith('lazy:')) return arb(name.slice(5));
  if (name.startsWith('const:')) return fc.constantFrom(...JSON.parse(name.slice(6)));
  const a = gens[name];
  if (!a) throw new Error(`no generator named ${name}`);
  return a;
}
