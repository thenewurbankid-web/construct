import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGloss, codeTokens, glossFor, glossMessages, introducedToken, GLOSS_OPTIONS } from './gloss.mjs';

const SMITH = ["Card using {title, items} works in 2 steps.", "If not (items's length), return nothing.", "It returns shows a <div> with class name as 'card' containing title."];
const fake = (answer) => {
  const calls = [];
  const chat = async (model, messages, options) => { calls.push({ model, messages, options }); return typeof answer === 'function' ? answer(calls.length) : answer; };
  return { chat, calls };
};

test('a clean gloss is returned and shown', async () => {
  const { chat, calls } = fake('Card shows its title in a box, or nothing when there are no items.');
  const r = await glossFor(SMITH, { chat, cache: new Map() });
  assert.equal(r.dropped, false);
  assert.equal(r.text, r.gloss);
  assert.match(r.gloss, /Card shows its title/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'qwen2.5-coder:1.5b');
});

test('the prompt holds only the Smith sentences, at low temperature with capped output', async () => {
  const { chat, calls } = fake('Card shows its title.');
  await glossFor(SMITH, { chat, cache: new Map() });
  const sent = calls[0].messages.map((m) => m.content).join('\n');
  assert.ok(sent.includes(SMITH.join(' ')));
  assert.deepEqual(calls[0].messages, glossMessages(SMITH.join(' ')));
  assert.ok(!/function|return\s*<|=>/.test(calls[0].messages[1].content.replace(SMITH.join(' '), '')));
  assert.ok(calls[0].options.temperature <= 0.2);
  assert.ok(calls[0].options.num_predict > 0 && calls[0].options.num_predict <= 128);
  assert.deepEqual(calls[0].options, { ...GLOSS_OPTIONS });
});

test('an introduced identifier drops the gloss and keeps Smith text alone', async () => {
  const { chat } = fake('Card renders a CardHeader with the title.');
  const r = await glossFor(SMITH, { chat, cache: new Map() });
  assert.equal(r.dropped, true);
  assert.equal(r.gloss, null);
  assert.equal(r.text, SMITH.join(' '));
  assert.match(r.reason, /CardHeader/);
});

test('an introduced literal drops the gloss', async () => {
  for (const answer of ["Card shows a box with class 'panel'.", 'Card shows up to 10 items.']) {
    const r = await glossFor(SMITH, { chat: fake(answer).chat, cache: new Map() });
    assert.equal(r.dropped, true, answer);
    assert.equal(r.text, SMITH.join(' '));
  }
});

test('names and literals that Smith used are allowed', async () => {
  const r = await glossFor(SMITH, { chat: fake("Card draws a <div> with class 'card' holding the title, in 2 steps.").chat, cache: new Map() });
  assert.equal(r.dropped, false, r.reason);
});

test('the cache is keyed by the sentence hash: same sentences, one model call', async () => {
  const { chat, calls } = fake('Card shows its title.');
  const cache = new Map();
  const a = await glossFor(SMITH, { chat, cache });
  const b = await glossFor(SMITH.join(' '), { chat, cache });
  assert.equal(calls.length, 1);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(b.text, a.text);
  await glossFor([...SMITH, 'It then stops.'], { chat, cache });
  assert.equal(calls.length, 2);
});

test('a failed or empty model answer falls back to Smith text and never throws', async () => {
  const boom = async () => { throw new Error('connection refused'); };
  const r = await glossFor(SMITH, { chat: boom, cache: new Map() });
  assert.equal(r.dropped, true);
  assert.equal(r.text, SMITH.join(' '));
  assert.match(r.reason, /connection refused/);
  const e = await glossFor(SMITH, { chat: fake('   ').chat, cache: new Map() });
  assert.equal(e.dropped, true);
  assert.equal((await glossFor([], { chat: fake('x').chat, cache: new Map() })).reason, 'no Smith text');
});

test('possessives, acronyms and backticked names Smith used do not trip the guard', () => {
  const smith = "Page works in 1 step. It returns shows a <CoreController>. Let checked be machine send state's data; if checked's status !== 'submitting', return checked.";
  assert.equal(introducedToken("It checks the machine's state and isn't done unless status is 'submitting'.", smith), null);
  assert.equal(introducedToken('It shows the `<CoreController >` as an HTML page with an ID.', smith), null);
  assert.equal(introducedToken('The `canUndo` check runs.', smith).value, 'canUndo');
  assert.equal(introducedToken('It has 1 part.', 'It shows a <h1>.').value, '1');
});

test('cleanGloss keeps at most two sentences and strips preamble', () => {
  assert.equal(cleanGloss('Plain English: "One. Two! Three."'), 'One. Two!');
  assert.equal(cleanGloss('**It works.**'), 'It works.');
});

test('codeTokens and introducedToken', () => {
  const vals = codeTokens('It calls fetchUser() then sets user.name to "x" and shows a <ListPage> with 3 rows.').map((t) => t.value);
  assert.ok(vals.includes('fetchUser'));
  assert.ok(vals.includes('user.name'));
  assert.ok(vals.includes('x'));
  assert.ok(vals.includes('ListPage'));
  assert.ok(vals.includes('3'));
  assert.ok(!vals.includes('It'));
  assert.equal(introducedToken('It shows the items.', SMITH.join(' ')), null);
  assert.equal(introducedToken('It uses useMemo.', SMITH.join(' ')).value, 'useMemo');
});
