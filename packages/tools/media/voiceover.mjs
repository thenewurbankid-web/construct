#!/usr/bin/env node
// Voice-over from a caption timeline, with a local text-to-speech model (Kokoro, Apache-2.0, CPU, offline once cached).
//
//   node packages/tools/media/voiceover.mjs site/assets/video/01-ticket-to-story.captions.json \
//        [--voice af_heart] [--speed 0.95] [--out site/assets/video/01-ticket-to-story.voice.opus] \
//        [--video site/assets/video/01-ticket-to-story.webm]
//   node packages/tools/media/voiceover.mjs --list-voices
//
// The captions file is a JSON array of { "text": "...", "start": <seconds from the video start> }.
// Output: one audio file with each caption spoken at its start time (default voice: af_heart, a warm female
// voice). With --video, also writes <video>.voice.webm (the video with the voice-over) using add-audio.sh.
// The narration is synthetic: say so on the page. No cloud service is used.
//
// One-time setup (kept out of the repo): mkdir -p ~/.cache/construct-media && cd ~/.cache/construct-media \
//   && npm init -y && npm i kokoro-js   (set CONSTRUCT_MEDIA_CACHE to use another folder). Needs ffmpeg (or FFMPEG=...).
// Only synthetic stock voices are supported here. Never imitate a real person's voice; a clone is only ever made from
// a sample its speaker supplies of their own voice (#462).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = process.env.CONSTRUCT_MEDIA_CACHE || path.join(os.homedir(), '.cache', 'construct-media');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const fail = (msg) => { console.error(msg); process.exit(1); };

let kokoro;
try {
  const req = createRequire(path.join(CACHE, 'noop.js'));
  kokoro = await import(pathToFileURL(req.resolve('kokoro-js')).href);
} catch {
  fail(`kokoro-js is not installed in ${CACHE}.\n  mkdir -p ${CACHE} && cd ${CACHE} && npm init -y && npm i kokoro-js`);
}
const tts = await kokoro.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });

if (args.includes('--list-voices')) {
  for (const [id, v] of Object.entries(tts.voices)) console.log(`${id.padEnd(12)} ${v.gender.padEnd(7)} ${v.language.padEnd(6)} ${v.name}`);
  process.exit(0);
}

const file = args.find((a) => a.endsWith('.json'));
if (!file || !fs.existsSync(file)) fail('give a captions file (JSON array of {text, start}); see the header of this script.');
const captions = JSON.parse(fs.readFileSync(file, 'utf8'));
const voice = flag('--voice', 'af_heart');
if (!tts.voices[voice]) fail(`unknown voice "${voice}"; try --list-voices`);
const speed = Number(flag('--speed', 0.95));
const out = flag('--out', file.replace(/\.captions\.json$|\.json$/, '.voice.opus'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-voice-'));
const inputs = []; const filters = []; let labels = '';
try {
  for (const [i, c] of captions.entries()) {
    const wav = path.join(tmp, `c${i}.wav`);
    const clip = await tts.generate(c.text, { voice, speed });
    await clip.save(wav);
    const ms = Math.round(Number(c.start) * 1000);
    inputs.push('-i', wav);
    filters.push(`[${i}:a]adelay=${ms}:all=1[a${i}]`);
    labels += `[a${i}]`;
    console.log(`${String(c.start).padStart(6)} s  ${(clip.audio.length / clip.sampling_rate).toFixed(1)} s  ${c.text.slice(0, 60)}`);
  }
  filters.push(`${labels}amix=inputs=${captions.length}:normalize=0:duration=longest[mix]`);
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-c:a', 'libopus', '-b:a', '96k', out]);
  console.log(`wrote ${out} (voice ${voice}, ${captions.length} clips)`);
  const video = flag('--video');
  if (video) {
    const muxed = video.replace(/\.webm$/, '.voice.webm');
    execFileSync(path.join(HERE, 'add-audio.sh'), [video, '--track', out, '--volume', '1', '--fade', '0.05', '--out', muxed], { stdio: 'inherit', env: process.env });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
