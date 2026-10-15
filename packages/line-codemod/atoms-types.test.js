// The type rule (atoms-transform.js, owner 2026-10-15): an atom is only used on the type it is for, read from the
// code's own declarations; where no atom is for that type, the code stays as it is and is reported as a gap that
// names its JS reference entry. Runs on the real Smith catalog.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { toAtoms } = require('./atoms-transform');
const fs = require('fs');
const { loadCatalog, compileCatalog, paramsFromSource } = require('./atoms-catalog');

const CATALOG = path.join(__dirname, '../line-smith/src/atoms/catalog.json');
const catalog = loadCatalog(CATALOG);

const STACK = `function stackEntries(filteredOpportunities, getInitiativeDescription) {
  const groups = new Map();
  for (const opp of filteredOpportunities) {
    const title = getInitiativeDescription(opp)?.trim().toLowerCase();
    const key = title ? \`t:\${title}\` : \`id:\${opp.id}\`;
    const group = groups.get(key);
    if (group) group.push(opp);
    else groups.set(key, [opp]);
  }
  return Array.from(groups.entries());
}`;

test('a Map declared in the code takes Map atoms: get and entries are decided, never asked', () => {
  const r = toAtoms(STACK, { catalog });
  assert.match(r.code, /const group = getFrom\(groups, key\);/);
  assert.match(r.code, /return listFrom\(entriesOfMap\(groups\)\);/);
  assert.deepEqual(r.ambiguous, []);
});

test('no atom for a Map\'s set: the code stays as written and is a gap naming its reference entry', () => {
  // The catalog as it was before createsAtTo was registered from this gap (owner, 2026-10-15).
  const raw = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const before = compileCatalog({ ...raw, atoms: raw.atoms.filter((a) => a.atom !== 'createsAtTo') }, { signatures: paramsFromSource(path.join(__dirname, '../line-smith')) });
  const r = toAtoms(STACK, { catalog: before });
  assert.doesNotMatch(r.code, /setInWeakMap/, 'never a neighbouring type\'s atom');
  assert.match(r.code, /groups\.set\(key, \[opp\]\)/);
  assert.deepEqual(r.gaps.map(({ type, member, entry, code }) => ({ type, member, entry, code })), [
    { type: 'map', member: 'set', entry: 'Map.prototype.set', code: 'groups.set(key, [opp])' },
  ]);
  assert.ok(r.untranslated.some((u) => u.reason === 'no atom for a map'));
});

test('the atom registered from that gap closes it: the next run finds createsAtTo', () => {
  const r = toAtoms(STACK, { catalog });
  assert.match(r.code, /createsAtTo\(groups, key, \[opp\]\)/);
  assert.deepEqual(r.gaps, []);
});

test('a WeakMap declared in the code still takes the WeakMap atom', () => {
  const r = toAtoms('const seen = new WeakMap();\nconst k = {};\nseen.set(k, 1);', { catalog });
  assert.match(r.code, /setInWeakMap\(seen, k, 1\)/);
  assert.deepEqual(r.gaps, []);
});

test('a name whose type the code does not show is left to the existing rules (no gap is invented)', () => {
  const r = toAtoms('function f(m, k) { return m.get(k); }', { catalog });
  assert.deepEqual(r.gaps, []);
});
