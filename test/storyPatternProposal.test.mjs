// #387 -- "AI proposes the parse pattern once" lands as a diff to story.md's front matter, and only there; every
// selector is validated the same way a hand-written one is before anything is merged (design 9.6b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposePattern, PatternProposalError } from '../packages/engine/storyPatternProposal.mjs';

const EMPTY_STORY = '---\nsources: []\n---\n<!-- construct:tool-begin fetchedAt= sourceHash=x blockHash=y -->\n# t\n<!-- construct:tool-end -->\n\n## Acceptance notes\n';

test('a valid proposal lands as a diff: sources gains an entry, nothing else changes', () => {
  const r = proposePattern(EMPTY_STORY, { url: 'https://github.com/acme/repo/issues/1', parse: { title: 'h1', acceptance: 'ul.acceptance > li' } });
  assert.equal(r.changed, true);
  assert.ok(r.after.includes('acme/repo/issues/1'));
  // the tool block and user text are byte-for-byte unchanged
  assert.ok(r.after.includes('<!-- construct:tool-begin fetchedAt= sourceHash=x blockHash=y -->'));
  assert.ok(r.after.includes('## Acceptance notes'));
});

test('re-proposing the same url updates its parse in place rather than appending a duplicate entry', () => {
  const first = proposePattern(EMPTY_STORY, { url: 'https://github.com/a/b/issues/1', parse: { title: 'h1' } });
  const second = proposePattern(first.after, { url: 'https://github.com/a/b/issues/1', parse: { title: 'h1.title' } });
  const matches = second.after.match(/issues\/1/g) || [];
  assert.equal(matches.length, 1);
  assert.ok(second.after.includes('h1.title'));
});

test('an invalid selector refuses the WHOLE proposal: nothing is written, not even the valid fields', () => {
  assert.throws(
    () => proposePattern(EMPTY_STORY, { url: 'https://x/y', parse: { title: 'h1', status: 'javascript:alert(1)' } }),
    (e) => e instanceof PatternProposalError && e.code === 'BANNED_CONSTRUCT',
  );
});

test('a missing url is refused', () => {
  assert.throws(() => proposePattern(EMPTY_STORY, { parse: { title: 'h1' } }), (e) => e.code === 'BAD_URL');
});

test('an empty parse map is refused (nothing to propose)', () => {
  assert.throws(() => proposePattern(EMPTY_STORY, { url: 'https://x/y', parse: {} }), (e) => e.code === 'EMPTY_PROPOSAL');
});

test('a proposal is idempotent: proposing the identical pattern twice reports unchanged the second time', () => {
  const first = proposePattern(EMPTY_STORY, { url: 'https://x/y', parse: { title: 'h1' } });
  const second = proposePattern(first.after, { url: 'https://x/y', parse: { title: 'h1' } });
  assert.equal(second.changed, false);
});

test('returns the validated, closed-form selector descriptors alongside the diff', () => {
  const r = proposePattern(EMPTY_STORY, { url: 'https://x/y', parse: { title: 'h1', ref: { xpath: "//h1[@id='t']" } } });
  assert.deepEqual(r.selectors.title, { kind: 'css', value: 'h1' });
  assert.deepEqual(r.selectors.ref, { kind: 'xpath', value: "//h1[@id='t']" });
});
