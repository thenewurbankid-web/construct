// #936 research sub-agents with one central, self-pruning ledger (packages/engine/line/research/). No Ollama: every
// model is a fake `chat`. The fixture is a copy of examples/line-sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLedger, LEDGER_FILE, estimateTokens, toMissRecords, VIEW_HEADER } from '../packages/engine/line/research/ledger.mjs';
import { distill, recordToolResult } from '../packages/engine/line/research/distill.mjs';
import { classifyQuestion, answerWithBlocks } from '../packages/engine/line/research/blocks.mjs';
import { runSubagent } from '../packages/engine/line/research/subagent.mjs';
import { researchTool, ledgerView, createQueue, researchHooks } from '../packages/engine/line/research/index.mjs';
import { checkSentence } from '../packages/summarize/index.mjs';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples/line-sample');
function copy() {
  const dir = makeTempDir('construct-line-research-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
const call = (name, args) => ({ function: { name, arguments: args } });
/** A fake model that plays back one message per turn and records what it was sent. */
function fakeChat(script) {
  const seen = [];
  const chat = async (req) => { seen.push({ ...req, messages: [...req.messages] }); const m = script[Math.min(seen.length - 1, script.length - 1)]; return { message: { role: 'assistant', content: '', ...m } }; };
  return { chat, seen };
}

test('ledger: add, supersede and answer; the view lists open questions, then decisions, then facts newest first', () => {
  const l = createLedger();
  const f1 = l.add({ kind: 'fact', english: 'OrdersPage is based on ListPage.', cites: ['features/orders/pages/OrdersPage.tsx'], source: 'block', turn: 1 });
  const d1 = l.add({ kind: 'decision', english: 'The cart total is computed in the domain layer.', cites: [], source: 'coder', turn: 2 });
  const q = l.add({ kind: 'question', english: 'Which atom paginates a list?', cites: [], source: 'coder', turn: 2 });
  const q2 = l.add({ kind: 'question', english: 'Where is the order total shown?', cites: [], source: 'coder', turn: 3 });
  const f2 = l.add({ kind: 'fact', english: 'OrderCard is based on Card.', cites: ['features/orders/components/OrderCard.tsx'], source: 'block', turn: 3 });
  l.answer(q.id, { english: 'The paginated query atom pages a list.', cites: ['@line/atoms/paginated-query'], turn: 4 });
  const d2 = l.supersede(d1.id, { english: 'The cart total is computed in a usecase.' });
  const lines = l.view(1000).text.split('\n').slice(1);
  assert.deepEqual(lines.map((s) => s.split(':')[0]), ['- Open question', '- Decided', '- Known', '- Known', '- Known']);
  assert.match(lines[0], /order total shown/);
  assert.match(lines[1], /in a usecase/);
  assert.match(lines[2], /paginated query atom/); // newest fact first
  assert.match(lines[4], /OrdersPage is based on ListPage/);
  assert.equal(l.entries.find((e) => e.id === d1.id).supersededBy, d2.id);
  assert.ok(l.entries.every((e) => checkSentence(e.english, { names: ['OrdersPage', 'OrderCard', 'ListPage', 'Card'] }).ok));
  assert.ok([f1, f2, q2].every((e) => e.id));
});

test('ledger: a duplicate fact (same cites, near-identical words) supersedes the older one; sentences are made plain', () => {
  const l = createLedger();
  const a = l.add({ kind: 'fact', english: 'OrderCard is based on the library Card.', cites: ['features/orders/components/OrderCard.tsx'], source: 'block', turn: 1 });
  const b = l.add({ kind: 'fact', english: 'OrderCard is based on the Card in the library.', cites: ['features/orders/components/OrderCard.tsx'], source: 'subagent', turn: 2 });
  const c = l.add({ kind: 'fact', english: 'OrderCard is based on the library Card.', cites: ['features/billing/components/InvoiceCard.tsx'], source: 'block', turn: 2 });
  assert.equal(b.supersedes, a.id);
  assert.equal(c.supersedes, undefined); // other cites: another fact
  assert.equal(l.view(1000).shown, 2);
  const plain = l.add({ kind: 'fact', english: 'the libraryId of OrderCard is card', cites: [], source: 'subagent', turn: 3 });
  assert.equal(plain.english, 'The library item of OrderCard is card.');
});

test('ledger: over budget, old facts per file collapse into one summary; still over, the oldest lines leave the view', () => {
  const l = createLedger();
  const file = 'features/orders/pages/OrdersPage.tsx';
  const said = ['OrdersPage renders a table of orders', 'OrdersPage reads the orders from the order service', 'OrdersPage shows a badge per order status', 'OrdersPage links each row to the order details', 'OrdersPage sorts orders by date'];
  said.forEach((s, i) => l.add({ kind: 'fact', english: `${s}.`, cites: [`${file}:${i + 1}`], source: 'block', turn: i + 1 }));
  for (let i = 0; i < 3; i += 1) l.add({ kind: 'fact', english: `Recent note number ${i + 1} is about the cart.`, cites: [`features/cart/c${i}.ts`], source: 'subagent', turn: 10 + i });
  l.add({ kind: 'question', english: 'Which service loads orders?', cites: [], source: 'coder', turn: 13 });
  const before = l.view(10_000);
  const after = l.view(110);
  assert.equal(before.shown, 9);
  assert.ok(after.tokens <= 110, `view is ${after.tokens} tokens`);
  const summary = l.entries.find((e) => /^Earlier notes on features\/orders\/pages\/OrdersPage\.tsx:/.test(e.english));
  assert.ok(summary, 'the five OrdersPage facts collapse into one');
  assert.equal(summary.merged.length, 5);
  assert.ok(checkSentence(summary.english).ok);
  assert.match(after.text, /Open question: Which service loads orders\?/);
  assert.match(after.text, /Recent note number 3/); // the newest facts are kept
  const tiny = l.view(40);
  assert.ok(tiny.tokens <= 40 || tiny.shown === 0);
  assert.ok(tiny.hidden > 0);
  assert.equal(estimateTokens('abcd'), 1);
});

test('ledger: persisted as JSON in the log folder and read back; misses read as rule-factory miss records', () => {
  const dir = makeTempDir('construct-line-research-log-');
  const file = path.join(dir, LEDGER_FILE);
  const l = createLedger({ file });
  l.add({ kind: 'miss', english: 'Research asked for a tool it was not given, write file.', cites: [], source: 'subagent', turn: 1 });
  const back = createLedger({ file });
  assert.equal(back.entries.length, 1);
  assert.equal(back.add({ kind: 'fact', english: 'A second note is here.', cites: [], source: 'coder' }).id, 'e2');
  assert.deepEqual(toMissRecords(back.entries).map((m) => [m.source, m.miss, m.ref.file]), [['miss-report', true, LEDGER_FILE]]);
});

test('classify: the closed keyword table picks one class per question, or none', () => {
  assert.equal(classifyQuestion('What can OrdersPage import?'), 'imports');
  assert.equal(classifyQuestion('Who uses OrderCard?'), 'callers');
  assert.equal(classifyQuestion('Where is orderCheckout defined?'), 'defines');
  assert.equal(classifyQuestion('Is there an atom for pagination?'), 'atom');
  assert.equal(classifyQuestion('What is in feature orders?'), 'feature');
  assert.equal(classifyQuestion('Why does the build fail on Tuesdays?'), null);
});

test('blocks: feature, imports and callers questions are answered with no model, with cites', () => {
  const root = copy();
  const f = answerWithBlocks(root, 'What is in feature orders?');
  assert.equal(f.block, 'readLineFeature');
  assert.equal(f.facts[0].english, 'orders has 1 page, 2 components and 1 workflow.');
  assert.ok(f.facts.some((x) => x.english === 'OrdersPage is based on ListPage.' && x.cites[0] === 'features/orders/pages/OrdersPage.tsx'));
  const i = answerWithBlocks(root, 'What can features/orders/pages/OrdersPage.tsx import?');
  assert.equal(i.block, 'importableFiles');
  assert.match(i.facts[0].english, /^OrdersPage\.tsx may import \d+ files/);
  assert.ok(i.facts.slice(1).every((x) => x.cites[0].startsWith('library/') || x.cites[0].startsWith('features/orders/')));
  const c = answerWithBlocks(root, 'Who uses OrderButton?');
  assert.equal(c.cls, 'callers');
  assert.ok(c.facts[0].cites.includes('features/orders/components/OrderButton.tsx'));
  assert.match(c.facts[0].english, /used by|No file/);
  const a = answerWithBlocks(root, 'Is there an atom for a paginated list?');
  assert.equal(a.block, 'matchAtoms');
  assert.match(a.facts[0].cites[0], /^@line\/atoms\//);
  assert.equal(answerWithBlocks(root, 'Why does the build fail on Tuesdays?'), null);
});

test('research: a block answer lands in the ledger as the answer to the question; asking again reads the note', async () => {
  const root = copy();
  const { chat, seen } = fakeChat([{ content: 'unused' }]);
  const ctx = { root, chat };
  const t = researchTool(ctx);
  assert.equal(t.schema.function.name, 'research');
  const r = await t.handle({ question: 'what is in feature orders?' }, { turn: 3 });
  assert.equal(r.via, 'block');
  assert.equal(seen.length, 0);
  const view = ledgerView(ctx, 600);
  assert.match(view, /Known: orders has 1 page, 2 components and 1 workflow\./);
  assert.doesNotMatch(view, /Open question/); // answered
  const again = await t.handle({ question: 'What is in feature orders?' }, { turn: 4 });
  assert.equal(again.via, 'ledger');
});

test('sub-agent: read-only (a write call is refused and logged as a miss), the answer lands with checked cites', async () => {
  const root = copy();
  const logDir = makeTempDir('construct-line-research-log-');
  const { chat, seen } = fakeChat([
    { tool_calls: [call('write_file', { path: 'x.ts', content: 'boom' })] },
    { tool_calls: [call('read_file', { path: 'features/orders/workflows/orderCheckout.ts' })] },
    { tool_calls: [call('answer', { answer: 'The checkout workflow moves an order from cart to paid. It has three states.', cites: ['features/orders/workflows/orderCheckout.ts', 'made/up.ts'] })] },
  ]);
  const ctx = { root, chat, logDir };
  const r = await researchTool(ctx).handle({ question: 'Why does checkout have three states?' }, { turn: 5 });
  assert.equal(r.via, 'subagent');
  assert.equal(r.turns, 3);
  assert.deepEqual(r.cites, ['features/orders/workflows/orderCheckout.ts']);
  assert.equal(fs.existsSync(path.join(root, 'x.ts')), false);
  assert.equal(JSON.parse(seen[1].messages.at(-1).content).code, 'READ_ONLY');
  assert.ok(seen.every((s) => s.model === 'qwen2.5-coder:7b' && !s.tools.some((x) => /write/.test(x.function.name))));
  const stored = JSON.parse(fs.readFileSync(path.join(logDir, LEDGER_FILE), 'utf8')).entries;
  assert.ok(stored.some((e) => e.kind === 'miss' && /write file/.test(e.english)));
  const fact = stored.find((e) => e.kind === 'fact' && e.source === 'subagent');
  assert.equal(fact.english, 'The checkout workflow moves an order from cart to paid. It has three states.'.split(' It')[0]);
  assert.deepEqual(fact.cites, ['features/orders/workflows/orderCheckout.ts']);
  assert.match(seen[0].messages[1].content, /Research notes/); // fresh context = ledger view + question
});

test('sub-agent: the turn cap is hard; no answer leaves the question open', async () => {
  const root = copy();
  const { chat, seen } = fakeChat([{ tool_calls: [call('list_dir', { path: '.' })] }]);
  const r = await runSubagent({ root, question: 'Why is it slow?', view: '', chat, maxTurns: 2, model: 'qwen2.5-coder:1.5b' });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'turn cap');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].model, 'qwen2.5-coder:1.5b');
  const ctx = { root, chat, maxTurns: 3 };
  const out = await researchTool(ctx).handle({ question: 'Why is it slow?' });
  assert.equal(out.code, 'NO_ANSWER');
  assert.match(ledgerView(ctx), /Open question: Why is it slow\?/);
});

