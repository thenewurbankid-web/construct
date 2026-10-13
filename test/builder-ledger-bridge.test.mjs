// #932 x #936 (og merge 2026-10-13): with --research the turn builder reads the research ledger itself: one owner,
// the coder's result recorded once, the research view (its header) in the turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger as createResearchLedger, VIEW_HEADER } from '../packages/engine/line/research/ledger.mjs';
import { recordToolResult } from '../packages/engine/line/research/distill.mjs';
import { bridgeLedger, bridgedView, createLedger, ledgerView } from '../bench/ecommerce/driver/ledger.mjs';
import { buildTurn } from '../bench/ecommerce/driver/turn.mjs';

test('the bridged ledger is the research ledger: distil does not add a second copy, the view is the research view', () => {
  const research = createResearchLedger();
  const ledger = bridgeLedger(research);
  const out = { ok: false, code: 'TYPE_ERROR', sentence: 'Refused (TYPE_ERROR): PicksPage passes a string where a number is expected.' };
  const args = { tool: 'line.setCode', args: { file: 'features/picks/pages/PicksPage.tsx' } };
  recordToolResult(research, 'plan_add', args, out, { turn: 1 });
  const before = research.entries.length;
  const e = ledger.distil('plan_add', args, out);
  assert.match(e.text, /refused \(TYPE_ERROR\)/);
  assert.equal(research.entries.length, before, 'record() owns the write');
  assert.equal(ledger.entries.length, before);
  ledger.add({ kind: 'decision', text: 'Fill PicksPage first.', cites: ['PCK-1'] });
  assert.equal(research.entries.length, before + 1);
  const built = buildTurn({ system: { role: 'system', content: 'Rules.' }, ledger, ledgerView: bridgedView, card: 'x', last: [] });
  assert.ok(built.messages[1].content.includes(VIEW_HEADER));
  // Not bridged: the adapter's own view, unchanged.
  const local = createLedger();
  local.distil('plan_add', args, out);
  assert.equal(bridgedView({ ledger: local }, 600), ledgerView({ ledger: local }, 600));
});
