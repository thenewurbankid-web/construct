# Media: user-guide videos (module 10)

Short, real, screen-recorded guides for the documentation website. Owned by the `media` agent
(`.claude/agents/media.md`). Every video is a real Playwright run; the script is the source of truth.

## The series (plan)

**Rule: every episode is built in parts of 1-2 minutes.** Each part has its own script (`<episode>-<part>-<slug>.captions.json`),
narration, subtitles, music and download; it starts from a checkpoint (a saved copy or commit of the sample project made at the end of
the previous part, restored deterministically) so any part re-records alone in minutes; subtitles are a separate track (`.vtt`/`.srt`,
never a burned-in bar); the site lists the parts as chapters of the episode's landing page. The helpers (`support.mjs`, `saveRecording`,
`script.mjs`, `voice-lab.mjs`) take the `<episode>-<part>-<slug>` name as their slug and need no change for later episodes.

| Episode | Parts |
|---|---|
| 1 Build a feature, start to finish (wishlist) | 1a Meet the page (sign in, open the project, a static React page that looks like a product and does nothing, Features/Pages/Components, Construct shows the missing prop link) / 1b Plan the change (Note, impact, plan steps, Mechanical or AI, model settings) / 1c Generate the logic (the model fills the layers, props get wired, the page comes alive full screen) / 1d Workflows and checks (diagram, edit, diff, rules, tests, git) / 1e Wrap-up (the finished app, what Construct did without an LLM, what is next) |
| 2 Plan a change and approve it | 2a A Note and the plan / 2b Impact and run / 2c Approve one file |
| 3 Bring in an existing feature | 3a The import wizard / 3b Review the diff / 3c Validate |
| 4 Clone a project | 4a Paste a link and clone / 4b Open it and look around |
| 5 Review a branch and run a test | 5a The Git screen findings / 5b Run a generated test |

