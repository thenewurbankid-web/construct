// Helpers for the scripted recordings (docs/MEDIA.md). Pacing and captions only; no product logic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LINE_SVG = fs.readFileSync(path.resolve(HERE, '../../../../docs/brand/line.svg'), 'utf8');

/** The one place pacing happens, so a re-record gives the same video. */
const PACE = Number(process.env.MEDIA_PACE) || 1.5;
export const pause = (page, ms) => page.waitForTimeout(Math.round(ms * PACE));

/** Reading time for a caption: enough for a person to read it once, unhurried (about 14 characters a second, at least 3 s). */
export const readingMs = (text) => Math.round(Math.max(3000, text.length * 70) * (Number(process.env.MEDIA_READ) || 1));

const CAPTION_ID = 'media-caption';

// Voice-first timing: when the script has measured the narration (`node tools/media/script.mjs <slug> timing` writes `dur`, seconds,
// per line), hold each caption for its narration + 0.9 s (never less than the reading time), so the video follows the voice.
let DURATIONS = new Map();
/** Load `dur` values from `<slug>.captions.json` (call once at the start of a test); harmless when the file or `dur` is missing. */
export function loadDurations(file) {
  try {
    DURATIONS = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).filter((l) => l.dur).map((l) => [l.text, l.dur]));
  } catch { DURATIONS = new Map(); }
}
const holdMs = (text) => Math.max(readingMs(text), DURATIONS.has(text) ? Math.round((DURATIONS.get(text) + 0.9) * 1000) : 0);
const BURN = process.env.MEDIA_BURN_CAPTIONS === '1';

// The caption timeline: every caption and card, with seconds from the start of the recording (for the voice-over,
// tools/media/voiceover.mjs). Measured on the wall clock from startTimeline(); nothing on screen changes.
let T0 = Date.now();
let TIMELINE = [];
const stamp = (text) => TIMELINE.push({ text, start: Math.round((Date.now() - T0)) / 1000 });

/** Call first thing in a test: the recording starts when the page is created, a moment before. */
export function startTimeline() { T0 = Date.now(); TIMELINE = []; }

/** Write the timeline as `<slug>.captions.json` ([{ text, start }]) into `dir`. */
export function writeTimeline(fsMod, dir, slug) {
  // The script is hand-edited (say, id, exaggeration, para, dur...): keep those fields and only update `start` of lines with the
  // same text; lines that are new are added, in order.
  const file = path.join(dir, `${slug}.captions.json`);
  let existing = [];
  try { existing = JSON.parse(fsMod.readFileSync(file, 'utf8')); } catch { /* first take */ }
  const out = TIMELINE.map((t) => ({ ...(existing.find((e) => e.text === t.text) || {}), text: t.text, start: t.start }));
  fsMod.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

/** Announce a caption: it goes on the timeline (and so into the narration and the .srt/.vtt) and the recording holds for it.
 * The bar itself is NOT drawn any more, it blocked the UI; subtitles are a separate track. `MEDIA_BURN_CAPTIONS=1` draws the
 * old bar back, for a silent-video export. */
export async function caption(page, text) {
  stamp(text);
  if (BURN) {
    await page.evaluate(([id, text]) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1040px;z-index:2147483646;'
          + 'padding:14px 26px;border-radius:12px;background:rgba(13,15,18,.92);color:#fff;font:600 26px/1.3 system-ui,sans-serif;'
          + 'text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:none';
        document.body.appendChild(el);
      }
      el.textContent = text;
    }, [CAPTION_ID, text]);
  }
  // Hold before the next action, so every scene registers before the screen changes.
  await page.waitForTimeout(holdMs(text));
}

/** A small, short-lived callout: a ring around `locator` and a short label beside it (never over it), for `ms` (default 2.4 s),
 * then removed. For the feature tour: one clear beat per feature. */
export async function highlight(page, locator, label, ms = 2400) {
  const box = await locator.first().boundingBox();
  if (!box) return;
  await page.evaluate(([b, label, ms]) => {
    const ring = document.createElement('div');
    ring.className = 'media-highlight';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = `position:fixed;left:${b.x - 4}px;top:${b.y - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:2px solid #f5a524;`
      + 'border-radius:8px;box-shadow:0 0 0 4px rgba(245,165,36,.25);z-index:2147483645;pointer-events:none;transition:opacity .25s';
    const tag = document.createElement('div');
    tag.className = 'media-highlight';
    tag.setAttribute('aria-hidden', 'true');
    tag.textContent = label;
    const right = b.x + b.width + 12 + 180 < window.innerWidth;
    const top = Math.min(Math.max(b.y, 8), window.innerHeight - 40);
    tag.style.cssText = `position:fixed;top:${top}px;${right ? `left:${b.x + b.width + 12}px` : `right:${Math.max(8, window.innerWidth - b.x + 12)}px`};max-width:200px;`
      + 'padding:5px 10px;border-radius:6px;background:#f5a524;color:#1a1200;font:600 13px/1.3 system-ui,sans-serif;z-index:2147483645;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.body.append(ring, tag);
    setTimeout(() => document.querySelectorAll('.media-highlight').forEach((e) => e.remove()), ms);
  }, [box, label, ms]);
  await page.waitForTimeout(ms);
}

