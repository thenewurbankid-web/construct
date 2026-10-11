import test from 'node:test';
import assert from 'node:assert/strict';
import { hrefFor, idleSentence, isOnScreen, lightsFor, screenOfControl, stepsForTrace } from './TraceLights.ts';
import { DEFAULT_SETTINGS, advance, approvedByPerson, delayFor, isActive, parseSettings, pauseRun, resumeRun, shouldMove, startRun, stepRun, stopRun, waitForApproval, withHistory } from './AutoRun.ts';
import { toTraceAnswer } from './TraceAnswer.ts';
import { createMockTraceApi } from '../services/LineTraceApi.mock.ts';

const api = createMockTraceApi();
const matchOf = async (request, steps) => {
  const a = await api.trace({ request, steps });
  assert.equal(a.ok, true);
  return a.match;
};

test('lights: on Components a Base on request lights its controls in place, Approve included (the Plan panel is here)', async () => {
  const m = await matchOf('Base a new PayButton on Button in orders');
  const l = lightsFor(m, 'components');
  assert.deepEqual(l.here.map((c) => c.label), ['Base on this (Button)', 'Feature (Button)', 'Name (Button)', 'Create (Button)', 'Approve']);
  assert.deepEqual(l.elsewhere, []);
});

test('lights: on Features the same request shows a link to Components instead', async () => {
  const m = await matchOf('Base a new PayButton on Button in orders');
  const l = lightsFor(m, 'features');
  assert.deepEqual(l.here, []);
  assert.deepEqual(l.elsewhere.map((e) => [e.title, e.href, e.labels]), [
    ['Components', '/components', ['Base on this', 'Feature', 'Name', 'Create']],
    ['the Plan panel on Components', '/components', ['Approve']],
  ]);
});

test('lights: a page change on Components links to Pages; an open step lights Approve as a step light', async () => {
  const m = await matchOf('Change the title of OrdersPage to My orders', [{ id: 's1', n: 1, tool: 'line.baseOn', state: 'waiting' }]);
  const l = lightsFor(m, 'components');
  assert.deepEqual(l.elsewhere.map((e) => e.title), ['Pages']);
  assert.deepEqual(l.here.map((c) => [c.controlId, c.kind, c.target]), [['plan.approve', 'request', null], ['plan.approve', 'step', '1']]);
  assert.deepEqual(lightsFor(null, 'pages'), { here: [], elsewhere: [] });
});

test('screens: the Plan panel is on Components and Pages, not Features; control ids name their screen', () => {
  assert.equal(isOnScreen('plan', 'pages'), true);
  assert.equal(isOnScreen('plan', 'features'), false);
  assert.equal(screenOfControl('pages.propSave'), 'pages');
  assert.equal(hrefFor('features'), '/');
  assert.equal(idleSentence(false, false), 'Trace and Auto are off.');
});

test('steps: only waiting and needs-you steps go to Trace', () => {
  const s = (id, state) => ({ id, n: 1, tool: 'line.baseOn', state, args: {}, why: '', kind: 'write', sentence: 'X.', gap: [], result: null, error: null });
  assert.deepEqual(stepsForTrace([s('a', 'done'), s('b', 'waiting'), s('c', 'needs-fix'), s('d', 'failed')]).map((x) => x.id), ['b', 'c']);
});

test('Auto: play, pause, one step, go on, wait at Approve, the person approves', async () => {
  const m = await matchOf('Base a new PayButton on Button in orders');
  let r = startRun('r1', 'x', m.tools[0].script, true);
  assert.equal(r.status, 'playing');
  assert.equal(r.caption, 'Open "Base on this" on the Button card.');
  assert.equal(shouldMove(r), true);
  r = pauseRun(r);
  assert.equal(r.status, 'paused');
  assert.equal(shouldMove(r), false);
  assert.match(r.caption, /^Paused\. Next: open "Base on this"/);
  r = stepRun(r);
  assert.equal(shouldMove(r), true);
  r = advance(r);
  assert.deepEqual([r.index, r.status, r.stepping], [1, 'paused', false]);
  r = resumeRun(r);
  r = advance(advance(advance(r)));
  assert.equal(r.script[r.index].kind, 'approve');
  r = waitForApproval(r);
  assert.equal(r.status, 'waiting');
  assert.equal(isActive(r), true);
  assert.match(r.caption, /^Waiting for you: click Approve/);
  r = approvedByPerson(r);
  assert.equal(r.status, 'done');
  assert.equal(isActive(r), false);
});

test('Auto: a replay says it changes nothing; stop ends it; speed sets the pace; Auto alone has no show', async () => {
  const m = await matchOf('Promote OrderButton to the library');
  let r = startRun('r2', 'x', m.tools[0].script, true, true);
  assert.match(r.caption, /^Replay: /);
  r = advance(advance(advance(r)));
  assert.equal(r.caption, 'Replay finished; nothing was changed.');
  assert.equal(stopRun(startRun('r3', 'x', m.tools[0].script, false)).status, 'stopped');
  assert.equal(delayFor(2, true), 450);
  assert.equal(delayFor(0.5, true), 1800);
  assert.equal(delayFor(1, false), 40);
  assert.equal(startRun('r4', 'x', [], true).status, 'done');
});

test('settings: history keeps ten newest; unreadable storage falls back; Auto approval is off by default', () => {
  let h = [];
  for (let i = 0; i < 12; i += 1) h = withHistory(h, { id: `r${i}`, request: `q${i}`, script: [], at: '' });
  assert.equal(h.length, 10);
  assert.equal(h[0].id, 'r11');
  assert.equal(parseSettings('{oops'), DEFAULT_SETTINGS);
  assert.equal(parseSettings(null).autoApprove, false);
  assert.equal(parseSettings(JSON.stringify({ trace: true, speed: 7 })).speed, 1);
});

test('answer: a refusal or a silent body is one sentence', () => {
  assert.deepEqual(toTraceAnswer({ ok: false, sentence: 'The request must be text.' }), { ok: false, sentence: 'The request must be text.' });
  assert.deepEqual(toTraceAnswer(null), { ok: false, sentence: 'Trace could not read that request.' });
});