test('queue: research calls run strictly one after another through one model', async () => {
  const root = copy();
  let active = 0; let peak = 0; const order = [];
  const chat = async (req) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active -= 1;
    const q = req.messages[1].content.split('Question: ')[1];
    // #948: an answer cites a file read for the question, so each question reads it first.
    if (!req.messages.some((m) => m.role === 'tool')) return { message: { role: 'assistant', content: '', tool_calls: [call('read_file', { path: 'features/orders/spec.md' })] } };
    order.push(q);
    return { message: { role: 'assistant', content: '', tool_calls: [call('answer', { answer: `Answer to ${q}`, cites: ['features/orders/spec.md'] })] } };
  };
  const queue = createQueue();
  const ctx = { root, chat, queue };
  const t = researchTool(ctx);
  const qs = ['Why one?', 'Why two?', 'Why three?'];
  const rs = await Promise.all(qs.map((question) => t.handle({ question })));
  assert.equal(peak, 1);
  assert.equal(queue.peak, 1);
  assert.deepEqual(order, qs);
  assert.ok(rs.every((r) => r.ok && r.via === 'subagent'));
});

test('hooks: research joins the tools before finish; the view message appears once the ledger has notes', async () => {
  const root = copy();
  const h = researchHooks({ root, chat: fakeChat([{ content: 'x' }]).chat });
  const tools = h.tools([{ function: { name: 'read_file' } }, { function: { name: 'finish' } }]);
  assert.deepEqual(tools.map((t) => t.function.name), ['read_file', 'research', 'finish']);
  assert.equal(h.message(), null);
  assert.ok(h.handles('research'));
  await h.handle({ question: 'Who uses OrderCard?' }, 2);
  assert.match(h.message().content, /^Research notes/);
  assert.deepEqual(h.record('research', {}, { ok: true }, 2), []);
  assert.equal(h.record('plan_status', {}, { ok: true, sentence: 'Two steps are open.' }, 3)[0].english, 'Two steps are open.');
});