State of the series: episode 1 exists as ONE 3.75 min recording (the pre-parts take, captions burned in); splitting it into parts, the
static-React example page and the feature tour are planned and not built yet (see the report of #462). Nothing else is recorded.

## Episode 1 storyboard (captions are the script; v2, one continuous example: a wishlist for the sample shop)

Slug `01-ticket-to-story` (kept so the site path does not change); title "Build a feature, start to finish". The
captions live in `CAPTIONS` in `ui/e2e/tests/media/01-ticket-to-story.spec.js` and are listed on the site page
`site/content/user/videos/ticket-to-story.md`. Scenes, each asserted on screen by the spec:

1. Intro card. 2. Sign in (demo login, said in the caption). 3. Open the sample shop from the gate.
4. Features: catalog, cart, checkout. 5. Settings: `createFill` = ollama; `planAnalysis` offers no local model; Save.
6. Notes: the ticket typed, "Which parts?" proposal confirmed, impact (no model), suggested read step.
7. Plan: add `create.feature`, add `create.layer` tagged Local model; the plan says a model will be used.
8. Features > Create: the feature (mechanical, 0 calls), then a slice (domain, component, page, controller) with the local-model box
   ticked (4 calls, via "ollama").
9. Pages: the new `WishlistPage.tsx` and its node tree. The spec writes one route file, `app/wishlist/page.tsx`
   (captioned as hand-written), then 10. Preview URL = the running shop's `/wishlist`, Full screen, add two products,
   remove one, remove the last (empty state), leave full screen; each state asserted.
11. Workflows: checkout machine, add `rejected --START_OVER--> idle`, read the diff, Confirm save.
12. Status bar validate, Diagnostics: no errors, two real warnings on the new feature (READ-003, SLICE-003).
13. Outro card.

Mock vs real: the app, the CLI, the server, the git repo, the running Next app are real. Mock, and captioned: the demo
login (GitHub OAuth cannot be automated) and the local model (`tests/media/mockOllama.mjs`, a stand-in on Ollama's port
that answers with fixed, small but working code per layer so a re-record is identical; the generated wishlist really runs). No model is installed on the recording machine and none is
downloaded for a recording. To record with a real model later: run `ollama serve`, pull a small model, drop the stand-in.

Known gaps (not faked; the video stops before them): plan-run approval of created files (#470), a model choice per
capability and per block, and a reviewable diff for the Create form's model output (#471, plus #382 and #407).
Tests and Git screens are not in the video (they add a second story); episode 5.

Re-record: `MEDIA_DRY=1` records without saving (dev). `MEDIA_READ` and `MEDIA_PACE` scale the reading holds and the
scripted pauses (both 1 and 1.5 for the published take). The sample shop needs a `node_modules` to run: give the
spec `E2E_SHOP_MODULES=/path/to/shop/node_modules` (hard-linked into the copy) or it runs `npm ci` in the copy;
`E2E_APP_PORT` (default 5820) is the shop's dev server, started and killed by the spec. The raw take is about 13 MB; re-encode
before saving to stay under 10 MB: `ffmpeg -i take.webm -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -an small.webm`, then
`saveRecording` (keeps history, until the owner deletes it).

## Recording protocol

- No caption bar is drawn: it blocked the UI. `caption(page, text)` only puts the line on the timeline (narration, `.srt`/`.vtt`) and holds; `MEDIA_BURN_CAPTIONS=1` draws the old bar for a silent export. Cards keep their title text.
- `highlight(page, locator, label)` draws a small ring and a short label beside (never over) an element for about 2.4 s; one beat per feature.
- Voice-first timing: `node tools/media/script.mjs <slug> timing` writes each line's narration length as `dur` into the script; the spec (`loadDurations`) then holds every caption for `dur + 0.9 s` (at least the reading time), so the video follows the voice. `writeTimeline` keeps the hand-edited fields (`say`, `dur`, `para`, ...) and only updates `start`.

- Spec in `ui/e2e/tests/media/<nn>-<slug>.spec.js`, own config `ui/e2e/playwright.media.config.js`
  (`video: 'on'`, 1280x720, own ports, workspace = a temp dir, no project preloaded).
- Helpers in `ui/e2e/tests/media/support.mjs`: `caption(page, text)`, `pause(page, ms)`, `card(page, title, subtitle)`.
- Output: `site/assets/video/<nn>-<slug>.webm` (+ `.mp4`, `.jpg` poster), and a page
  `site/content/user/videos/<slug>.md` with a native `<video controls poster>` and the storyboard as text.
- Run: `tools/dev/heavy.sh npx playwright test -c playwright.media.config.js --workers=1`.

## Adding audio (music, voice-over)

Recordings are silent. To add sound, record or pick a track and mix it in; the video is copied untouched:

```
tools/media/add-audio.sh site/assets/video/01-ticket-to-story.webm \
  --track music.mp3 --track voice.wav@4 --volume 0.35 --fade 2
```

`--track FILE@SECONDS` starts a track at that second (repeat for several); `--volume` and `--fade` apply to all
tracks; output is `<video>.audio.webm` next to the input (or `--out`), never overwriting the original. Needs
ffmpeg on the PATH (or `FFMPEG=/path/to/ffmpeg`). Use only music you have the right to publish. Use the
`.audio.webm` in the site page's `@video/` reference when you are happy with it. Pace: `MEDIA_PACE=1.5` (default)
scales every scripted pause; captions hold for their reading time.

## Script, subtitles and narration (local, free, no LLM) — #462

The narration script is a plain file, the source of truth: `site/assets/video/<slug>.captions.json`, `[{ id, text, start, end? }]`
(seconds from the video start; edit it in any text editor). A new recording writes it itself (`writeTimeline` in `support.mjs`); for
a take made before that, `node tools/media/captions-from-video.mjs <video.webm> <spec.js>` rebuilds it from the video's caption bar
(deterministic, refuses to write if the counts differ). One command builds everything from the script:

```
node tools/media/script.mjs <slug> build     # .en.srt + .en.vtt + .voice.opus + .voice.webm (+ .mixed.webm if a music file exists)
node tools/media/script.mjs <slug> srt|vtt|voice|mix|status
node tools/media/script.mjs <slug> voice --voice-sample ~/voice/sample.wav   # own-voice clone; default is Kokoro af_heart
```

Tracks stay separate files next to the video: `<slug>.voice.opus` (narration), `<slug>.music.<mp3|wav|ogg|m4a|opus|flac>` (music you
supply and may publish; drop it there, nothing generates or downloads music), `<slug>.en.srt`/`.vtt`; the muxed `.voice.webm` and
`.mixed.webm` are built from them with `add-audio.sh` (`--track FILE@SECONDS:VOLUME:FADE`; `mix` takes `--music-volume` and `--music-start`).
Clips are cached per line in `.media-cache/` (ignored by version control) by a hash of text, voice and model, so only edited lines are
spoken again (`status` shows which). Writes are refused outside `site/assets/video` and `.media-cache`. Needs ffmpeg (or `FFMPEG=/path/to/ffmpeg`).
The site page adds the subtitles `<track>` and the narrated download when those files exist. The narration is synthetic; the page says so.
`tools/media/voiceover.mjs <captions.json> [--voice] [--voice-sample] [--video]` is the same engine for an arbitrary file; `--list-voices` lists the Kokoro stock voices.

For a visual multi-track timeline, import the separate files (voice.opus, music, .srt/.vtt, captions.json) into any free editor: OpenReel or
OpenCut (both MIT, in the browser) or Kdenlive or Shotcut (free desktop editors, GPL, used as separate tools only, never linked into our code).
They are not part of Construct; there is nothing for us to build or host.

Tools used (owner rule: existing free tools): `subtitle` (MIT, SRT/WebVTT text; devDependency), ffmpeg (audio and video), Kokoro
(Apache-2.0, default voice), Chatterbox (MIT code and weights, own-voice clone; OpenVoice v2, also MIT, was not needed once Chatterbox
worked), faster-whisper `base.en` (MIT, only to check that a clone round-trips to the right words).

### Voice cloning setup (once, outside the repo)

Only from a recording its speaker supplied of their own voice; never another person's voice. The sample is read where it is and never
copied, uploaded or turned into a stored voice file (the cache key holds only a hash of it). Each clip carries Chatterbox's inaudible
Perth watermark. About 1.5 GB venv (about 3 GB of model weights in the Hugging Face cache), about 5 GB peak RAM (run nothing else
heavy meanwhile; wrap in `tools/dev/heavy.sh`), roughly 4 to 7 s of CPU compute per second of speech:

```
UV=~/.cache/construct-media/bin/uv; V=~/.cache/construct-media/venv
$UV venv --python 3.11 $V
$UV pip install --python $V/bin/python chatterbox-tts     # pulls a CUDA torch; replace it with the CPU build:
$UV pip install --python $V/bin/python --reinstall-package torch --reinstall-package torchaudio torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
```

Kokoro setup (default voice): `mkdir -p ~/.cache/construct-media && cd ~/.cache/construct-media && npm init -y && npm i kokoro-js`
(`CONSTRUCT_MEDIA_CACHE` moves the folder). The clone helper is `tools/media/clone_voice.py`, run with the venv's Python.

## Visible pointer

Recordings draw a highlighted pointer (ring that follows the mouse and pulses on click): `installCursor(page)` before `goto`, and `glide(page, locator)` to travel to an element before clicking it. Episode 1 has it from the next re-record.

### Expression, pacing and paralinguistics (own-voice clone)

Settings live in `<slug>.voice.json` (script-wide defaults; flags win) and per line in `captions.json` (`exaggeration`, `cfg_weight`,
`pause_ms`, `para`; `say` is the spoken wording, `text` stays the subtitle). Chatterbox exaggeration raises emotion, a lower `cfg_weight`
slows and loosens the pacing; every line is spoken sentence by sentence, joined with a `pause_ms` pause (default 280, episode 1 uses
650), trimmed of leading/trailing silence and levelled to -20 LUFS. `--tempo 0.9` slows the speech afterwards without re-speaking.
Episode 1 uses exaggeration 0.7 / cfg 0.3, the greeting and sign-off 0.8 / 0.3 with a 450 ms pause, and the best reference window.

Measured on 7 lines (`tools/media/voice-lab.mjs`; scores from `eval_voice.py`; similarity = Resemblyzer cosine to the real sample, WER =
faster-whisper `base.en`, F0 std = pitch spread in semitones, the real sample is 1.89):

| Variant | Similarity | WER | F0 std |
|---|---|---|---|
| default (0.5 / 0.5, whole sample) | 0.820 | 0.9% | 4.31 |
| expressive (0.7 / 0.3, whole sample) | 0.786 | 4.5% | 5.77 |
| best-ref (0.5 / 0.5, best 10-20 s window) | 0.862 | 1.8% | 2.01 |
| expressive-best-ref (0.7 / 0.3, best window) | 0.849 | 5.4% | 2.62 |
| turbo-best-ref (Chatterbox-Turbo, MIT weights) | 0.846 | 5.4% | 2.70 |

The best window (`tools/media/pick_reference.py`: silero-vad segments, F0 spread and loudness dynamics, clipping penalty) is what
raised similarity most (+0.04); more exaggeration adds expression at a small similarity cost. Episode 1 takes expressive-best-ref (WER under
6%). Chatterbox-Turbo (MIT code and weights, about 3 GB, similar speed here) understands `[chuckle]` style tags and scores the same; it is a
`--model turbo` switch, not the default. The comparison clips are `site/assets/video/voice-tests/<variant>--<line>.ogg` with a
`manifest.json` (variants, scores, progress) that Trinity Studio's voice lab reads; `script.mjs <slug> apply-feedback` turns the owner's
`~/voice/voice-feedback.json` (pick and tags per line) into per-line overrides, from a fixed base so it is repeatable.

Paralinguistics are subtle and deterministic (`para`, proposed by a fixed-seed placer, `--no-para` turns them off): a quiet breath before the
greeting and before roughly every 3rd-4th long non-technical line, never two lines in a row, at most one `chuckle_after` (spoken only by a
model with tags, i.e. `--model turbo`; the default model skips it). Breaths are a 220 ms snippet cut from the speaker's own sample
(`extract_breath.py`, kept outside the repo), mixed at -22 dB with 30 ms fades; nothing is downloaded. Explicit `para` in the script
(even `[]`) wins over the placer. If in doubt, fewer.

### Plug in another voice model (`--tts-cmd`)

`--tts-cmd "<command>"` (or `"ttsCmd"` in `<slug>.voice.json`) replaces the built-in backends, so a fine-tuned model trained elsewhere drops in:

1. The command is run once per line through `sh -c`; `{text_file}` is a UTF-8 text file with the spoken text, `{out}` is where it must write a wav (or ogg), `{voice_ref}` is the reference sample or excerpt (optional to use).
2. Exit code 0 means success; anything else stops the build. Output on stdout/stderr is shown.
3. Every clip is then trimmed and levelled to -20 LUFS the same way as the built-in voices, so backends are interchangeable.
4. The command string is part of the clip cache key: a new model or new flags re-speak every line, unchanged lines are reused otherwise.
5. Chatterbox (`--voice-sample`) and Kokoro (`--voice`) stay built in and are the fallback.

### Music and mixing

`node tools/media/make-music.mjs <slug> [--key 1] [--seconds 150]` generates a gentle instrumental bed with ffmpeg only (sine-partial chords,
low-pass, tremolo, chorus, echo; deterministic per key; nothing downloaded). `script.mjs <slug> mix` writes `<slug>.mixed.webm`: video copied,
narration plus music, the music at -14 dB while a card is on screen and -28 dB otherwise, ducked further under the voice with ffmpeg
`sidechaincompress`, 1.5 s fades. The exact ffmpeg command is printed by `mix`.
