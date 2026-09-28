// #443 slice 4b-iii: fetches the source maps `resolveFiberSelection` needs to map a React 19 `_debugStack`
// frame back to real source (its "stack" tier's ladder step, `packages/engine/previewFiber.mjs`). The
// resolver itself stays pure by that file's own contract — this is the I/O it explicitly hands to its
// caller. A missing or broken map is never a failure here: it comes back absent, and the resolver's own
// ladder falls through to file-only/unmapped exactly as it does today with no map at all.
import { parseStackFrames } from '../../../packages/engine/previewFiber.mjs';

const FETCH_TIMEOUT_MS = 2000;
// Bounds the work per selection regardless of how many frames the stack carries (the resolver's own frame
// cap is separate and larger; this just caps how many distinct URLs are worth a network round trip).
const MAX_URLS = 8;

/** The LAST `sourceMappingURL` comment in `text` (a bundler may emit more than one; the one nearest the
 * end is the one that applies), or `null`. Matches both `//#` and the legacy `/*#` form. */
function sourceMappingUrlOf(text) {
  const re = /(?:\/\/|\/\*)[#@]\s*sourceMappingURL=([^\s*]+)/g;
  let last = null;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m[1];
  return last;
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return res.ok ? res.text() : null;
}

async function mapForUrl(frameUrl) {
  try {
    const js = await fetchText(frameUrl);
    if (!js) return null;
    const ref = sourceMappingUrlOf(js);
    if (!ref) return null;
    if (ref.startsWith('data:')) {
      const b64 = ref.slice(ref.indexOf(',') + 1);
      return { map: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')), url: frameUrl };
    }
    const mapUrl = new URL(ref, frameUrl).toString();
    const mapText = await fetchText(mapUrl);
    return mapText ? { map: JSON.parse(mapText), url: mapUrl } : null;
  } catch {
    return null; // a bad map is a missing map, never a crash
  }
}

/**
 * Fetches the source maps for the frames in a fiber selection's `_debugStack`, restricted to `origin` —
 * the dev server's own address. Containment: a frame URL naming anywhere else is never fetched, even
 * though it came from the page's own stack.
 *
 * @param {object} selection The bridge's `select` payload, or its `.selection`.
 * @param {{ origin: string }} options `origin` must be the dev server's own `http://127.0.0.1:<port>`.
 * @returns {Promise<Record<string, {map: object, url: string}>>} keyed by the exact frame URL, ready as
 *   `resolveFiberSelection`'s `context.sourceMaps`.
 */
export async function fetchSourceMapsForSelection(selection, { origin } = {}) {
  const sel = selection && selection.selection ? selection.selection : selection;
  const stack = sel && typeof sel.stack === 'string' ? sel.stack : '';
  if (!stack || !origin) return {};
  const urls = [...new Set(parseStackFrames(stack).map((f) => f.url))]
    .filter((u) => { try { return new URL(u).origin === origin; } catch { return false; } })
    .slice(0, MAX_URLS);
  const entries = await Promise.all(urls.map(async (u) => [u, await mapForUrl(u)]));
  return Object.fromEntries(entries.filter(([, v]) => v));
}
