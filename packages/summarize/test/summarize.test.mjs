// cs1 -- the summarizer: every kind answers plain sentences that pass the rules, with the technical part as details;
// Smith and atomic-codemod are linked through packages/line-links, and their absence is one sentence, not a crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { summarize, plainSentence, checkSentence, SMITH_CONNECTORS } from '../index.mjs';
import { smithConnectors, smithLinks, summarizeCode } from '../links.mjs';

const missingEnv = { ...process.env, SMITH_SOURCE_DIR: path.join(os.tmpdir(), 'no-smith-here'), ATOMIC_CODEMOD_SOURCE_DIR: path.join(os.tmpdir(), 'no-codemod-here') };
const label = (s, l) => s.details.filter((d) => d.label === l).map((d) => d.text);

test('plainSentence: raw ids become words (and are returned for Details), slot names become words, a capital and a full stop', () => {
  assert.deepEqual(plainSentence('step step-3 needs you'), { sentence: 'Step a step needs you.', ids: ['step-3'] });
  assert.equal(plainSentence('Ran line.baseOn on the library').sentence, 'Ran "Base on" on the library.');
  assert.equal(plainSentence('This breaks LINE-DIR.').sentence, 'This breaks a rule.');
  assert.equal(plainSentence('Pick a libraryId first.').sentence, 'Pick a library item first.');
  assert.equal(plainSentence('done').sentence, 'Line says: Done.');
  assert.equal(plainSentence('orderCheckout is based on checkout.', ['orderCheckout']).sentence, 'orderCheckout is based on checkout.');
});

