// Pure logic of a test run on the Tests screen (#305): words, symbols, durations, picking an outcome, the views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMs, outcomeFor, outcomeView } from './RunOutcomes.ts';
import { liveText, problemView, runSummary } from './RunText.ts';
import { resultCell, runPanelView, testRunView } from './RunView.ts';

const snap = (over = {}) => ({
  ok: true, live: null, problem: null, defaultBaseUrl: 'http://localhost:3000',
  tests: [
    { file: 'a--b.spec.ts', area: 'generated', title: 'Happy path', status: 'passed', durationMs: 900 },
    { file: 'a--b.spec.ts', area: 'yours', title: 'Same name, yours', status: 'failed', durationMs: 5000, failure: { kind: 'other', title: 't', message: 'm', step: null } },
    { file: 'c.spec.ts', area: 'yours', title: 'Needs a fixture', status: 'not-run', durationMs: 0, reason: 'a fixture' },
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

test('the panel view: rows with symbol and word, the failures to explain, and nothing while a run is live', () => {
  const v = runPanelView(snap(), 'refunds');
  assert.equal(v.busy, false);
  assert.deepEqual(v.rows.map((r) => `${r.mark.symbol} ${r.mark.word}`), ['✓ Passed', '✗ Failed', '○ Not run']);
  assert.deepEqual(v.rows.map((r) => r.detail), ['900 ms', '5.0 s', 'needs a fixture']);
  assert.equal(v.failures.length, 1);
  assert.equal(v.done, 'Last run: 1 passed · 1 failed · 1 not run · 12.3 s against http://localhost:3000.');
  const live = runPanelView(snap({ live: { state: 'running', processId: 'p', target: null } }), 'refunds');
  assert.equal(live.busy, true);
  assert.deepEqual([live.rows, live.failures, live.done], [[], [], null]);
  assert.match(live.live.text, /Running every test of refunds/);
  const problem = runPanelView(snap({ problem: { state: 'error', code: 'APP_UNREACHABLE', message: 'm', target: null } }), 'refunds');
  assert.equal(problem.problem.heading, 'Your app is not running');
  assert.equal(problem.done, null);
});

test('one test\'s view, and the table cell for a test nothing has run', () => {
  assert.equal(testRunView(snap(), 'generated', 'a--b.spec.ts').mark.word, 'Passed');
  assert.equal(testRunView(snap(), 'yours', 'nope.spec.ts'), null);
  assert.deepEqual(resultCell(snap(), 'generated', 'zzz.spec.ts'), { status: 'none', symbol: '', word: 'Not run', tone: 'muted' });
  assert.equal(resultCell(snap(), 'generated', 'a--b.spec.ts').status, 'passed');
});
