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

test('R11: a Map changed in place stays as written and is reported as mutating, never a neighbouring type\'s atom', () => {
  const r = toAtoms(STACK, { catalog });
  assert.doesNotMatch(r.code, /setInWeakMap|withEntry/);
  assert.match(r.code, /groups\.set\(key, \[opp\]\)/);
  assert.ok(r.untranslated.some((u) => u.reason === 'mutates' && /\.set\(\)/.test(u.what ?? u.kind ?? JSON.stringify(u))), JSON.stringify(r.untranslated));
});

test('R11: the pure createsAtTo never stands in for the mutating groups.set; the call stays as written', () => {
  const r = toAtoms(STACK, { catalog });
  assert.match(r.code, /groups\.set\(key, \[opp\]\)/);
  assert.doesNotMatch(r.code, /createsAtTo/, 'a copy would change what the code does');
});

test('R11: a WeakMap\'s set has no atom (it mutates), so the call stays as written', () => {
  const r = toAtoms('const seen = new WeakMap();\nconst k = {};\nseen.set(k, 1);', { catalog });
  assert.match(r.code, /seen\.set\(k, 1\)/);
  assert.doesNotMatch(r.code, /setInWeakMap/);
});

test('a name whose type the code does not show is left to the existing rules (no gap is invented)', () => {
  const r = toAtoms('function f(m, k) { return m.get(k); }', { catalog });
  assert.deepEqual(r.gaps, []);
});
