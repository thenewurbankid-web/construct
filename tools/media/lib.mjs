// Shared, model-free pieces of the media tools: the caption script (data model), subtitles, the clip cache key and the
// write guard. The script is `site/assets/video/<slug>.captions.json`, [{ id, text, start, end? }] in seconds from the
// start of the video, and is meant to be edited by hand or with `node tools/media/script.mjs <slug>`.
// Subtitle text is produced by the `subtitle` package (MIT); ffmpeg does all audio and video work.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifySync } from 'subtitle';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const VIDEO_DIR = path.join(REPO, 'site', 'assets', 'video');
/** Generated clips, one per (text, voice, model); git-ignored. */
export const CLIP_CACHE = path.join(REPO, '.media-cache');

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const MUSIC_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'opus', 'flac'];

/** Reading time for a caption in seconds, the same rule the recording uses (about 14 characters a second, at least 3 s). */
export const readingSeconds = (text) => Math.max(3, text.length * 0.07);

/** Fill ids and ends so every line is complete: id `l01`.. when missing; end = the next start (minus 0.1 s), capped at the
 * reading time; the last line gets its reading time. Never mutates the input; throws on bad input. */
export function normalize(lines) {
  if (!Array.isArray(lines)) throw new Error('the script must be a JSON array of { text, start }');
  const seen = new Set();
  const out = lines.map((l, i) => {
    if (!l || typeof l.text !== 'string' || !l.text.trim()) throw new Error(`line ${i + 1}: text is required`);
    const start = Number(l.start);
    if (!Number.isFinite(start) || start < 0) throw new Error(`line ${i + 1}: start must be seconds >= 0`);
    let id = typeof l.id === 'string' && /^[\w-]{1,40}$/.test(l.id) ? l.id : `l${String(i + 1).padStart(2, '0')}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const end = l.end === undefined || l.end === null || l.end === '' ? undefined : Number(l.end);
    if (end !== undefined && !(end > start)) throw new Error(`line ${i + 1}: end must be after start`);
    return { id, text: l.text.trim(), start, ...(end !== undefined ? { end } : {}) };
  });
  return out.map((l, i) => {
    if (l.end !== undefined) return l;
    const next = out[i + 1];
    const cap = l.start + readingSeconds(l.text);
    return { ...l, end: Math.round((next ? Math.min(cap, next.start - 0.1) : cap) * 1000) / 1000 };
  });
}

const cues = (lines) => normalize(lines).map((l) => ({ type: 'cue', data: { start: Math.round(l.start * 1000), end: Math.round(l.end * 1000), text: l.text } }));
/** SubRip text for the script. */
export const toSrt = (lines) => stringifySync(cues(lines), { format: 'SRT' });
/** WebVTT text for the script. */
export const toVtt = (lines) => stringifySync(cues(lines), { format: 'WebVTT' });

/** Cache key of one clip: changes when the text, the voice (a stock voice id or a hash of the supplied sample), the model
 * or the speed changes, so only edited lines are generated again. */
export function clipKey({ text, voice, model, speed = 1 }) {
  return crypto.createHash('sha256').update(JSON.stringify([text.trim(), voice, model, speed])).digest('hex').slice(0, 24);
}

/** Fingerprint of a voice sample for the cache key. Only a hash is kept; the sample itself is never copied. */
export const sampleFingerprint = (file) => 'sample:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

/** Throw unless `p` lies inside site/assets/video or the clip cache. Every write goes through this. */
export function assertWritable(p) {
  const abs = path.resolve(p);
  const ok = [VIDEO_DIR, CLIP_CACHE].some((d) => abs === d || abs.startsWith(d + path.sep));
  if (!ok) throw new Error(`refusing to write outside ${VIDEO_DIR} and ${CLIP_CACHE}: ${abs}`);
  return abs;
}

/** Paths of a video's files. */
export function paths(slug, dir = VIDEO_DIR) {
  if (!SLUG_RE.test(slug)) throw new Error(`bad slug "${slug}"`);
  const b = path.join(dir, slug);
  return { script: `${b}.captions.json`, srt: `${b}.en.srt`, vtt: `${b}.en.vtt`, voice: `${b}.voice.opus`, video: `${b}.webm`, voiced: `${b}.voice.webm`, mixed: `${b}.mixed.webm`, musicBase: `${b}.music` };
}

/** The music file the owner dropped next to the video (`<slug>.music.<ext>`), or null. */
export const findMusic = (slug, dir = VIDEO_DIR) => {
  const { musicBase } = paths(slug, dir);
  const ext = MUSIC_EXT.find((e) => fs.existsSync(`${musicBase}.${e}`));
  return ext ? `${musicBase}.${ext}` : null;
};
