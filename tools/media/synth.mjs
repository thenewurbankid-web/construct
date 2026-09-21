// Text to speech for the caption script, with a per-line clip cache (only edited lines are generated again), and the
// mix of the clips into one narration track. Two backends: Kokoro (default, Apache-2.0, node) and, with a voice sample its
// speaker supplied, Chatterbox (MIT, Python venv; tools/media/clone_voice.py). Everything runs locally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLIP_CACHE, assertWritable, clipKey, sampleFingerprint } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_CACHE = process.env.CONSTRUCT_MEDIA_CACHE || path.join(os.homedir(), '.cache', 'construct-media');
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const KOKORO_MODEL = 'kokoro-82m-v1.0-q8';
const CLONE_MODEL = 'chatterbox-0.1.7';

async function loadKokoro() {
  try {
    const req = createRequire(path.join(MEDIA_CACHE, 'noop.js'));
    const kokoro = await import(pathToFileURL(req.resolve('kokoro-js')).href);
    return await kokoro.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  } catch {
    throw new Error(`kokoro-js is not installed in ${MEDIA_CACHE}.\n  mkdir -p ${MEDIA_CACHE} && cd ${MEDIA_CACHE} && npm init -y && npm i kokoro-js`);
  }
}

/** The Kokoro stock voices: { id: { gender, language, name } }. */
export const kokoroVoices = async () => (await loadKokoro()).voices;

const sidecar = (key) => path.join(CLIP_CACHE, `${key}.json`);
export const clipFile = (key) => path.join(CLIP_CACHE, `${key}.wav`);

/** Which cache key each line would use, and whether its clip exists. `sample` selects the cloned voice. */
export function plan(lines, { voice = 'af_heart', sample, speed = 0.95 } = {}) {
  const voiceId = sample ? sampleFingerprint(sample) : voice;
  const model = sample ? CLONE_MODEL : KOKORO_MODEL;
  return lines.map((l) => {
    const key = clipKey({ text: l.text, voice: voiceId, model, speed: sample ? 1 : speed });
    return { ...l, key, cached: fs.existsSync(clipFile(key)) && fs.existsSync(sidecar(key)) };
  });
}

/** Generate the clips that are not cached yet (one model process, one line at a time) and return every line with its
 * clip file and length in seconds. `log(line)` reports each generated line. */
export async function synthesize(lines, opts = {}, log = () => {}) {
  const { voice = 'af_heart', sample, speed = 0.95 } = opts;
  const planned = plan(lines, opts);
  const todo = planned.filter((l) => !l.cached);
  fs.mkdirSync(assertWritable(CLIP_CACHE), { recursive: true });
  if (todo.length && sample) {
    if (!fs.existsSync(sample)) throw new Error(`no such sample: ${sample}`);
    const py = process.env.CONSTRUCT_MEDIA_PYTHON || path.join(MEDIA_CACHE, 'venv', 'bin', 'python');
    if (!fs.existsSync(py)) throw new Error(`voice-cloning venv not found at ${py}; see docs/MEDIA.md (Voice cloning).`);
    const job = assertWritable(path.join(CLIP_CACHE, `job-${process.pid}.json`));
    fs.writeFileSync(job, JSON.stringify(todo.map((l) => ({ text: l.text, file: l.key }))));
    try {
      const res = execFileSync(py, [path.join(HERE, 'clone_voice.py'), sample, job, CLIP_CACHE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
      for (const row of res.split('\n').filter((x) => x.startsWith('{')).map((x) => JSON.parse(x))) {
        fs.writeFileSync(sidecar(todo[row.i].key), JSON.stringify({ seconds: row.seconds }));
        log(`generated ${row.seconds.toFixed(1)} s in ${row.compute} s: ${todo[row.i].text.slice(0, 50)}`);
      }
    } finally {
      fs.rmSync(job, { force: true });
    }
  } else if (todo.length) {
    const tts = await loadKokoro();
    if (!tts.voices[voice]) throw new Error(`unknown voice "${voice}"; run: node tools/media/voiceover.mjs --list-voices`);
    for (const l of todo) {
      const clip = await tts.generate(l.text, { voice, speed });
      await clip.save(assertWritable(clipFile(l.key)));
      const seconds = clip.audio.length / clip.sampling_rate;
      fs.writeFileSync(sidecar(l.key), JSON.stringify({ seconds }));
      log(`generated ${seconds.toFixed(1)} s: ${l.text.slice(0, 50)}`);
    }
  }
  return planned.map((l) => ({ ...l, wav: clipFile(l.key), seconds: JSON.parse(fs.readFileSync(sidecar(l.key), 'utf8')).seconds }));
}

/** Lines whose clip is longer than the room before the next line starts (or its own end). */
export const overruns = (clips) => clips.filter((c, i) => {
  const next = clips[i + 1];
  return next && c.start + c.seconds > next.start;
});

/** Mix the clips, each delayed to its start, into one opus file (ffmpeg). */
export function mixVoice(clips, out) {
  assertWritable(out);
  const inputs = clips.flatMap((c) => ['-i', c.wav]);
  const filters = clips.map((c, i) => `[${i}:a]adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`);
  filters.push(`${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest[mix]`);
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-c:a', 'libopus', '-b:a', '64k', out]);
}

/** Mux audio tracks into a video with add-audio.sh (video stream copied). Each track is "FILE@SECONDS:VOLUME:FADE". */
export function addAudio(video, tracks, out) {
  assertWritable(out);
  execFileSync(path.join(HERE, 'add-audio.sh'), [video, ...tracks.flatMap((t) => ['--track', t]), '--out', out], { stdio: 'inherit', env: { ...process.env, AUDIO_BITRATE: process.env.AUDIO_BITRATE || '48k' } });
}
