import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTypewriter, stepTypewriter, typedText, LOGIN_PHRASES, HOLD_MS } from './Typewriter.ts';

const PH = ['ab', 'c'];

test('types one character at a time, holds, deletes, then moves to the next phrase', () => {
  let s = initialTypewriter;
  const seen = [typedText(s, PH)];
  let holds = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = stepTypewriter(s, PH);
    if (r.delayMs === HOLD_MS) holds += 1;
    s = r.state;
    seen.push(typedText(s, PH));
  }
  assert.deepEqual(seen.slice(0, 7), ['', 'a', 'ab', 'ab', 'ab', 'a', '']);
  assert.ok(seen.includes('c'), 'reaches the second phrase');
  assert.ok(holds >= 1, 'pauses on a finished phrase');
});

test('wraps around after the last phrase and never indexes past the list', () => {
  let s = { phraseIndex: PH.length - 1, chars: 0, phase: 'deleting' };
  s = stepTypewriter(s, PH).state;
  assert.equal(s.phraseIndex, 0);
  assert.equal(typedText({ phraseIndex: 99, chars: 1, phase: 'typing' }, PH).length <= 1, true);
});

test('the shipped phrases are short single lines', () => {
  for (const p of LOGIN_PHRASES) assert.ok(p.length > 0 && p.length <= 45 && !p.includes('\n'), p);
});
