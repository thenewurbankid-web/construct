// #387 -- mechanical verification that an AI extraction did not invent content: every field must be quoted text
// found in the fetched page text (design docs/design/ia-five-screens.md 9.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuotedIn, verifyExtraction } from '../packages/engine/storyVerifyExtraction.mjs';

const PAGE = 'Refund a delivered order\n\nThe refund button shows only on delivered orders.\n\nAcceptance:\n- Shows only when delivered\n- Hidden otherwise';

test('isQuotedIn: an exact substring is quoted', () => {
  assert.equal(isQuotedIn(PAGE, 'Refund a delivered order'), true);
});

test('isQuotedIn: whitespace differences (wrapping/indentation) do not defeat the match', () => {
  assert.equal(isQuotedIn(PAGE, '  Refund   a delivered   order  '), true);
});

test('isQuotedIn: invented text is rejected', () => {
  assert.equal(isQuotedIn(PAGE, 'Refund a cancelled order'), false);
});

test('isQuotedIn: empty or non-string values are never quoted', () => {
  assert.equal(isQuotedIn(PAGE, ''), false);
  assert.equal(isQuotedIn(PAGE, undefined), false);
  assert.equal(isQuotedIn(PAGE, 42), false);
});

test('verifyExtraction: a real field is verified, an invented one is rejected with a reason', () => {
  const r = verifyExtraction(PAGE, { title: 'Refund a delivered order', status: 'Cancelled and refunded automatically' });
  assert.equal(r.verified.title, 'Refund a delivered order');
  assert.equal(r.verified.status, undefined);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].name, 'status');
  assert.ok(r.rejected[0].reason);
});

test('verifyExtraction: a list field (acceptance) is verified item by item', () => {
  const r = verifyExtraction(PAGE, { acceptance: ['Shows only when delivered', 'Hidden otherwise', 'Refunds instantly (invented)'] });
  assert.deepEqual(r.verified.acceptance, ['Shows only when delivered', 'Hidden otherwise']);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].value, 'Refunds instantly (invented)');
});

test('verifyExtraction: a list field with every item invented is entirely absent from verified', () => {
  const r = verifyExtraction(PAGE, { acceptance: ['Nope', 'Also nope'] });
  assert.equal(r.verified.acceptance, undefined);
  assert.equal(r.rejected.length, 2);
});

test('verifyExtraction: an empty values object verifies nothing and rejects nothing', () => {
  const r = verifyExtraction(PAGE, {});
  assert.deepEqual(r.verified, {});
  assert.deepEqual(r.rejected, []);
});

test('verifyExtraction: never throws on a missing/malformed pageText', () => {
  assert.doesNotThrow(() => verifyExtraction(undefined, { title: 'x' }));
  assert.deepEqual(verifyExtraction(undefined, { title: 'x' }).verified, {});
});
