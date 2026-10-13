// #932: the coder's scratchpad: its own notes as entries (not project state, not the ledger), size-capped, garbage-
// collected deterministically before each turn (covered point / landed file, superseded, older than 6 turns unless
// pinned, oldest unpinned over the cap), shown in the ledger turn under "Your notes" inside the fixed budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createScratch, SCRATCH_CAP } from '../bench/ecommerce/driver/scratch.mjs';
import { buildTurn, TURN_BUDGET } from '../bench/ecommerce/driver/turn.mjs';
import { createLedger, ledgerView } from '../bench/ecommerce/driver/ledger.mjs';
import { flags, runAgent } from '../bench/ecommerce/driver/qwen-agent.mjs';

const at = (turn, step = 'PCK-1') => ({ turn, step });

test('write appends entries; replace clears the unpinned ones; the file mirrors them', () => {
  const dir = fs.realpathSync(makeTempDir('scratch-'));
  try {
    const file = path.join(dir, 'logs', 'scratch.md');
    const s = createScratch({ file });
    const a = s.write({ text: 'Plan: PicksPage first.', pin: true }, at(1));
    assert.equal(a.ok, true); assert.equal(a.id, 'n1');
    s.write({ text: 'Hypothesis: getItem can be null.', about: 'features/picks/pages/PicksPage.tsx' }, at(2));
    assert.deepEqual(s.entries.map((e) => e.id), ['n1', 'n2']);
    assert.match(fs.readFileSync(file, 'utf8'), /^- \[n1, turn 1, at PCK-1, pinned\] Plan: PicksPage first\.\n- \[n2, turn 2, at PCK-1, about features\/picks\/pages\/PicksPage\.tsx\] Hypothesis/);
    const r = s.write({ text: 'Start over: PCK-2.', mode: 'replace' }, at(3));
    assert.deepEqual(r.removed, [{ id: 'n2', reason: 'replaced' }]);
    assert.deepEqual(s.entries.map((e) => e.id), ['n1', 'n3'], 'the pinned one stays');
    assert.match(s.read().sentence, /^Your notes \(\d+ of 1500 characters\):\n- \[n1/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('refusals in the house format: over the cap, a long code block, a third pin', () => {
  const s = createScratch();
  const big = s.write({ text: 'x'.repeat(SCRATCH_CAP + 1) }, at(1));
  assert.equal(big.code, 'SCRATCH_TOO_LONG');
  assert.match(big.sentence, /^Refused \(SCRATCH_TOO_LONG\): the note is 1501 characters and the pinned notes 0, over the 1500-character cap\.\nRule: [^\n]+\.\nA correct call: scratch_write \{"text":/);
  const code = s.write({ text: 'Draft:\n```tsx\na\nb\nc\nd\ne\nf\n```' }, at(1));
  assert.equal(code.code, 'SCRATCH_CODE');
  assert.match(code.sentence, /a code draft goes to plan_add/);
  assert.equal(s.write({ text: 'one', pin: true }, at(1)).ok, true);
  assert.equal(s.write({ text: 'two', pin: true }, at(1)).ok, true);
  assert.equal(s.write({ text: 'three', pin: true }, at(1)).code, 'SCRATCH_PINS');
});

test('gc: a covered point or a landed file drops its notes', () => {
  const s = createScratch();
  s.write({ text: 'PCK-1 needs the count link.' }, at(2, 'PCK-1'));
  s.write({ text: 'Fix line 7.', about: 'features/picks/pages/PicksPage.tsx' }, at(3, 'PCK-2'));
  s.write({ text: 'Still open.' }, at(3, 'PCK-3'));
  const r = s.gc({ turn: 4, covered: ['PCK-1'], landed: new Map([['features/picks/pages/PicksPage.tsx', 4]]) });
  assert.deepEqual(r, [{ id: 'n1', reason: 'point PCK-1 is covered' }, { id: 'n2', reason: 'the step on features/picks/pages/PicksPage.tsx landed (turn 4)' }]);
  assert.deepEqual(s.entries.map((e) => e.id), ['n3']);
  // A landing before the note was written does not drop it.
  s.write({ text: 'New idea for the page.', about: 'features/picks/pages/PicksPage.tsx' }, at(5, 'PCK-3'));
  assert.deepEqual(s.gc({ turn: 6, landed: { 'features/picks/pages/PicksPage.tsx': 4 } }), []);
});

test('gc: a newer note with the same about supersedes the older one', () => {
  const s = createScratch();
  s.write({ text: 'Try ?? "".', about: 'PCK-4' }, at(1, 'x'));
  s.write({ text: 'Other.', about: 'PCK-5' }, at(1, 'x'));
  s.write({ text: "Try ?? '[]' instead.", about: 'PCK-4' }, at(2, 'x'));
  assert.deepEqual(s.gc({ turn: 2 }), [{ id: 'n1', reason: 'superseded about PCK-4' }]);
  assert.deepEqual(s.entries.map((e) => e.id), ['n2', 'n3']);
});

test('gc: older than 6 turns goes unless pinned; over the cap, the oldest unpinned first', () => {
  const s = createScratch();
  s.write({ text: 'Pinned plan.', pin: true }, at(1, 'x'));
  s.write({ text: 'Old note.' }, at(1, 'x'));
  s.write({ text: 'Recent note.' }, at(6, 'x'));
  assert.deepEqual(s.gc({ turn: 8 }), [{ id: 'n2', reason: 'older than 6 turns' }]);
  assert.deepEqual(s.entries.map((e) => e.id), ['n1', 'n3']);
  const small = createScratch({ cap: 100 });
  small.write({ text: 'a'.repeat(40), pin: true }, at(1, 'x'));
  small.write({ text: 'b'.repeat(40) }, at(1, 'x'));
  const w = small.write({ text: 'c'.repeat(40) }, at(2, 'x'));
  assert.deepEqual(w.removed, [{ id: 'n2', reason: 'over the cap' }], 'the write itself makes room: the cap refusal is the last resort');
  assert.deepEqual(small.entries.map((e) => e.id), ['n1', 'n3']);
});

test('the ledger turn shows the notes under "Your notes", inside the budget, and never in the ledger', () => {
  const s = createScratch();
  s.write({ text: "Plan: line 7 gets ?? '[]', then PCK-2.", about: 'PCK-1' }, at(3));
  const ledger = createLedger();
  ledger.add({ kind: 'fact', text: 'line.setCode on PicksPage was refused (TYPE_ERROR).', cites: ['line.setCode'] });
  const built = buildTurn({ system: { role: 'system', content: 'Rules.' }, ledger, ledgerView, card: 'Now: PCK-1.', last: [], notes: s.text });
  assert.match(built.messages[1].content, /Your notes \(your own scratchpad, not checked by Line\):\n- \[n1, turn 3, at PCK-1, about PCK-1\] Plan: line 7/);
  assert.ok(built.parts.notes > 0 && built.parts.notes <= TURN_BUDGET.notes);
  assert.ok(!ledgerView({ ledger }, 500).includes('Plan: line 7'));
  const none = buildTurn({ system: { role: 'system', content: 'Rules.' }, ledger, ledgerView, card: 'x', last: [], notes: '' });
  assert.ok(!none.messages[1].content.includes('Your notes'));
  assert.equal(none.parts.notes, 0);
});

/** Every file under `root` (but node_modules) with its sha256. */
const snapshot = (root) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const r = path.join(d, e.name); if (e.name === 'node_modules') continue; if (e.isDirectory()) walk(r); else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, r))).digest('hex'); } };
  walk('');
  return out;
};

