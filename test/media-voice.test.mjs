// tools/media: spoken wording, the parameter-aware clip cache key, subtle paralinguistics and owner feedback. No model needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { feedbackOverrides, normalize, proposePara, spoken } from '../tools/media/lib.mjs';
import { cloneParams, plan, said } from '../tools/media/synth.mjs';

test('say is what is spoken; subtitles keep text; overrides survive normalize', () => {
  const [l] = normalize([{ text: 'It is fine.', say: "It's fine.", start: 0, exaggeration: '0.7', para: ['breath_before'] }]);
  assert.equal(spoken(l), "It's fine.");
  assert.equal(l.text, 'It is fine.');
  assert.equal(l.exaggeration, 0.7);
  assert.deepEqual(l.para, ['breath_before']);
  assert.throws(() => normalize([{ text: 'a', start: 0, cfg_weight: 'x' }]), /cfg_weight must be a number/);
});

test('the clip cache key follows the spoken text, every voice parameter and the reference', () => {
  const wav = path.join(os.tmpdir(), `media-test-${process.pid}.wav`);
  const wav2 = `${wav}.2`;
  fs.writeFileSync(wav, 'not really audio');
  fs.writeFileSync(wav2, 'different bytes');
  try {
    const line = { text: 'Hello there.', start: 0 };
    const key = (l, o) => plan([l], { sample: wav, ...o })[0].key;
    const k = key(line, {});
    assert.equal(k, key(line, {}), 'repeatable');
    assert.notEqual(k, key({ ...line, say: 'Hello, there.' }, {}), 'say changes the key');
    assert.equal(k, key({ ...line, text: 'Subtitle only changed.', say: 'Hello there.' }, {}), 'the subtitle text alone does not');
    for (const change of [{ exaggeration: 0.7 }, { cfgWeight: 0.3 }, { temperature: 0.9 }, { pauseMs: 400 }, { seed: 2 }, { ref: wav2 }, { model: 'turbo' }]) {
      assert.notEqual(k, key(line, change), JSON.stringify(change));
    }
    assert.notEqual(k, key({ ...line, exaggeration: 0.9 }, {}), 'a per-line override changes it');
    assert.notEqual(k, key(line, { ttsCmd: 'my-tts {text_file} {out}' }), 'a plug-in command has its own clips');
    assert.notEqual(key(line, { ttsCmd: 'my-tts {text_file} {out}' }), key(line, { ttsCmd: 'my-tts --fine-tuned {text_file} {out}' }), 'and the command string is part of the key');
    assert.notEqual(k, key({ ...line, para: ['pause_ms:600'] }, {}), 'a pause token changes it');
    assert.deepEqual(cloneParams({}, {}), { exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8, pause_ms: 280, seed: 1 }, 'defaults unchanged, so earlier cache keys stay valid');
    assert.equal(said({ text: 'Bye.', para: ['chuckle_after'] }, { model: 'turbo' }), 'Bye. [chuckle]');
    assert.equal(said({ text: 'Bye.', para: ['chuckle_after'] }, {}), 'Bye.', 'no tag for a model without tags');
  } finally {
    fs.rmSync(wav, { force: true });
    fs.rmSync(wav2, { force: true });
  }
});

test('proposePara is subtle, repeatable and respects explicit para', () => {
  const long = 'This is a long friendly sentence that goes on for quite a while so that it counts as long text.';
  const technical = 'See `app/page.tsx` and READ-003 here, which is long enough to count but is technical anyway, really.';
  const lines = normalize(Array.from({ length: 24 }, (_, i) => ({ text: i === 5 ? technical : long, start: i * 10 })));
  const a = proposePara(lines, 1);
  assert.deepEqual(a, proposePara(lines, 1), 'fixed seed, same result');
  assert.ok(a[0].para.includes('breath_before'), 'a breath at the greeting');
  const breaths = a.filter((l) => (l.para || []).includes('breath_before'));
  assert.ok(breaths.length >= 4 && breaths.length <= 9, `about every 3rd-4th long line, got ${breaths.length}`);
  assert.ok(!a[5].para, 'never inside a technical line');
  for (let i = 1; i < a.length; i++) assert.ok(!(a[i].para && a[i - 1].para), 'never two in a row');
  assert.equal(a.flatMap((l) => l.para || []).filter((t) => t === 'chuckle_after').length, 1, 'one chuckle at most');
  const explicit = proposePara(normalize([{ text: long, start: 0, para: [] }, { text: long, start: 9 }]), 1);
  assert.deepEqual(explicit[0].para, [], 'an explicit empty para turns it off for that line');
});

test('feedback becomes per-line overrides from a fixed base, so applying it twice changes nothing', () => {
  const lines = normalize([{ text: 'One.', start: 0 }, { text: 'Two.', start: 5 }, { text: 'Three.', start: 9 }]);
  const variants = [{ id: 'expressive', params: { exaggeration: 0.7, cfg_weight: 0.3, temperature: 0.8 } }];
  const fb = { l01: { pick: 'expressive', tags: ['more_expression', 'slower'] }, l02: { tags: ['less_expression', 'faster', 'clearer'] }, nope: { tags: ['warmer'] } };
  const once = feedbackOverrides(lines, fb, variants);
  assert.deepEqual(once.map((c) => c.id), ['l01', 'l02']);
  assert.deepEqual(once[0].set, { exaggeration: 0.8, cfg_weight: 0.2, temperature: 0.8, pause_ms: 430 });
  assert.deepEqual(once[1].set, { exaggeration: 0.4, cfg_weight: 0.65, temperature: 0.7, pause_ms: 180 });
  const applied = lines.map((l) => ({ ...l, ...(once.find((c) => c.id === l.id)?.set || {}) }));
  assert.deepEqual(feedbackOverrides(applied, fb, variants), once, 'idempotent');
});
