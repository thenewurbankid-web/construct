// Experiment fix 3 -- @mx/reason's Qwen proposer caps replies at 200 tokens (no option), which cuts a JSON plan off.
// Construct sets the cap from its side (reason-provider.mjs createCappedQwenProposer: a fetch that sets max_tokens),
// default 800, per step by pair id, without editing the linked source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCappedQwenProposer, capReplyTokens, replyTokensFor, REASON_REPLY_TOKENS } from '../packages/core/reason-provider.mjs';
import { importLinked, linkStatus } from '../packages/line-links/index.mjs';

const chatBody = (n) => JSON.stringify({ model: 'qwen2.5-coder:1.5b', messages: [], max_tokens: n });

test('the cap: 800 by default, per pair id, from the profile, the adapter option or the environment', () => {
  assert.equal(REASON_REPLY_TOKENS, 800);
  assert.equal(replyTokensFor({ pairId: 'a.b' }, {}, {}), 800);
  assert.equal(replyTokensFor({ pairId: 'a.b' }, { maxTokens: 600 }, {}), 600);
  assert.equal(replyTokensFor({ pairId: 'a.b' }, { maxTokens: 600, maxTokensByPair: { 'a.b': 1200 } }, {}), 1200);
  assert.equal(replyTokensFor({ pairId: 'a.b', replyTokens: 900 }, { maxTokens: 600 }, {}), 900);
  assert.equal(replyTokensFor({ pairId: 'a.b' }, {}, { CONSTRUCT_REASON_MAX_TOKENS: '1500' }), 1500);
  assert.equal(replyTokensFor({ pairId: 'a.b' }, { maxTokens: -1 }, { CONSTRUCT_REASON_MAX_TOKENS: 'lots' }), 800, 'nonsense falls back to the default');
});

test('capReplyTokens rewrites max_tokens on a chat request and passes everything else through', async () => {
  const seen = [];
  const base = async (url, init) => { seen.push([url, init?.body]); return new Response('{}'); };
  const f = capReplyTokens(800, /** @type {any} */ (base));
  await f('http://x/v1/chat/completions', { method: 'POST', body: chatBody(200) });
  await f('http://x/api/tags');
  await f('http://x/other', { method: 'POST', body: 'not json' });
  assert.equal(JSON.parse(seen[0][1]).max_tokens, 800);
  assert.equal(seen[1][1], undefined);
  assert.equal(seen[2][1], 'not json');
});

test('createCappedQwenProposer: one inner proposer per cap, each given the capping fetch; no createQwenProposer is one sentence', async () => {
  const made = [];
  const fake = {
    createQwenProposer(o) {
      made.push(o);
      return { name: 'qwen', available: async () => true, propose: async () => { const r = await o.fetch('http://x/v1/chat/completions', { method: 'POST', body: chatBody(200) }); return JSON.parse(await r.text()); }, review: async () => ({ accept: true, note: 'ok' }) };
    },
  };
  const sent = [];
  const base = async (_u, init) => { sent.push(JSON.parse(init.body).max_tokens); return new Response(JSON.stringify({ options: ['a'], favourite: 0, note: 'n' })); };
  const qwen = createCappedQwenProposer(fake, { render: (q) => String(q), fetch: /** @type {any} */ (base), maxTokensByPair: { 'line.plan.step': 1200 }, env: {} });
  await qwen.propose('q', [], { pairId: 'line.parse.intent' }, []);
  await qwen.propose('q', [], { pairId: 'line.plan.step' }, []);
  await qwen.propose('q', [], { pairId: 'line.plan.step' }, []);
  assert.deepEqual(sent, [800, 1200, 1200]);
  assert.equal(made.length, 2, 'one inner proposer per cap');
  assert.equal(typeof made[0].render, 'function', 'render reaches @mx/reason');
  assert.throws(() => createCappedQwenProposer({}, { render: String }), /has no createQwenProposer, so Qwen cannot propose\./);
});

const reasonUp = linkStatus().packages.find((p) => p.name === '@mx/reason')?.ok ? false : 'the @mx/reason link is not ready on this machine';

