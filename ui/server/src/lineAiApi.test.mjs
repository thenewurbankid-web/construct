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

test("Cockpit's fills use the step profile's model (the 1.5B) when Settings names none", () => {
  assert.equal(stepModel('cockpit.importFill'), 'qwen2.5-coder:1.5b');
  assert.equal(stepModel('cockpit.createFill'), 'qwen2.5-coder:1.5b');
  assert.equal(stepModel('cockpit.planAnalysis'), null);
});

test('decision: provider: reason -> openDecision answers through decide() with no plugin file; jev off on a machine without models', async (t) => {
  const root = makeTempDir('cu2-reason-');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); unregisterDecisionProvider('reason'); clearDecisionCache(); });
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'decision:\n  provider: reason\n');
  const lines = [];
  const d = await openDecision(root, { capabilities: { available: false, reason: 'this machine is Lite' }, log: (l) => lines.push(l) });
  assert.equal(d.provider.name, 'reason');
  assert.equal(d.fellBackFrom, null);
  const s = await d.suggest({ id: 'q1', question: 'Read or write?', options: [{ id: 'read', label: 'Read', enabled: true, why: '' }, { id: 'write', label: 'Write', enabled: true, why: '' }], chosen: null });
  assert.equal(s.option, 'read');
  assert.equal(s.runnerUp, 'write');
  assert.match(s.reason, /static order|no model was asked/);
  assert.match(lines.join('\n'), /reason without jev: this machine is Lite/);
});
