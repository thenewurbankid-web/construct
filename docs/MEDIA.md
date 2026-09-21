# Media: user-guide videos (module 10)

Short, real, screen-recorded guides for the documentation website. Owned by the `media` agent
(`.claude/agents/media.md`). Every video is a real Playwright run; the script is the source of truth.

## The series (plan)

| # | Title | Length | Shows |
|---|---|---|---|
| 1 | **Build a feature, start to finish** | about 3.75 min | One continuous example on the sample shop: sign in, models in Settings, ticket, impact, plan, create the feature, local-model fill, Pages, full-screen running app, workflow edit, validate |
| 2 | Plan a change and approve it | 60 s | A Note, the plan, the impact, run, approve one file |
| 3 | Bring in an existing feature | 60 s | Import wizard, review the diff, validate |
| 4 | Clone a project | 45 s | Paste a link, clone, open |
| 5 | Review a branch and run a test | 60 s | Git screen findings, run a generated test |

Only episode 1 is built for now.

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