test('real @mx/reason: its Qwen proposer sends max_tokens 800, not 200, and a long JSON plan reply parses', { skip: reasonUp }, async () => {
  const linked = await importLinked('@mx/reason');
  assert.ok(linked.ok, linked.reason);
  const R = linked.module;
  const [profile] = Object.values(R.defineProfiles([{
    pairId: 'line.plan.step', stepId: 'line.plan', qwenGuidance: 'Propose plans.', maxOptions: 5, proposeRetries: 0, jevFrame: 'line-plan',
    review: { enabled: false, maxRounds: 1 }, success: 'The plan passes.', plan: { version: '1', questions: [{ id: 'pick', kind: 'pick', note: 'Which plan.' }] },
  }]));
  // Five JSON plans, far longer than 200 tokens of reply.
  const plan = (i) => JSON.stringify([{ tool: 'line.moveFile', args: { from: `features/orders/components/OrderButton${i}.tsx`, to: `library/components/OrderButton${i}.tsx` } }, { tool: 'line.setBase', args: { file: `features/billing/components/InvoiceCard${i}.tsx`, libraryId: 'components/Card' } }]);
  const reply = JSON.stringify({ options: [0, 1, 2, 3, 4].map(plan), favourite: 0, note: 'Five plans that each move the button and base the card.' });
  const sent = [];
  const fakeServer = async (url, init) => {
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:1.5b' }] }));
    const body = JSON.parse(init.body);
    sent.push(body.max_tokens);
    return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: reply } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
  };
  const qwen = createCappedQwenProposer(R, { render: (q) => String(q), host: 'http://127.0.0.1:1', fetch: /** @type {any} */ (fakeServer), env: {} });
  const out = await qwen.propose('Move the button.', [], profile, []);
  assert.deepEqual(sent, [800], 'the request reached the server with Construct\'s cap');
  assert.equal(out.options.length, 5);
  assert.deepEqual(JSON.parse(out.options[4])[0].tool, 'line.moveFile');
});

// Live walk (opt-in: CONSTRUCT_LIVE_QWEN=1, the local Ollama with qwen2.5-coder:1.5b): the same request for five JSON
// plans, through @mx/reason's own proposer (200 tokens) and through Construct's (800).
const live = process.env.CONSTRUCT_LIVE_QWEN === '1' && !reasonUp ? false : 'set CONSTRUCT_LIVE_QWEN=1 with a local qwen2.5-coder:1.5b to run';
test('live Qwen: five JSON plans are cut off at 200 tokens and come back whole at 800', { skip: live, timeout: 180_000 }, async (t) => {
  const R = (await importLinked('@mx/reason')).module;
  const MODEL = 'qwen2.5-coder:1.5b';
  const [defined] = Object.values(R.defineProfiles([{
    pairId: 'line.plan.step', stepId: 'line.plan', maxOptions: 5, proposeRetries: 0, jevFrame: 'line-plan',
    qwenGuidance: 'Propose plans for a Line project. A plan is a JSON array of steps {"tool": ..., "args": {...}} using only line.moveFile {from, to} and line.setBase {file, libraryId}. Each option value is one complete JSON array, no prose.',
    review: { enabled: false, maxRounds: 1 }, success: 'The plan passes.', plan: { version: '1', questions: [{ id: 'pick', kind: 'pick', note: 'Which plan.' }] },
  }]));
  const profile = { ...defined, models: { suggest: MODEL, pick: MODEL, review: MODEL } };
  const render = () => [
    'Request: move features/orders/components/OrderButton.tsx into library/components/OrderButton.tsx, base features/billing/components/InvoiceCard.tsx on components/Card,',
    'move features/billing/pages/InvoicesPage.tsx into library/pages/InvoicesPage.tsx, base features/orders/components/OrderCard.tsx on components/Card,',
    'move features/orders/workflows/orderCheckout.ts into library/workflows/orderCheckout.ts and base features/orders/pages/OrdersPage.tsx on pages/ListPage.',
    'Offer five different plans (different step orders). Each plan is a JSON array with all six steps, every step written out with its tool and full paths.',
  ].join(' ');
  /** A fetch that records how each reply ended (finish_reason, completion tokens). */
  const spy = (log) => async (url, init) => {
    const r = await fetch(url, init);
    if (!String(url).includes('/chat/completions')) return r;
    const body = await r.clone().json().catch(() => ({}));
    log.push({ finish: body.choices?.[0]?.finish_reason, tokens: body.usage?.completion_tokens });
    return r;
  };
  const rawLog = []; const cappedLog = [];
  const raw = await R.createQwenProposer({ render, fetch: spy(rawLog) }).propose('q', [], profile, []).then(() => 'whole', (e) => String(e?.message ?? e));
  const capped = await createCappedQwenProposer(R, { render, fetch: spy(cappedLog), env: {} }).propose('q', [], profile, []);
  // What the cap decides is whether the reply JSON is whole; what is inside each option is the model's quality.
  assert.equal(cappedLog[0].finish, 'stop', 'at 800 the model finished its reply');
  assert.ok(capped.options.length >= 1, `at 800 the reply parses: ${JSON.stringify(capped.options)}`);
  t.diagnostic(`reply at 800: ${cappedLog[0].tokens} tokens (${cappedLog[0].finish}); at 200: ${rawLog[0]?.finish}`);
  if (cappedLog[0].tokens <= 200) { t.skip(`the model needed only ${cappedLog[0].tokens} tokens this time, so 200 would have been enough`); return; }
  assert.equal(rawLog[0].finish, 'length', `the same reply needs ${cappedLog[0].tokens} tokens, so at 200 it is cut off`);
  assert.notEqual(raw, 'whole', 'a cut-off reply does not parse');
});