test('distill: read_file, a refusal and a landed run-next become a fact, a fact plus a miss, and a decision', () => {
  const root = copy();
  const read = distill('read_file', { ok: true, text: 'x\n' }, { args: { path: 'features/orders/components/OrderCard.tsx' }, root });
  assert.deepEqual(read.map((d) => [d.kind, d.cites]), [['fact', ['features/orders/components/OrderCard.tsx']]]);
  assert.match(read[0].english, /^OrderCard\.tsx is a file, \d+ lines/);
  const refused = distill('plan_add', { ok: false, code: 'LINE_DIR', sentence: 'A feature may not import another feature. Pick a fix.', findings: [{ rule: 'LINE-DIR', severity: 'error', file: 'features/billing/pages/InvoicesPage.tsx', line: 4 }] }, { args: { tool: 'line.setCode', args: { file: 'features/billing/pages/InvoicesPage.tsx' } } });
  assert.deepEqual(refused.map((d) => d.kind), ['fact', 'miss']);
  assert.equal(refused[0].english, 'A feature may not import another feature.');
  assert.equal(refused[0].rule, 'LINE_DIR, LINE-DIR');
  assert.deepEqual(refused[0].cites, ['features/billing/pages/InvoicesPage.tsx', 'features/billing/pages/InvoicesPage.tsx:4']);
  assert.equal(refused[1].english, 'A set code step on features/billing/pages/InvoicesPage.tsx was refused');
  const landed = distill('plan_run_next', { ok: true, landed: true, tool: 'line.setCode', files: ['features/orders/pages/OrdersPage.tsx'] });
  assert.deepEqual(landed.map((d) => [d.kind, d.english]), [['decision', 'A set code step landed and changed OrdersPage.tsx.']]);
  assert.deepEqual(distill('plan_status', { ok: true, sentence: 'Two steps are open. More here.' }).map((d) => d.english), ['Two steps are open.']);
});

