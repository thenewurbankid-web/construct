// Worked examples on PLAIN data rows -- one or more per hand-written atom. A test fails if any
// hand-written atom has no example, so a new atom can't land without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const s = require('../dist/index.js');
const catalog = JSON.parse(readFileSync(new URL('../src/atoms/catalog.json', import.meta.url), 'utf8'));

const books = [
  { id: 3, title: 'Dune', available: true },
  { id: 1, title: 'Emma', available: false },
  { id: 2, title: 'Beloved', available: true },
];
const [dune, emma, beloved] = books;
const day = (iso) => new Date(`${iso}T00:00:00Z`);

const examples = {
  equals: [[[dune.id, 3], true], [[NaN, NaN], false], [[0, -0], true]],
  differs: [[[dune.title, 'Emma'], true]],
  lessThan: [[[1, 2], true], [['b', 'a'], false]],
  atMost: [[[2, 2], true]],
  greaterThan: [[[3n, 2n], true]],
  atLeast: [[[day('2026-01-02'), day('2026-01-01')], true]],
  plus: [[[0.1, 0.2], 0.30000000000000004], [[2n, 3n], 5n]],
  join: [[['Du', 'ne'], 'Dune']],
  minus: [[[5, 7], -2]],
  times: [[[4, 2.5], 10]],
  dividedBy: [[[1, 0], Infinity]],
  remainder: [[[-7, 3], -1]],
  power: [[[2, 10], 1024]],
  negate: [[[5], -5]],
  not: [[[emma.available], true]],
  and: [[[dune.available, () => dune.title], 'Dune'], [[emma.available, () => emma.title], false], [[true, false], false]],
  or: [[['', () => 'untitled'], 'untitled'], [[true, false], true]],
  orElse: [[[0, () => 9], 0], [[null, () => 9], 9]],
  when: [[[dune.available, () => 'on shelf', () => 'out'], 'on shelf'], [[false, () => 1], undefined]],
  choose: [[[[[emma.available, () => 'emma'], [() => dune.available, () => 'dune']], () => 'none'], 'dune']],
  match: [[['live', { draft: () => 0, live: () => 1 }], 1], [['gone', { draft: () => 0 }, () => -1], -1]],
  attempt: [[[() => JSON.parse('{'), () => 'bad json', () => {}], 'bad json'], [[() => 7], 7]],
  fail: { run: () => assert.throws(() => s.fail(new RangeError('x')), RangeError) },
  each: { run: () => { const seen = []; s.each(books, (b) => seen.push(b.id)); assert.deepStrictEqual(seen, [3, 1, 2]); } },
  repeatWhile: { run: () => { let n = 0; assert.deepStrictEqual(s.repeatWhile(() => n < 3, () => n++, 10), { steps: 3, stoppedByLimit: false }); } },
  iterateWhile: [[[1, (x) => x < 100, (x) => x * 2, 10], 128]],
  isText: [[[dune.title], true], [[dune.id], false]],
  isNumber: [[[NaN], true]],
  isBoolean: [[[dune.available], true]],
  isNothing: [[[undefined], true], [[0], false]],
  hasKey: [[[dune, 'title'], true], [[dune, 'toString'], false], [[null, 'x'], false]],
  isA: [[[day('2026-01-01'), Date], true]],
  get: [[[dune, 'title'], 'Dune'], [[null, 'title'], undefined]],
  at: [[[books, -1], beloved], [[undefined, 0], undefined]],
  lengthOf: [[['Dune'], 4], [[books], 3]],
  hasText: [[['Beloved', 'love'], true]],
  hasItem: [[[[1, NaN], NaN], true]],
  lowerCase: [[['DUNE'], 'dune']],
  upperCase: [[['dune'], 'DUNE']],
  trimmed: [[['  Emma \n'], 'Emma']],
  doesStartWith: [[['Dune', 'Du'], true]],
  doesEndWith: [[['Dune', 'ne'], true]],
  splitBy: [[['a,b,,c', ','], ['a', 'b', '', 'c']]],
  joinWith: [[[['a', 'b'], ' & '], 'a & b']],
  replaceEvery: [[['a-b-c', '-', '+'], 'a+b+c'], [['a1b22', /\d/, '#'], 'a#b##']],
  replaceFirst: [[['a-b-c', /-/g, '+'], 'a+b-c']],
  padLeft: [[['7', 3, '0'], '007']],
  padRight: [[['7', 3], '7  ']],
  sliceText: [[['Beloved', 2, 6], 'love']],
  letterAt: [[['Dune', 0], 'D'], [['Dune', 9], '']],
  repeatText: [[['ab', 3], 'ababab']],
  firstOf: [[[books], dune], [[[]], undefined]],
  lastOf: [[[books], beloved]],
  positionOf: [[[[3, 1, 2], 1], 1]],
  positionWhere: [[[books, (b) => !b.available], 1]],
  mapEach: [[[books, (b) => b.title], ['Dune', 'Emma', 'Beloved']]],
  keepWhere: [[[books, (b) => b.available], [dune, beloved]]],
  reduceTo: [[[books, (n, b) => n + b.id, 0], 6]],
  findFirst: [[[books, (b) => b.id === 2], beloved]],
  hasAnyWhere: [[[books, (b) => !b.available], true]],
  isEveryWhere: [[[books, (b) => b.available], false]],
  sortedBy: [[[books, 'title'], [beloved, dune, emma]], [[books, (b) => b.id], [emma, beloved, dune]], [[[10, 9, 1]], [1, 10, 9]]],
  reversed: [[[[1, 2, 3]], [3, 2, 1]]],
  part: [[[books, 1], [emma, beloved]]],
  concatenated: [[[[1], [2, 3]], [1, 2, 3]]],
  flattened: [[[[1, [2, [3]]]], [1, 2, [3]]], [[[1, [2, [3]]], 2], [1, 2, 3]]],
  flatMapEach: [[[books, (b) => [b.id, b.id]], [3, 3, 1, 1, 2, 2]]],
  uniqueOf: [[[[1, 1, NaN, NaN]], [1, NaN]]],
  countOf: [[[books, (b) => b.available], 2]],
  groupedBy: { run: () => assert.deepStrictEqual({ ...s.groupedBy(books, (b) => (b.available ? 'in' : 'out')) }, { in: [dune, beloved], out: [emma] }) },
  chunked: [[[[1, 2, 3, 4, 5], 2], [[1, 2], [3, 4], [5]]]],
  range: [[[0, 5], [0, 1, 2, 3, 4]], [[5, 0, -2], [5, 3, 1]]],
  listFrom: [[['abc'], ['a', 'b', 'c']], [[new Set([1, 2]), (x) => x * 10], [10, 20]]],
  added: [[[[1], 2], [1, 2]]],
  prepended: [[[[1], 0], [0, 1]]],
  removedAt: [[[books, 0], [emma, beloved]]],
  insertedAt: [[[[1, 3], 1, 2], [1, 2, 3]]],
  replacedAt: [[[[1, 2, 3], -1, 9], [1, 2, 9]]],
  keysOf: [[[dune], ['id', 'title', 'available']]],
  valuesOf: [[[{ a: 1, b: 2 }], [1, 2]]],
  entriesOf: [[[{ a: 1 }], [['a', 1]]]],
  fromEntries: [[[[['a', 1]]], { a: 1 }]],
  merged: [[[dune, { available: false }], { id: 3, title: 'Dune', available: false }]],
  withKey: [[[emma, 'available', true], { id: 1, title: 'Emma', available: true }]],
  withoutKey: [[[dune, 'available'], { id: 3, title: 'Dune' }]],
  pick: [[[dune, ['id', 'title']], { id: 3, title: 'Dune' }]],
  omit: [[[dune, ['id', 'title']], { available: true }]],
  largestOf: [[[[3, 1, 2]], 3], [[[]], -Infinity]],
  smallestOf: [[[[3, 1, 2]], 1]],
  roundedTo: [[[3.14159, 2], 3.14]],
  floorOf: [[[-1.5], -2]],
  ceilingOf: [[[1.2], 2]],
  absoluteOf: [[[-4], 4]],
  clamp: [[[15, 0, 10], 10]],
  sumOf: [[[[1, 2, 3]], 6]],
  averageOf: [[[[1, 2, 3]], 2], [[[]], NaN]],
  isWhole: [[[3], true], [[3.5], false]],
  parseNumber: [[['12.5px'], 12.5]],
  parseWhole: [[['08'], 8]],
  formatNumber: [[[1234567.891], '1,234,567.891'], [[0.5, 'en-US', { style: 'percent' }], '50%']],
  parseJson: [[['{"id":3}'], { ok: true, value: { id: 3 } }]],
  toJson: [[[dune], '{"id":3,"title":"Dune","available":true}']],
  dateFrom: [[['2026-10-14T00:00:00Z'], day('2026-10-14')]],
  formatDate: [[[day('2026-10-14')], '10/14/2026']],
  addDays: [[[day('2026-02-28'), 1], day('2026-03-01')]],
  daysBetween: [[[day('2026-01-01'), day('2026-03-01')], 59]],
  isBefore: [[[day('2026-01-01'), day('2026-01-02')], true]],
  isAfter: [[[day('2026-01-01'), day('2026-01-02')], false]],
  allOf: { run: async () => assert.deepStrictEqual(await s.allOf([1, Promise.resolve(2)]), [1, 2]) },
  firstSettled: { run: async () => assert.equal(await s.firstSettled([s.delay(20, 'slow'), 'now']), 'now') },
  settledAll: { run: async () => assert.deepStrictEqual(await s.settledAll([1, Promise.reject(new Error('x')).catch(() => 'caught')]), [{ status: 'fulfilled', value: 1 }, { status: 'fulfilled', value: 'caught' }]) },
  setOf: [[[[1, 1, 2]], new Set([1, 2])]],
  isInSet: [[[new Set([dune.id]), 3], true]],
  withMember: { run: () => { const a = new Set([1]); assert.deepStrictEqual(s.withMember(a, 2), new Set([1, 2])); assert.deepStrictEqual(a, new Set([1])); } },
  mapOf: [[[[[1, 'a']]], new Map([[1, 'a']])]],
  getFrom: [[[new Map([[3, dune]]), 3], dune]],
  withEntry: { run: () => { const m = new Map(); assert.deepStrictEqual(s.withEntry(m, 'k', 1), new Map([['k', 1]])); assert.equal(m.size, 0); } },
  sizeOf: [[[new Set([1, 2])], 2]],
  attemptAsync: { run: async () => assert.equal(await s.attemptAsync(async () => { throw new Error('x'); }, async (e) => e.message), 'x') },
  now: [[[() => 0], new Date(0)]],
  nowTime: [[[() => 1760400000000], 1760400000000]],
  random: [[[() => 0.25], 0.25]],
  seededSource: { run: () => assert.deepStrictEqual([1, 2, 3].map(s.seededSource(7)), [1, 2, 3].map(s.seededSource(7))) },
  randomBetween: [[[10, 20, () => 0.5], 15]],
  delay: { run: async () => assert.equal(await s.delay(1, 'done'), 'done') },
  fetchJson: { run: async () => {
    const fake = async (url) => (url === '/ok' ? { ok: true, status: 200, json: async () => books } : { ok: false, status: 404, json: async () => null });
    assert.deepStrictEqual(await s.fetchJson('/ok', undefined, fake), { ok: true, value: books });
    const missing = await s.fetchJson('/missing', undefined, fake);
    assert.equal(missing.ok, false);
    const broken = await s.fetchJson('/x', undefined, async () => { throw new TypeError('offline'); });
    assert.equal(broken.ok, false);
  } },
  readStorage: { run: () => { const store = new Map(); const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }; assert.equal(s.readStorage('k', fake), undefined); s.writeStorage('k', 'v', fake); assert.equal(s.readStorage('k', fake), 'v'); } },
  writeStorage: { run: () => { const calls = []; s.writeStorage('a', 'b', { getItem: () => null, setItem: (k, v) => calls.push([k, v]) }); assert.deepStrictEqual(calls, [['a', 'b']]); } },
  urlFrom: [[['/books?id=3', 'https://example.test/a/'], 'https://example.test/books?id=3']],
  withQuery: [[['https://example.test/books?id=1', { id: 3, q: 'a b' }], 'https://example.test/books?id=3&q=a+b']],
};

test('every hand-written atom has at least one example', () => {
  const missing = catalog.atoms.filter((a) => !a.generated && !examples[a.atom]).map((a) => a.atom);
  assert.deepStrictEqual(missing, []);
});

let count = 0;
for (const [name, spec] of Object.entries(examples)) {
  if (Array.isArray(spec)) {
    count += spec.length;
    test(`${name} examples`, () => {
      for (const [args, expected] of spec) assert.deepStrictEqual(s[name](...args), expected, `${name}(${args.map(String).join(', ')})`);
    });
  } else {
    count += 1;
    test(`${name} example`, spec.run);
  }
}
test('new Promise (promiseFrom) settles through its executor', async () => {
  assert.equal(await s.promiseFrom((resolve) => resolve(dune.title)), 'Dune');
});
test('example count', () => console.log(`# examples: ${count + 1}`));