test('plan step: the step sentence first; the tool call, step id, checks, files and options under details', () => {
  const s = summarize({ kind: 'plan-step', step: { id: 'step-2', n: 2, tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge', expect: [] }, state: 'needs-fix', sentence: 'Nothing was saved: StatusBadge breaks a Line rule.', result: { checks: [{ checkId: 'validate', ok: false, sentence: 'Validate shows a new problem.' }], apply: { files: ['features/orders/components/StatusBadge.tsx'] }, options: [{ id: 'fix', fixId: 'fix:LINE-BASE:1', sentence: 'Add a library base.', recommended: true }, { id: 'leave', sentence: 'Leave it as it is.' }] } } });
  assert.deepEqual(s.sentences, ['Nothing was saved: StatusBadge breaks a Line rule.']);
  assert.deepEqual(label(s, 'Tool call'), ['line.baseOn({"libraryId":"components/Badge","feature":"orders","name":"StatusBadge"})']);
  assert.deepEqual(label(s, 'Step'), ['step-2 (step 2, needs-fix)']);
  assert.deepEqual(label(s, 'Check'), ['Failed: Validate shows a new problem.']);
  assert.deepEqual(label(s, 'File written'), ['features/orders/components/StatusBadge.tsx']);
  assert.deepEqual(label(s, 'Option'), ['fix:LINE-BASE:1: Add a library base. (recommended)', 'leave: Leave it as it is.']);
  assert.equal(s.via, 'static');
});

test('finding: the sentence first; the rule, file:line, key and fixes under details', () => {
  const s = summarize({ kind: 'finding', finding: { sentence: 'Feature "billing" imports OrderButton from feature "orders"; promote it to the library.', rule: 'LINE-DIR', file: 'features/billing/pages/InvoicesPage.tsx', line: 4, key: 'LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', fixes: [{ id: 'promote', sentence: 'Promote OrderButton to the library.', rank: 1 }] } });
  assert.equal(s.sentences.length, 1);
  assert.deepEqual(label(s, 'Rule'), ['LINE-DIR']);
  assert.deepEqual(label(s, 'Where'), ['features/billing/pages/InvoicesPage.tsx:4']);
  assert.deepEqual(label(s, 'Fix'), ['promote: Promote OrderButton to the library. (recommended)']);
});

test('feature: the static summary keeps feature and item names as written and passes the rules', () => {
  const sentences = ['orders has 1 page and 1 workflow.', 'orderCheckout is based on checkout.', 'Everything in orders passes the checks.'];
  const s = summarize({ kind: 'feature', name: 'orders', names: ['orderCheckout'], sentences });
  assert.deepEqual(s.sentences, sentences);
  assert.deepEqual(label(s, 'Feature'), ['orders']);
});

test('message: Oracle, Trace, GateLM and the reasoning log say a sentence first; options with confidence and the reasoning go under details', () => {
  const s = summarize({ kind: 'message', from: 'oracle', text: 'pick the library Badge. it fits the step best', options: [{ id: 'components/Badge', sentence: 'Badge', confidence: 0.82, recommended: true }], reasoning: 'Badge matched 4 of 5 props.' });
  assert.deepEqual(s.sentences, ['Pick the library Badge.', 'It fits the step best.']);
  assert.deepEqual(label(s, 'From'), ['Oracle']);
  assert.deepEqual(label(s, 'Option'), ['components/Badge: Badge (confidence 0.82) (recommended)']);
  assert.deepEqual(label(s, 'Reasoning'), ['Badge matched 4 of 5 props.']);
  for (const from of ['trace', 'gatelm', 'reasoning', 'line']) for (const t of summarize({ kind: 'message', from, text: 'session ses-cockpit is open' }).sentences) assert.ok(checkSentence(t).ok, t);
  assert.deepEqual(summarize({ kind: 'status', text: 'Saving' }).sentences, ['Line says: Saving.']);
});

test('code: to-english output becomes sentences, the code goes under details; no output is one sentence', () => {
  const english = { title: 'ship order using order', steps: [{ english: 'if order is paid: order will ship', code: 'if (order.is().paid()) { order.will().ship(); }' }, { english: 'return order', code: 'return order;' }] };
  const s = summarize({ kind: 'code', english, code: 'function shipOrder(order) {}' });
  assert.deepEqual(s.sentences, ['Ship order using order works in 2 steps.', 'If order is paid, order will ship.', 'It returns order.']);
  assert.deepEqual(label(s, 'Step 1 code'), ['if (order.is().paid()) { order.will().ship(); }']);
  assert.deepEqual(summarize({ kind: 'code', english: { title: null, steps: [] } }).sentences, ['This code could not be put into words; it is under Details.']);
  assert.deepEqual(summarize(/** @type {any} */ ({ kind: 'poem' })).sentences, ['Line cannot put this into words yet; it is under Details.']);
});

test('linked: Smith and atomic-codemod are linked at their pinned commits; Smith\'s connector words are the contract\'s', async () => {
  const st = smithLinks();
  assert.equal(st.smith.ok, true, st.smith.message);
  assert.equal(st.codemod.ok, true, st.codemod.message);
  assert.deepEqual(await smithConnectors(), { linked: true, words: [...SMITH_CONNECTORS] });
});

test('linked: a Smith chain reads as English through to-english, with no model', async () => {
  const s = await summarizeCode('function shipOrder(order) {\n  if (order.is().paid()) {\n    order.will().ship();\n  }\n  return order;\n}');
  assert.deepEqual(s.sentences, ['Ship order using order works in 2 steps.', 'If order is paid, order will ship.', 'It returns order.']);
  const bad = await summarizeCode('function (');
  assert.deepEqual(bad.sentences, ['This code could not be read, so it is not put into words; the code and the reason are under Details.']);
});

test('fallback: with Smith and atomic-codemod missing, one plain sentence each and the static path keeps working', async () => {
  const st = smithLinks({ env: missingEnv });
  assert.equal(st.smith.ok, false);
  assert.match(st.smith.message, /^Line links are off because the source folder .*no-smith-here is missing \(set SMITH_SOURCE_DIR to a smith checkout\); Construct runs on its static path\.$/);
  const c = await smithConnectors({ env: missingEnv });
  assert.equal(c.linked, false);
  assert.deepEqual(c.words, [...SMITH_CONNECTORS]);
  const s = await summarizeCode('function a() { return 1; }', { env: missingEnv });
  assert.deepEqual(s.sentences, ['This code is not put into words because atomic-codemod is not linked; the code and the reason are under Details.']);
  assert.match(label(s, 'Why')[0], /@smith\/to-english is not linked because the source folder/);
});
