// tools/media: the narration script model, subtitles, clip-cache key and write guard. No model or ffmpeg needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CLIP_CACHE, VIDEO_DIR, assertWritable, clipKey, normalize, paths, toSrt, toVtt } from '../tools/media/lib.mjs';

const script = [
  { text: 'First line.', start: 1 },
  { id: 'second', text: 'Second line, a little longer than the first one is.', start: 5.5, end: 9 },
  { text: 'Last.', start: 12 },
];

test('normalize fills ids and ends without overlapping the next line, and rejects bad input', () => {
  const n = normalize(script);
  assert.deepEqual(n.map((l) => l.id), ['l01', 'second', 'l03']);
  assert.equal(n[0].end, 4, 'reading time (3 s) is shorter than the gap, so it wins');
  assert.equal(n[1].end, 9, 'an explicit end is kept');
  assert.equal(n[2].end, 15, 'the last line gets its reading time');
  assert.equal(normalize([{ text: 'a', start: 0 }, { text: 'b', start: 1 }])[0].end, 0.9, 'never runs into the next line');
  assert.throws(() => normalize([{ text: '', start: 0 }]), /text is required/);
  assert.throws(() => normalize([{ text: 'a', start: -1 }]), /start/);
  assert.throws(() => normalize([{ text: 'a', start: 2, end: 1 }]), /end must be after start/);
});

test('SRT and WebVTT come from the same script', () => {
  const srt = toSrt(script);
  assert.match(srt, /^1\n00:00:01,000 --> 00:00:04,000\nFirst line\.\n\n2\n00:00:05,500 --> 00:00:09,000\nSecond line/);
  const vtt = toVtt(script);
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:04\.000\nFirst line\./);
  assert.equal((vtt.match(/-->/g) || []).length, 3);
});

test('the clip cache key changes with text, voice, model and speed, and only then', () => {
  const base = { text: 'Hello there.', voice: 'af_heart', model: 'kokoro', speed: 0.95 };
  const k = clipKey(base);
  assert.equal(k, clipKey({ ...base, text: '  Hello there.  ' }), 'surrounding space does not matter');
  assert.match(k, /^[0-9a-f]{24}$/);
  for (const change of [{ text: 'Hello there!' }, { voice: 'af_bella' }, { model: 'chatterbox' }, { speed: 1 }]) {
    assert.notEqual(k, clipKey({ ...base, ...change }), JSON.stringify(change));
  }
});

test('writes are refused outside the video folder and the clip cache', () => {
  assert.equal(assertWritable(path.join(VIDEO_DIR, 'x.voice.opus')), path.join(VIDEO_DIR, 'x.voice.opus'));
  assert.ok(assertWritable(path.join(CLIP_CACHE, 'a.wav')));
  assert.throws(() => assertWritable('/tmp/x.opus'), /refusing to write/);
  assert.throws(() => assertWritable(path.join(VIDEO_DIR, '..', 'x.opus')), /refusing to write/);
  assert.throws(() => paths('../evil'), /bad slug/);
});
