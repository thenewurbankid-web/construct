import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRulesView } from './RulesView.ts';
import { initialRules, rulesReducer } from '../workflows/Rules.ts';

const row = (id, overrides = {}) => ({ id, name: `${id} name`, severity: 'error', why: `${id} why`, count: 0, ...overrides });

test('reducer keeps the previous rows while running and after a failure', () => {
  const ready = rulesReducer(initialRules, { type: 'RESULT', rows: [row('PAGE-004')] });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.rows.length, 1);
  const running = rulesReducer(ready, { type: 'RUN' });
  assert.equal(running.status, 'running');
  assert.equal(running.rows.length, 1, 'the previous result stays visible while re-running');
  const failed = rulesReducer(running, { type: 'FAIL', error: 'boom' });
  assert.equal(failed.error, 'boom');
  assert.equal(failed.rows.length, 1);
  assert.equal(rulesReducer(failed, { type: 'RUN' }).error, null);
});

test('buildRulesView: idle, running (no previous rows) and error (no previous rows) states', () => {
  assert.equal(buildRulesView(initialRules).summary, 'Not read yet');
  const running = rulesReducer(initialRules, { type: 'RUN' });
  assert.equal(buildRulesView(running).running, true);
  assert.match(buildRulesView(running).summary, /Reading/);
  const failed = rulesReducer(initialRules, { type: 'FAIL', error: 'nope' });
  assert.equal(buildRulesView(failed).mode, 'error');
  assert.equal(buildRulesView(failed).error, 'nope');
});

test('buildRulesView: empty project (no rules configured)', () => {
  const empty = rulesReducer(initialRules, { type: 'RESULT', rows: [] });
  assert.equal(buildRulesView(empty).mode, 'empty');
});

test('buildRulesView: list mode counts firing error/warning rules in the summary', () => {
  const ready = rulesReducer(initialRules, {
    type: 'RESULT',
    rows: [row('PAGE-004', { count: 2 }), row('COMPONENT-002', { severity: 'warning', count: 1 }), row('ROUTE-001', { severity: 'off' })],
  });
  const view = buildRulesView(ready);
  assert.equal(view.mode, 'list');
  assert.equal(view.rows.length, 3);
  assert.match(view.summary, /3 rules/);
  assert.match(view.summary, /1 error rule firing/);
  assert.match(view.summary, /1 warning rule firing/);
});

test('buildRulesView: a failed re-run keeps the previous rows visible as a list with an error banner', () => {
  const ready = rulesReducer(initialRules, { type: 'RESULT', rows: [row('PAGE-004')] });
  const rerun = rulesReducer(ready, { type: 'FAIL', error: 'again' });
  const view = buildRulesView(rerun);
  assert.equal(view.mode, 'list');
  assert.equal(view.error, 'again');
  assert.equal(view.rows.length, 1);
});
