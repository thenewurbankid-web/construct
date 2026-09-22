import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTrigger } from '../src/trigger.mjs';

test('matches a simple one-line trigger', () => {
  const result = parseTrigger('/claude fix the flaky test in test/generators.test.mjs');
  assert.deepEqual(result, { instruction: 'fix the flaky test in test/generators.test.mjs' });
});

test('matches a multi-line trigger and folds extra lines into the instruction', () => {
  const body = ['/claude investigate the failing build', '', 'It started failing after the last merge.'].join('\n');
  const result = parseTrigger(body);
  assert.equal(result.instruction, 'investigate the failing build\n\nIt started failing after the last merge.');
});

test('does not match plain discussion mentioning claude', () => {
  assert.equal(parseTrigger('I think claude could help with this'), null);
});

test('does not match when /claude is not the first line', () => {
  const body = ['This needs attention.', '/claude do something'].join('\n');
  assert.equal(parseTrigger(body), null);
});

test('is case-sensitive', () => {
  assert.equal(parseTrigger('/Claude do something'), null);
  assert.equal(parseTrigger('/CLAUDE do something'), null);
});

test('requires a word boundary, not just a prefix', () => {
  assert.equal(parseTrigger('/claudette do something'), null);
});

test('bare "/claude" with no instruction text on the first line and nothing else is not a trigger', () => {
  assert.equal(parseTrigger('/claude'), null);
  assert.equal(parseTrigger('/claude\n'), null);
});

test('bare "/claude" first line with instruction on following lines is a trigger', () => {
  const body = ['/claude', 'please look into this issue and propose a fix'].join('\n');
  const result = parseTrigger(body);
  assert.equal(result.instruction, 'please look into this issue and propose a fix');
});

test('non-string bodies are rejected safely', () => {
  assert.equal(parseTrigger(null), null);
  assert.equal(parseTrigger(undefined), null);
  assert.equal(parseTrigger(42), null);
});