test('distill: the same failed attempt three times is one miss with a count, and one fact', () => {
  const l = createLedger();
  const out = { ok: false, code: 'TYPE_ERROR', sentence: 'The saved code does not compile.' };
  for (let t = 1; t <= 3; t += 1) recordToolResult(l, 'plan_add', { tool: 'line.setCode', args: { file: 'features/cart/domain/cart.ts' } }, out, { turn: t });
  recordToolResult(l, 'plan_add', { tool: 'line.setCode', args: { file: 'features/cart/domain/other.ts' } }, out, { turn: 4 });
  const live = l.viewEntries();
  const misses = live.filter((e) => e.kind === 'miss');
  assert.equal(misses.length, 2);
  assert.equal(misses.find((m) => m.count === 3)?.english, 'A set code step on features/cart/domain/cart.ts was refused, tried 3 times.');
  assert.equal(live.filter((e) => e.kind === 'fact' && e.cites[0] === 'features/cart/domain/cart.ts').length, 1);
  assert.match(l.view(1000).text, /\[features\/cart\/domain\/cart\.ts; rule TYPE_ERROR\]/);
});

test('view: a stable shape (header, one labelled line per entry, a hidden-count line) and always inside the budget', () => {
  const l = createLedger();
  assert.equal(l.view(100).text, `${VIEW_HEADER}\n- None yet.`);
  for (let i = 0; i < 40; i += 1) l.add({ kind: i % 5 === 0 ? 'decision' : 'fact', english: `Note number ${i} says something about file ${i}.`, cites: [`src/f${i % 7}.ts`], source: 'coder', turn: i });
  for (const budget of [60, 150, 400]) {
    const v = l.view(budget);
    assert.ok(v.tokens <= budget, `${v.tokens} > ${budget}`);
    const [head, ...rest] = v.text.split('\n');
    assert.equal(head, VIEW_HEADER);
    assert.ok(rest.every((line) => /^- (?:(?:Open question|Decided|Known|Missing): .+|\d+ older notes are left out\.)$/.test(line)), rest.join('\n'));
  }
});