test('driver: scratch_write never changes project files, never reaches calls.jsonl or the ledger; next turn shows it', async () => {
  const parent = fs.realpathSync(makeTempDir('scratch-run-'));
  const SCRIPT = [
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'scratch_write', arguments: { text: 'Plan: start with PicksPage.', about: 'PCK-1' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'scratch_read', arguments: {} } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'finish', arguments: { summary: 'done' } } }] },
  ];
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { bodies.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: SCRIPT[Math.min(bodies.length - 1, 2)], done: true, prompt_eval_count: 1, eval_count: 1 })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const project = /** @type {string} */ (createLineProject(parent, { name: 'lending', firstFeature: 'picks' }).dir);
    const before = snapshot(project);
    const o = flags(['--project', project, '--arm', 'line', '--builder', 'scratch-test', '--ollama', `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`, '--bench', path.join(path.dirname(new URL(import.meta.url).pathname), '../bench/lending')]);
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    assert.equal(r.stop, 'finish: done');
    const after = snapshot(project);
    for (const [f, h] of Object.entries(after)) if (!f.startsWith('line') && !f.startsWith('.')) assert.equal(h, before[f], `${f} changed`);
    assert.ok(Object.keys(after).every((f) => f in before || f.startsWith('line') || f.startsWith('.')), 'no new project file');
    const logs = path.join(parent, 'logs');
    assert.match(fs.readFileSync(path.join(logs, 'scratch.md'), 'utf8'), /Plan: start with PicksPage\./);
    const calls = fs.existsSync(path.join(logs, 'calls.jsonl')) ? fs.readFileSync(path.join(logs, 'calls.jsonl'), 'utf8') : '';
    // #931's finish gate logs the finish call (builder "scratch-test"), so the check is on the commands, not the text.
    const cmds = calls.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).cmd);
    assert.ok(!cmds.some((c) => /scratch/.test(String(c))), 'not a plan-cli call');
    assert.match(bodies[1].messages[1].content, /Your notes[^]*Plan: start with PicksPage\./);
    assert.ok(!/What is known so far[^]*Plan: start with PicksPage[^]*\n\nNow:/.test(bodies[1].messages[1].content), 'the note is not a ledger line');
    const rows = fs.readFileSync(path.join(logs, 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((t) => t.kind === 'turn');
    assert.match(rows[0].scratch.version, /Plan: start with PicksPage/);
    assert.ok(rows[1].context.parts.notes > 0);
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(parent, { recursive: true, force: true }); }
});
