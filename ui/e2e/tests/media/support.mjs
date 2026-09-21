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

/** Show `text` as a high-contrast caption bar at the bottom of the page until replaced or cleared. */
export async function caption(page, text) {
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
  // Hold on the caption before the next action, so every scene registers before the screen changes.
  await page.waitForTimeout(readingMs(text));
}

export const clearCaption = (page) => page.evaluate((id) => document.getElementById(id)?.remove(), CAPTION_ID);

/** A full-screen brand card (the Line mark, a title and a subtitle) shown for `ms`, then removed. */
export async function card(page, title, subtitle = '', ms = 5000) {
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
