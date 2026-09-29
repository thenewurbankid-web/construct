import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageSummary, rowsByGroup, sentenceViews, specRows } from './SpecBreakdownView.ts';

// A hand-built read-back matching research/readBack.mjs's real shape (construct.machine-spec-readback.v1), small
// enough to hand-check, covering all three sentence statuses so the tone mapping has something to assert on.
const readBack = {
  schema: 'construct.machine-spec-readback.v1',
  name: 'sign-in with retry',
  feature: 'auth',
  summary: 'sign-in with retry has 5 states and 5 transitions.',
  sentences: [
    {
      id: 's1', text: 'A visitor signs in.', status: 'covered', reason: null,
      states: [{ id: 'idle', req: ['s1'], text: '`idle` is the starting state.' }],
      events: [{ id: 'SUBMIT', req: ['s1'], text: '`SUBMIT` carries `{ email, password }`.' }],
      transitions: [{ id: 't1', req: ['s1'], text: 'On `SUBMIT`, `idle` moves to `checking`.' }],
      functions: [],
    },
    {
      id: 's6', text: 'The sign-in page must load in under two seconds.', status: 'out-of-scope', reason: 'A performance budget, not machine behaviour.',
      states: [], events: [], transitions: [], functions: [],
    },
    {
      id: 's7', text: 'A visitor can also sign in with a passkey.', status: 'uncovered', reason: null,
      states: [], events: [], transitions: [], functions: [],
    },
    {
      id: 's3', text: 'A valid pair signs the visitor in.', status: 'covered', reason: null,
      states: [{ id: 'signedIn', req: ['s3'], text: '`signedIn` is a final state.' }],
      events: [],
      transitions: [{ id: 't2', req: ['s3'], text: 'On `VALID`, `checking` moves to `signedIn`.' }],
      functions: [{ id: 'verifyCredentials', req: ['s1', 's3'], text: '`verifyCredentials` takes `{ email, password }` and returns a session or a reason.' }],
    },
  ],
  types: [],
  counts: { sentences: 4, covered: 2, outOfScope: 1, uncovered: 1, types: 0 },
};

test('specRows flattens every group across sentences, deduped by id, first-seen order', () => {
  const rows = specRows(readBack);
  const ids = rows.map((r) => `${r.group}:${r.id}`);
  assert.deepEqual(ids, ['states:idle', 'events:SUBMIT', 'transitions:t1', 'states:signedIn', 'transitions:t2', 'functions:verifyCredentials']);
});

test('specRows dedupes an id claimed by more than one sentence', () => {
  const withDup = { ...readBack, sentences: [...readBack.sentences, { ...readBack.sentences[0], id: 's1b' }] };
  const rows = specRows(withDup);
  assert.equal(rows.filter((r) => r.group === 'states' && r.id === 'idle').length, 1);
});

test('rowsByGroup filters to one group in declared order', () => {
  assert.deepEqual(rowsByGroup(readBack, 'functions').map((r) => r.id), ['verifyCredentials']);
  assert.deepEqual(rowsByGroup(readBack, 'states').map((r) => r.id), ['idle', 'signedIn']);
});

test('sentenceViews tags covered ok, out-of-scope warn, uncovered error', () => {
  const views = sentenceViews(readBack);
  assert.deepEqual(
    views.map((v) => [v.id, v.tone]),
    [['s1', 'ok'], ['s6', 'warn'], ['s7', 'error'], ['s3', 'ok']],
  );
});

test('coverageSummary reads like the CLI read-back\'s own footer line', () => {
  assert.equal(coverageSummary(readBack), '4 sentence(s): 2 covered, 1 out of scope, 1 NOT covered.');
});

test('coverageSummary omits the NOT-covered clause when nothing is uncovered', () => {
  const clean = { ...readBack, counts: { ...readBack.counts, uncovered: 0 } };
  assert.equal(coverageSummary(clean), '4 sentence(s): 2 covered, 1 out of scope.');
});
