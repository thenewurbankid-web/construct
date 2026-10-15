import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPilot } from './runner.mjs';
import { mockModel, requestEntryId } from './mock-model.mjs';

const REFUSAL = 'The word `flattened` is not in the grammar\'s verb list; use `flattens()`.';

// Text after the prefill `{"entry": "<id>", "decision": "`.
const rest = (decision, sentence) =>
  `${decision}", "atom": "a", "existing": null, "kind": "copy", "sentence": ${JSON.stringify(sentence)}, ` +
  '"js": "xs.f()", "params": [["xs", "list"]], "parts": null, "reason": null}';

const fixtures = {
  'Array.prototype.at': rest('new-atom', 'item(i).of(xs)'),
  'Array.prototype.flatMap': [rest('new-atom', 'xs.flattened()'), rest('new-atom', 'xs.flattens()')],
  'Array.prototype.flat': [rest('molecule', 'xs.flattened()'), rest('molecule', 'xs.flattened().again()')],
  'Array.prototype.with': ['new-atom", "atom": ', 'oops'],
};
const entries = Object.keys(fixtures).map((id) => ({ id, section: 'Array' }));

const build = (entry, { refusal }) => {
  build.calls.push({ entry: entry.id, refusal });
  return { system: 'sys', user: `entry ${entry.id}${refusal ? `\nrefused: ${refusal}` : ''}`, prefill: `{"entry": "${entry.id}", "decision": "` };
};

const gate = async (answer) => {
  const bad = answer.sentence.includes('flattened');
  return {
    entry: answer.entry,
    pass: !bad,
    checks: { schema: 'pass', grammar: bad ? 'fail' : 'pass', equivalence: bad ? 'skip' : 'pass', types: bad ? 'skip' : 'pass' },
    refusal: bad ? REFUSAL : null,
    fixes: bad ? [{ kind: 'replace-word', from: 'flattened', to: 'flattens' }] : [],
  };
};

test('mock model reads the entry id from the prefill and walks its fixture list', async () => {
  const model = mockModel({ a: ['one', 'two'] });
  const req = { system: 's', user: 'u', prefill: '{"entry": "a", "decision": "' };
  assert.equal(requestEntryId(req), 'a');
  assert.equal((await model(req)).text, 'one');
  assert.equal((await model(req)).text, 'two');
  assert.equal((await model(req)).text, 'two');
  await assert.rejects(model({ prefill: '{"entry": "b"' }), /no fixture for entry b/);
});

test('runPilot over 4 entries: first-try pass, retry pass, retry fail, unparsable', async () => {
  build.calls = [];
  const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
  const log = join(dir, 'run.jsonl');
  try {
    const { results, summary } = await runPilot(entries, { model: mockModel(fixtures), gate, build, log });
    const [first, retried, failed, unparsable] = results;

    assert.deepEqual(results.map((r) => r.entry), Object.keys(fixtures));
    for (const r of results) {
      assert.deepEqual(Object.keys(r), ['entry', 'answer', 'gate', 'tries', 'tokensIn', 'tokensOut', 'ms']);
      assert.ok(r.tokensIn > 0 && r.tokensOut > 0 && r.ms >= 0);
    }

    assert.equal(first.tries, 1);
    assert.equal(first.gate.pass, true);
    assert.equal(first.answer.sentence, 'item(i).of(xs)');

    assert.equal(retried.tries, 2);
    assert.equal(retried.gate.pass, true);
    assert.equal(retried.answer.sentence, 'xs.flattens()');

    assert.equal(failed.tries, 2);
    assert.equal(failed.gate.pass, false);
    assert.equal(failed.gate.refusal, REFUSAL);
    assert.equal(failed.answer.decision, 'molecule');

    assert.equal(unparsable.tries, 2);
    assert.equal(unparsable.answer, null);
    assert.equal(unparsable.gate.pass, false);
    assert.equal(unparsable.gate.entry, 'Array.prototype.with');
    assert.deepEqual(unparsable.gate.checks, { schema: 'fail', grammar: 'skip', equivalence: 'skip', types: 'skip' });
    assert.match(unparsable.gate.refusal, /^The answer is not valid JSON .*\.$/);
    assert.deepEqual(unparsable.gate.fixes, []);

    // The retry carries the previous refusal; first tries carry none.
    assert.deepEqual(build.calls.map((c) => [c.entry, c.refusal !== null]), [
      ['Array.prototype.at', false],
      ['Array.prototype.flatMap', false], ['Array.prototype.flatMap', true],
      ['Array.prototype.flat', false], ['Array.prototype.flat', true],
      ['Array.prototype.with', false], ['Array.prototype.with', true],
    ]);
    assert.equal(build.calls[2].refusal, REFUSAL);
    assert.match(build.calls[6].refusal, /^The answer is not valid JSON/);

    const tokens = results.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0);
    const { msPerEntry, ...rest_ } = summary;
    assert.ok(msPerEntry >= 0);
    assert.deepEqual(rest_, {
      entries: 4,
      passed: 2,
      passRate: 0.5,
      retries: 3,
      tokensPerEntry: tokens / 4,
      decisions: { 'new-atom': 2, molecule: 1 },
    });

    const lines = (await readFile(log, 'utf8')).trimEnd().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines, results);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('maxRetries 0 stops after one try; missing collaborators are refused', async () => {
  build.calls = [];
  const { results, summary } = await runPilot([entries[1]], { model: mockModel(fixtures), gate, build, maxRetries: 0 });
  assert.equal(results[0].tries, 1);
  assert.equal(results[0].gate.pass, false);
  assert.equal(summary.retries, 0);
  await assert.rejects(runPilot(entries, { gate, build }), /injected model function/);
});
