// Gate check `grammar`: every catalog sentence passes; broken sentences fail with one sentence and a typed fix.
import { withReturn } from '../../../line-smith/scripts/lib-return.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkGrammar, closestWord, editDistance } from './grammar.mjs';

const RETURN_NAMES = JSON.parse(readFileSync(new URL('../../../line-smith/src/atoms/naming.json', import.meta.url), 'utf8')).grammar.returnNames;
import { sentences } from '../../grammar/next-words.mjs';

const catalog = JSON.parse(
  readFileSync(new URL('../../../line-smith/src/atoms/catalog.json', import.meta.url), 'utf8'),
);
const catalogFluent = catalog.atoms.filter((a) => a.fluent);

test('the catalog has fluent sentences to check', () => {
  assert.ok(catalogFluent.length >= 37, `catalog has ${catalogFluent.length} fluent sentences`);
});

for (const { atom, fluent } of catalogFluent) {
  test(`catalog sentence passes: ${atom}`, () => {
    assert.deepEqual(checkGrammar({ sentence: fluent }), { check: 'pass', errors: [], fixes: [] });
  });
}

test('every R9 table sentence passes too', () => {
  for (const { fluent, source } of sentences.filter((s) => s.source.startsWith('every.'))) {
    assert.equal(checkGrammar({ sentence: fluent }).check, 'pass', `${fluent} (${source})`);
  }
});

test('skip when the sentence is null (not-expressible, molecule)', () => {
  assert.deepEqual(checkGrammar({ sentence: null }), { check: 'skip', errors: [], fixes: [] });
  assert.deepEqual(checkGrammar({}), { check: 'skip', errors: [], fixes: [] });
});

const broken = [
  {
    sentence: 'checks().if(a).is().equl().to(b)',
    error: /`equl` is not legal after `checks\(\)\.if\(a\)\.is\(\)`.*`equal`.*use `equal\(\)` instead/,
    fixes: [{ kind: 'replace-word', from: 'equl', to: 'equal' }],
  },
  {
    sentence: 'chekcs().if(a).is().equal().to(b)',
    error: /`chekcs` is not legal at the start of a sentence.*use `checks\(\)`/,
    fixes: [{ kind: 'replace-word', from: 'chekcs', to: 'checks' }],
  },
  {
    sentence: 'checks().iff(a).is().equal().to(b)',
    error: /`iff` is not legal after `checks\(\)`; legal words there are `if`/,
    fixes: [{ kind: 'replace-word', from: 'iff', to: 'if' }],
  },
  {
    sentence: 'checks().if(a).is().less().then(b)',
    error: /`then` is not legal .*legal words there are `than`/,
    fixes: [{ kind: 'replace-word', from: 'then', to: 'than' }],
  },
  {
    sentence: 'when(c).yeilds(() => a).otherwise(() => b)',
    error: /`yeilds` is not legal after `when\(c\)`.*`yields`/,
    fixes: [{ kind: 'replace-word', from: 'yeilds', to: 'yields' }],
  },
  {
    sentence: 'every(x).in(xs).is().kep().if(x).is().positive()',
    error: /`kep` is not legal after `every\(x\)\.in\(xs\)\.is\(\)`; legal words there are `kept`, `mapped`/,
    fixes: [{ kind: 'replace-word', from: 'kep', to: 'kept' }],
  },
  {
    sentence: 'checks().if(a).is().really().equal().to(b)',
    error: /`really` is not legal .*; remove it\.$/,
    fixes: [{ kind: 'remove-word', word: 'really' }],
  },
  {
    sentence: 'zzzqqq().if(a)',
    error: /`zzzqqq` is not legal at the start of a sentence.*`checks`.*remove it/,
    fixes: [{ kind: 'remove-word', word: 'zzzqqq' }],
  },
  {
    sentence: 'checks().if(a).is().equal()',
    error: /`checks\(\)\.if\(a\)\.is\(\)\.equal\(\)` is incomplete; it may continue with `to`\./,
    fixes: [],
  },
  {
    sentence: 'when(c).yields(() => a)',
    error: /is incomplete; it may continue with `otherwise`/,
    fixes: [],
  },
  {
    sentence: 'checks(',
    error: /is not a chain of calls/,
    fixes: [],
  },
];

for (const { sentence, error, fixes } of broken) {
  test(`broken sentence fails: ${sentence}`, () => {
    const r = checkGrammar({ sentence });
    assert.equal(r.check, 'fail');
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], error);
    assert.deepEqual(r.fixes, fixes);
  });
}

test('applying a replace-word or remove-word fix yields a passing sentence', () => {
  for (const { sentence, fixes } of broken) {
    const [fix] = fixes;
    if (!fix) continue;
    const fixed =
      fix.kind === 'replace-word'
        ? sentence.replace(`${fix.from}(`, `${fix.to}(`)
        : sentence.replace(`${fix.word}().`, '');
    if (fix.word === 'zzzqqq') continue; // removing the only verb leaves no sentence start
    assert.equal(checkGrammar({ sentence: withReturn(fixed, RETURN_NAMES) }).check, 'pass', fixed);
  }
});

test('editDistance and closestWord', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(closestWord('flatened', ['flattens', 'clone']), 'flattens');
  assert.equal(closestWord('really', ['equal', 'less']), null);
  assert.equal(closestWord('x', []), null);
});
