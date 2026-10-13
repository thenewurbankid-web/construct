// #932 reconcile (og merge 2026-10-13): the ledger turn ends on the last refusal, and carries the standing fact that no
// feature has usecases, services or domains yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { buildTurn, projectFacts } from '../bench/ecommerce/driver/turn.mjs';
import { createLedger, ledgerView } from '../bench/ecommerce/driver/ledger.mjs';

const system = { role: 'system', content: 'Rules.' };

test('the last refusal is the final message, after a later success in the same turn', () => {
  const refused = { role: 'tool', content: JSON.stringify({ ok: false, code: 'TYPE_ERROR', sentence: 'Refused (TYPE_ERROR): x.' }) };
  const ok = { role: 'tool', content: JSON.stringify({ ok: true, sentence: 'Read it.' }) };
  const assistant = { role: 'assistant', content: '', tool_calls: [] };
  const built = buildTurn({ system, ledger: createLedger(), ledgerView, card: 'Now: PCK-1.', last: [assistant, refused, ok] });
  assert.equal(built.messages.length, 5);
  assert.equal(built.messages.at(-1).content, refused.content);
  const clean = buildTurn({ system, ledger: createLedger(), ledgerView, card: 'x', last: [assistant, ok] });
  assert.equal(clean.messages.at(-1).content, ok.content);
});

test('a fresh project: "No feature has usecases, services or domains yet." goes with the ledger', () => {
  const parent = fs.realpathSync(makeTempDir('turn-facts-'));
  try {
    const project = /** @type {string} */ (createLineProject(parent, { name: 'lending', firstFeature: 'picks' }).dir);
    const facts = projectFacts(project);
    assert.deepEqual(facts, ['No feature has usecases, services or domains yet.']);
    const built = buildTurn({ system, ledger: createLedger(), ledgerView, card: 'x', last: [], facts });
    assert.match(built.messages[1].content, /The project now:\n- No feature has usecases, services or domains yet\./);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
