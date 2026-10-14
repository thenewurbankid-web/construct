// #948 item 5 -- the research sub-agent is modelled: a text answer is refused, the answer comes only through the
// `answer` tool, and its cites must be files the sub-agent read for the question; each refusal carries an example of a
// valid answer call. Fake models only: one answers in text, one cites a file it never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { runSubagent } from '../packages/engine/line/research/subagent.mjs';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples/line-sample');
const call = (name, args) => ({ function: { name, arguments: args } });
function fakeChat(script) {
  const seen = [];
  return { seen, chat: async (req) => { seen.push(JSON.parse(JSON.stringify(req))); return { message: { role: 'assistant', content: '', ...script[Math.min(seen.length - 1, script.length - 1)] } }; } };
}
const root = () => { const dir = makeTempDir('construct-modelled-research-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const SPEC = 'features/orders/spec.md';

test('a text answer is refused with an example; cites of an unread file are refused; the answer through the tool lands', async () => {
  const { chat, seen } = fakeChat([
    { content: 'The orders feature is in features/orders/spec.md.' },
    { tool_calls: [call('answer', { answer: 'Orders has a spec.', cites: [SPEC] })] },
    { tool_calls: [call('read_file', { path: SPEC })] },
    { tool_calls: [call('answer', { answer: 'Orders has a spec. It lists the points.', cites: [`${SPEC}:3`, 'made/up.ts'] })] },
  ]);
  const r = await runSubagent({ root: root(), question: 'Where is the orders spec?', view: '', chat, maxTurns: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.turns, 4);
  assert.equal(r.answer, 'Orders has a spec.');
  assert.deepEqual(r.cites, [`${SPEC}:3`], 'only cites of files read here are kept');
  const after = (i) => seen[i].messages.at(-1).content;
  assert.match(after(1), /^Refused \(TEXT_ANSWER\): a text answer is not taken[\s\S]*Read the file that backs your answer first/);
  assert.match(after(2), /^Refused \(BAD_CITES\): cites must be files you read[\s\S]*features\/orders\/spec\.md/);
  assert.match(after(3), /"path":"features\/orders\/spec\.md"|"ok":true/);
});

test('no answer through the tool within the cap leaves the question open; LINE_LEGACY_IO=1 takes the text answer', async () => {
  const text = { content: 'It is in features/orders/spec.md.' };
  const modelled = await runSubagent({ root: root(), question: 'Where?', view: '', chat: fakeChat([text]).chat, maxTurns: 2 });
  assert.equal(modelled.ok, false);
  assert.equal(modelled.stop, 'turn cap');
  const prev = process.env.LINE_LEGACY_IO; process.env.LINE_LEGACY_IO = '1';
  try {
    const legacy = await runSubagent({ root: root(), question: 'Where?', view: '', chat: fakeChat([text]).chat, maxTurns: 2 });
    assert.equal(legacy.ok, true);
  } finally { if (prev === undefined) delete process.env.LINE_LEGACY_IO; else process.env.LINE_LEGACY_IO = prev; }
});