export const clearCaption = (page) => page.evaluate((id) => document.getElementById(id)?.remove(), CAPTION_ID);

/** A full-screen brand card (the Line mark, a title and a subtitle) shown for `ms`, then removed. */
export async function card(page, title, subtitle = '', ms = 5000, said = '') {
  // `said` is what the voice-over says over the card (a greeting or sign-off); hold the card for at least its reading time + 1 s.
  stamp(said || (subtitle ? `${title}. ${subtitle}` : title));
  if (said) ms = Math.max(ms, Math.ceil((holdMs(said) + 1000) / PACE));
  await clearCaption(page);
  await page.evaluate(([svg, title, subtitle]) => {
    const el = document.createElement('div');
    el.id = 'media-card';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'gap:18px;background:#0d0f12;color:#f2f4f7;font-family:system-ui,sans-serif;text-align:center';
    // The same motion as the Cockpit's animated Line mark (ui/client/app/brand.css): the outline pill is traced by a
    // travelling dash, the filled pill breathes. Faster here (3 s) so it reads within a short card.
    const style = '<style>@keyframes m-trace{to{stroke-dashoffset:-69}}@keyframes m-breathe{0%,100%{opacity:.86}50%{opacity:1}}'
      + '#media-card rect[fill="none"]{stroke-dasharray:55 14;animation:m-trace 3s linear infinite}'
      + '#media-card rect:first-of-type{animation:m-breathe 3s ease-in-out infinite}</style>';
    el.innerHTML = style + `<div style="width:160px;height:160px;color:#f2f4f7">${svg.replace('<svg ', '<svg width="160" height="160" ')}</div>`
      + `<div style="font-size:52px;font-weight:700">${title}</div><div style="font-size:26px;color:#b7bfcc;max-width:900px">${subtitle}</div>`;
    document.body.appendChild(el);
  }, [LINE_SVG, title, subtitle]);
  await pause(page, ms);
  await page.evaluate(() => document.getElementById('media-card')?.remove());
}

/** Save the recording as the current `<slug>.webm` and keep every take: the previous current file moves to
 * `history/<slug>-<UTC time>.webm` first, and the new take is also stored there. History is kept until deleted by hand. */
export function saveRecording(fsMod, dir, slug, tmpPath) {
  const stamp = (d) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const history = path.join(dir, 'history');
  fsMod.mkdirSync(history, { recursive: true });
  const current = path.join(dir, `${slug}.webm`);
  if (fsMod.existsSync(current)) {
    const prev = path.join(history, `${slug}-${stamp(fsMod.statSync(current).mtime)}.webm`);
    if (!fsMod.existsSync(prev)) fsMod.copyFileSync(current, prev);
  }
  fsMod.copyFileSync(tmpPath, current);
  fsMod.copyFileSync(tmpPath, path.join(history, `${slug}-${stamp(new Date())}.webm`));
}

/**
 * Show the pointer in the recording: Playwright's video has no cursor, so draw one in the page. A soft highlight ring
 * follows the mouse and pulses on every click. Call once per page before `goto` (it survives navigations).
 * `glide` moves the pointer to an element in a few steps first, so viewers see where a click is about to land.
 */
export async function installCursor(page) {
  await page.addInitScript(() => {
    const boot = () => {
      if (document.getElementById('media-cursor')) return;
      const style = document.createElement('style');
      style.textContent = '#media-cursor{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;'
        + 'border:3px solid #6c97ff;background:rgba(108,151,255,.22);box-shadow:0 0 0 4px rgba(108,151,255,.18),0 2px 10px rgba(0,0,0,.35);'
        + 'z-index:2147483647;pointer-events:none;transition:transform .12s ease,background .12s ease}'
        + '#media-cursor.down{transform:scale(.72);background:rgba(108,151,255,.5)}'
        + '.media-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #6c97ff;'
        + 'z-index:2147483646;pointer-events:none;animation:media-ripple .6s ease-out forwards}'
        + '@keyframes media-ripple{to{transform:scale(2.6);opacity:0}}';
      document.head.appendChild(style);
      const dot = document.createElement('div');
      dot.id = 'media-cursor';
      dot.setAttribute('aria-hidden', 'true');
      document.body.appendChild(dot);
      const place = (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; };
      addEventListener('mousemove', place, true);
      addEventListener('mousedown', (e) => {
        place(e); dot.classList.add('down');
        const r = document.createElement('div'); r.className = 'media-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
        document.body.appendChild(r); setTimeout(() => r.remove(), 700);
      }, true);
      addEventListener('mouseup', () => dot.classList.remove('down'), true);
    };
    if (document.body) boot(); else addEventListener('DOMContentLoaded', boot);
  });
}

/** Move the pointer to the centre of `locator` in a few steps, so the viewer sees it travel before the click. */
export async function glide(page, locator, steps = 18) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(250);
}
