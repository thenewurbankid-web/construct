#!/usr/bin/env node
// The narration script of a video, as plain files you can edit with any text editor, and the tracks built from it.
//
//   node tools/media/script.mjs <slug> build   # srt + vtt + voice + muxed variants (whatever the files allow)
//   node tools/media/script.mjs <slug> srt     # site/assets/video/<slug>.en.srt   (no model)
//   node tools/media/script.mjs <slug> vtt     # site/assets/video/<slug>.en.vtt   (no model)
//   node tools/media/script.mjs <slug> voice   # <slug>.voice.opus, the narration alone (+ <slug>.voice.webm if the video exists)
//   node tools/media/script.mjs <slug> mix     # <slug>.mixed.webm: narration + <slug>.music.<ext> under the video
//   node tools/media/script.mjs <slug> status  # which lines are cached, which would be generated
//
// Options: --voice af_heart | --voice-sample <wav of your own voice> | --speed 0.95 | --music-volume 0.25 | --music-start 0
//
// Source of truth: site/assets/video/<slug>.captions.json, [{ "id", "text", "start", "end"? }], seconds from the video
// start; edit it by hand. Separate tracks stay separate files: <slug>.voice.opus (narration), <slug>.music.<mp3|wav|ogg|m4a|opus|flac>
// (music the owner supplies and has the right to publish; nothing here generates or downloads music), <slug>.en.srt/.vtt.
// Generated clips are cached per line in .media-cache/ (git-ignored) by a hash of text + voice + model, so only edited
// lines are spoken again. Writes stay inside site/assets/video and .media-cache. Needs ffmpeg (or FFMPEG=/path/to/ffmpeg).
import fs from 'node:fs';
import { VIDEO_DIR, assertWritable, findMusic, normalize, paths, toSrt, toVtt } from './lib.mjs';
import { addAudio, mixVoice, overruns, plan, synthesize } from './synth.mjs';

const args = process.argv.slice(2);
const OPTS_WITH_VALUE = ['--voice', '--voice-sample', '--speed', '--music-volume', '--music-start'];
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [slug, cmd = 'build'] = args.filter((a, i) => !a.startsWith('--') && !OPTS_WITH_VALUE.includes(args[i - 1]));
const fail = (m) => { console.error(m); process.exit(1); };
if (!slug || !['build', 'srt', 'vtt', 'voice', 'mix', 'status'].includes(cmd)) fail('usage: script.mjs <slug> build|srt|vtt|voice|mix|status  (see the header of this file)');

try {
  const P = paths(slug);
  if (!fs.existsSync(P.script)) fail(`no script at ${P.script}`);
  const lines = normalize(JSON.parse(fs.readFileSync(P.script, 'utf8')));
  const opts = { voice: flag('--voice', 'af_heart'), sample: flag('--voice-sample'), speed: Number(flag('--speed', 0.95)) };
  const write = (file, text) => { fs.writeFileSync(assertWritable(file), text); console.log(`wrote ${file}`); };

  const doSubs = (which) => {
    if (which !== 'vtt') write(P.srt, toSrt(lines));
    if (which !== 'srt') write(P.vtt, toVtt(lines));
  };
  const doVoice = async () => {
    const clips = await synthesize(lines, opts, (m) => console.log(m));
    clips.forEach((c, i) => {
      const next = clips[i + 1];
      if (next && c.start + c.seconds > next.start) console.warn(`warning: "${c.text.slice(0, 40)}" runs ${(c.start + c.seconds - next.start).toFixed(1)} s into the next line; move the next start later or shorten the text`);
    });
    mixVoice(clips, P.voice);
    console.log(`wrote ${P.voice} (${clips.length} lines, ${clips.filter((c) => !c.cached).length} generated, ${clips.filter((c) => c.cached).length} from cache)`);
    if (fs.existsSync(P.video)) addAudio(P.video, [`${P.voice}@0:1:0.05`], P.voiced);
  };
  const doMix = () => {
    const music = findMusic(slug);
    if (!music) fail(`no music file: drop one next to the video as ${VIDEO_DIR}/${slug}.music.<mp3|wav|ogg|m4a|opus|flac>`);
    if (!fs.existsSync(P.voice)) fail(`no narration yet: run "script.mjs ${slug} voice" first`);
    if (!fs.existsSync(P.video)) fail(`no video at ${P.video}`);
    addAudio(P.video, [`${P.voice}@0:1:0.05`, `${music}@${flag('--music-start', 0)}:${flag('--music-volume', 0.25)}:1.5`], P.mixed);
  };

  if (cmd === 'srt' || cmd === 'vtt') doSubs(cmd);
  else if (cmd === 'status') for (const l of plan(lines, opts)) console.log(`${l.cached ? 'cached ' : 'missing'}  ${String(l.start).padStart(7)} s  ${l.text.slice(0, 60)}`);
  else if (cmd === 'voice') await doVoice();
  else if (cmd === 'mix') doMix();
  else { doSubs(); await doVoice(); if (findMusic(slug)) doMix(); }
} catch (e) {
  fail(e.message);
}
