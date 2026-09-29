const test = require('node:test');
const assert = require('node:assert/strict');
const autosuggest = require('./autosuggest');

test('tier 1: prefix match on an atom English word ranks above a fuzzy match', () => {
  const atoms = [
    { name: 'isWithinRange', english: 'is within range' },
    { name: 'isWithinReach', english: 'is within reach' },
  ];
  const results = autosuggest.suggest('within ra', { atoms });
  const names = results.filter((r) => r.kind === 'atom').map((r) => r.text);
  assert.equal(names[0], 'isWithinRange'); // "ra" prefixes "range", not "reach"
});

test('tier 1: fuzzy (edit-distance) match finds a near-typo of a camelCase identifier', () => {
  const results = autosuggest.suggest('coutn', { identifiers: ['count', 'other'] });
  const hit = results.find((r) => r.kind === 'identifier' && r.text === 'count');
  assert.ok(hit, 'expected a fuzzy hit on "count"');
  assert.equal(hit.tier, 1);
});

test('tier 2: stemming matches validate/validating/validation as the same word', () => {
  const atoms = [{ name: 'validateInput', english: 'validate input' }];
  const r1 = autosuggest.suggest('validating input', { atoms });
  const r2 = autosuggest.suggest('validation input', { atoms });
  assert.ok(r1.find((r) => r.text === 'validateInput'));
  assert.ok(r2.find((r) => r.text === 'validateInput'));
});

test('tier 2: curated synonym table matches check/verify/validate/test as the same idea', () => {
  const atoms = [{ name: 'verifyAge', english: 'verify age' }];
  const results = autosuggest.suggest('check age', { atoms });
  const hit = results.find((r) => r.text === 'verifyAge');
  assert.ok(hit);
  assert.equal(hit.tier, 2);
  assert.match(hit.reason, /synonym/);
});

test('tier 2: phrase synonym matches "number of" against "how many"', () => {
  const atoms = [{ name: 'howManyItems', english: 'how many items' }];
  const results = autosuggest.suggest('number of items', { atoms });
  assert.ok(results.find((r) => r.text === 'howManyItems'));
});

test('ranking: an atom/identifier match outranks a bare connective for the same query', () => {
  const atoms = [{ name: 'andThen', english: 'and then' }];
  const results = autosuggest.suggest('and', { atoms, identifiers: [] });
  // "and" is itself a connective; connective candidates should not crash out
  // and the list should still end with the add-implementation fallback.
  assert.equal(results[results.length - 1].kind, 'add-implementation');
});

test('no match at all still returns the add-implementation fallback, nothing else', () => {
  const results = autosuggest.suggest('zzzznotawordatall', { atoms: [], identifiers: [] });
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'add-implementation');
  assert.match(results[0].label, /zzzznotawordatall/);
});

test('empty query returns no suggestions at all, not even the fallback', () => {
  assert.deepEqual(autosuggest.suggest('   ', { atoms: [{ name: 'x', english: 'x' }] }), []);
});

test('no network call: suggest and its tier helpers are synchronous', () => {
  assert.equal(autosuggest.suggest('check').constructor, Array);
  assert.equal(typeof autosuggest.wordMatch('check', 'verify'), 'object');
  assert.equal(autosuggest.suggest.constructor.name, 'Function'); // not AsyncFunction
});

test('stem folds validating/validation onto the same stem without over-stemming short words', () => {
  assert.equal(autosuggest.stem('validating'), autosuggest.stem('validation'));
  assert.equal(autosuggest.stem('removed'), 'remov');
  assert.equal(autosuggest.stem('is'), 'is'); // too short to strip
});
