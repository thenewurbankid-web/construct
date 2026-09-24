import test from 'node:test';
import assert from 'node:assert/strict';
import { plainQuestion } from './PlainQuestion.ts';

test('a [y/N] prompt becomes a Yes or No question with its default named', () => {
  assert.equal(plainQuestion('Approve this plan and build it now? [y/N]: '), 'Approve this plan and build it now? (Yes or No; No if left blank)');
  assert.equal(plainQuestion('Keep going? [Y/n]: '), 'Keep going? (Yes or No; Yes if left blank)');
});

test('the Next.js app directory prompt asks where the routes are, with the default', () => {
  assert.equal(
    plainQuestion('Path to your Next.js app/ directory (needed to resolve a URL route) [app]: '),
    "Where are your app's routes? (default: app)",
  );
  assert.equal(plainQuestion('Path to your Next.js app/ directory (needed to resolve a URL route): '), "Where are your app's routes?");
});

test('any other prompt only loses its trailing colon, and no [y/N] survives', () => {
  assert.equal(plainQuestion('Destination feature (Construct feature name): '), 'Destination feature (Construct feature name)');
  assert.equal(plainQuestion('After you approve the plan, should the LLM also write the ported logic (not just TODO breadcrumbs)? [y/N]: ').includes('[y/N]'), false);
});
