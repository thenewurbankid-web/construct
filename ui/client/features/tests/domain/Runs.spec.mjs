// Pure logic of a test run on the Tests screen (#305): words, symbols, durations, picking an outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMs, liveText, outcomeFor, outcomeView, problemView, runSummary } from './Runs.ts';

const snap = (over = {}) => ({
  ok: true, live: null, problem: null, defaultBaseUrl: 'http://localhost:3000',
  tests: [
    { file: 'a--b.spec.ts', area: 'generated', title: 'Happy path', status: 'passed', durationMs: 900 },
    { file: 'a--b.spec.ts', area: 'yours', title: 'Same name, yours', status: 'failed', durationMs: 5000 },
  ],
  lastRun: { baseUrl: 'http://localhost:3000', durationMs: 12_345, counts: { total: 3, passed: 1, failed: 1, notRun: 1 }, target: null, processId: 'p' },
  ...over,
});

test('every outcome has a symbol AND a word (never colour alone)', () => {
  for (const s of ['passed', 'failed', 'not-run']) {
    const v = outcomeView(s);
    assert.ok(v.symbol.length > 0 && v.word.length > 0);
  }
  assert.equal(outcomeView('failed').word, 'Failed');
  assert.equal(outcomeView('not-run').word, 'Not run');
});

test('durations read naturally', () => {
  assert.equal(formatMs(412), '412 ms');
  assert.equal(formatMs(5500), '5.5 s');
  assert.equal(formatMs(72_000), '1 min 12 s');
});

test('an outcome is found by area AND file, so a clone is never mistaken for the generated test', () => {
  assert.equal(outcomeFor(snap(), 'generated', 'a--b.spec.ts').title, 'Happy path');
  assert.equal(outcomeFor(snap(), 'yours', 'a--b.spec.ts').status, 'failed');
  assert.equal(outcomeFor(snap(), 'yours', 'other.spec.ts'), null);
  assert.equal(outcomeFor(null, 'yours', 'a--b.spec.ts'), null);
});

test('the summary and the live sentence', () => {
  assert.equal(runSummary(snap()), '1 passed · 1 failed · 1 not run · 12.3 s');
  assert.equal(runSummary(snap({ lastRun: null })), '');
  assert.match(liveText(snap({ live: { state: 'running', processId: 'p', target: null } }), 'refunds'), /Running every test of refunds/);
  assert.match(liveText(snap({ live: { state: 'queued', processId: 'p', target: { name: 'x.spec.ts', area: 'yours' } } }), 'refunds'), /Waiting to run x\.spec\.ts/);
  assert.equal(liveText(snap(), 'refunds'), '');
});

test('a problem says what to do, in the server\'s own words', () => {
  const down = problemView({ state: 'error', code: 'APP_UNREACHABLE', message: 'Nothing answered at http://localhost:3000.', target: null });
  assert.equal(down.heading, 'Your app is not running');
  assert.match(down.message, /Nothing answered/);
  assert.equal(problemView({ state: 'cancelled', code: 'CANCELLED', message: 'x', target: null }).heading, 'The run was cancelled');
  assert.equal(problemView({ state: 'error', code: 'WHATEVER', message: 'm', target: null }).heading, 'The tests could not run');
});
