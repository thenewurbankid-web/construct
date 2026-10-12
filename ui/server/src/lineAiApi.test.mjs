// cu2 -- GET /api/line/ai-profiles (lineAiApi.mjs over packages/core/ai-profiles.mjs), and the Cockpit's decision calls
// through the one AI layer: a project naming `decision: provider: reason` gets @mx/reason's decide() from openDecision
// (the Requirement screen's route), with no plugin file, and falls back to rules when it times out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineAiRouter } from './lineAiApi.mjs';
import { assertAiProfiles } from '../../../packages/engine/line/contract.mjs';
import { openDecision, clearDecisionCache } from '../../../packages/core/decision-project.mjs';
import { unregisterDecisionProvider } from '../../../packages/core/decision-provider.mjs';
import { stepModel } from '../../../packages/core/ai-profiles.mjs';

async function serve(router) {
  const app = express();
  app.use('/api/line', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('GET /api/line/ai-profiles lists every AI step in the contract shape, with no project open', async () => {
  const s = await serve(createLineAiRouter());
  try {
    const r = await fetch(`${s.url}/api/line/ai-profiles`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assertAiProfiles(body);
    assert.equal(body.defaultModel, 'qwen2.5-coder:1.5b');
    const steps = body.profiles.map((p) => p.step);
    assert.ok(steps.includes('trace.choose') && steps.includes('cockpit.importFill') && steps.includes('construct.chooser'));
  } finally { await s.close(); }
});

test('GET /api/line/ai-profiles: an unreadable profile file is a 500 with one plain sentence', async () => {
  const s = await serve(createLineAiRouter({ read: () => { throw new Error('boom'); } }));
  try {
    const r = await fetch(`${s.url}/api/line/ai-profiles`);
    assert.equal(r.status, 500);
    assert.match((await r.json()).sentence, /^Cockpit could not read the AI step settings, so every step uses its static path\.$/);
  } finally { await s.close(); }
});

test('im1: GET /api/line/misses is the miss report: plan feedback of the open project plus the eval snapshot, slotted', async () => {
  const dir = makeTempDir('line-misses-api-');
  fs.mkdirSync(path.join(dir, 'line', 'plans'), { recursive: true });
  const fixes = [
    { id: 'fix', fixId: 'LINE-DIR/promote', recommended: true, step: { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } } },
    { id: 'fix', fixId: 'LINE-DIR/move', recommended: false, step: { tool: 'line.moveFile', args: { from: 'a.tsx', to: 'b.tsx' } } },
  ];
  fs.writeFileSync(path.join(dir, 'line', 'plans', 'ses.json'), JSON.stringify({ plans: [{ id: 'p1', steps: [
    { id: 's1', n: 1, kind: 'write', addedBy: 'jev', tool: 'line.setFragment', status: 'done', args: {}, result: { needsYou: true, findings: [{ rule: 'LINE-DIR' }], options: fixes } },
    { id: 's2', n: 2, kind: 'write', addedBy: 'ui', tool: 'line.moveFile', status: 'done', args: { from: 'a.tsx', to: 'b.tsx', fixOf: 's1' } },
  ] }] }));
  const snapshot = () => ({ at: '2026-10-12', numbers: { train: { n: 130, recall: 1, precision: 0.917, preferred: 1 }, drafter: null }, misses: [
    { id: 'drafter-eval:ls-v04:line.promote', source: 'drafter-eval', step: 'line.promote', kind: 'absent', options: ['line.promote (other)'], chosen: 'line.promote (other)', correct: 'line.promote + line.baseOn', correctFrom: 'drafter-eval', pattern: 'share <component> with <feature> -> line.promote + line.baseOn', sentence: 'Line never offered it.' },
  ] });
  const s = await serve(createLineAiRouter({ getRoot: () => ({ ok: true, root: dir }), snapshot }));
  try {
    const body = await (await fetch(`${s.url}/api/line/misses`)).json();
    assert.deepEqual(body.total, { misses: 2, absent: 1, picked: 1 });
    assert.equal(body.from, 'From your plan feedback and Train Line and the drafter eval (measured 2026-10-12).');
    assert.deepEqual(body.steps.map((x) => [x.step, x.absent, x.picked]), [['line.promote', 1, 0], ['line.setFragment', 0, 1]]);
    assert.equal(body.topAbsent[0].pattern, 'share <component> with <feature> -> line.promote + line.baseOn');
    assert.ok(!JSON.stringify(body).includes('OrderButton'), 'no project name');
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  const empty = await serve(createLineAiRouter({ snapshot: () => null }));
  try {
    const body = await (await fetch(`${empty.url}/api/line/misses`)).json();
    assert.equal(body.sentence, 'No misses: every right answer was offered and recommended.');
    assert.equal(body.from, 'No plan feedback or eval has been measured yet.');
  } finally { await empty.close(); }
});

test("Cockpit's fills use the step profile's model (the 1.5B) when Settings names none", () => {
  assert.equal(stepModel('cockpit.importFill'), 'qwen2.5-coder:1.5b');
  assert.equal(stepModel('cockpit.createFill'), 'qwen2.5-coder:1.5b');
});

test('decision: provider: reason is no longer built in (the reason adapter is gone): the rules provider answers and says why', async (t) => {
  const root = makeTempDir('cu2-reason-');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); unregisterDecisionProvider('reason'); clearDecisionCache(); });
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'decision:\n  provider: reason\n');
  const lines = [];
  const d = await openDecision(root, { capabilities: { available: false, reason: 'this machine is Lite' }, log: (l) => lines.push(l) });
  assert.equal(d.provider.name, 'rules');
  assert.equal(d.fellBackFrom, 'reason');
  const s = await d.suggest({ id: 'q1', question: 'Read or write?', options: [{ id: 'read', label: 'Read', enabled: true, why: '' }, { id: 'write', label: 'Write', enabled: true, why: '' }], chosen: null });
  assert.equal(s.option, 'read');
  assert.match(lines.join('\n'), /no provider named "reason" is available/);
});
