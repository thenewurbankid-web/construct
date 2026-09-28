// #387 (design docs/design/ia-five-screens.md 9.6, "Preferred: AI proposes the parse pattern once") -- for a PUBLIC
// page (mode c, `StoryApi.fetch` strategy 'server'), the one-time pattern-proposal call sends the model a stripped
// copy of the page: scripts, styles and every attribute removed, capped at 64 KB. This is the public-page sibling
// of `storySkeleton.mjs` (login-only pages, tags kept, text truncated to 40 characters, at most 32 KB) -- a public
// page's own text is not secret the way a logged-in page's is, so the cap is generous and text is not truncated
// per-node, but scripts/styles/attributes are stripped the same way: nothing executable, no `href`/`src`/form
// value ever reaches the model.
import { parseHTML } from 'linkedom';

/** Design 9.6: "64 KB cap". */
export const MAX_STRIPPED_BYTES = 64 * 1024;

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Reduce `html` to plain text with scripts, styles and every attribute removed, capped at `maxBytes`. The result is
 * whitespace-collapsed running text (not a tag tree -- unlike `buildSkeleton`, this is meant to be read as prose by
 * the model proposing selectors, not walked as structure), truncated (never silently over budget) with a note when
 * it was cut.
 *
 * @param {string} html
 * @param {{ maxBytes?:number }} [opts]
 * @returns {{ ok:true, text:string, truncated:boolean, bytes:number } | { ok:false, code:string, message:string }}
 *
 * @example
 * buildStrippedText('<script>evil()</script><h1>Title</h1>').text; // => 'Title'
 */
export function buildStrippedText(html, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_STRIPPED_BYTES;
  if (typeof html !== 'string') return { ok: false, code: 'BAD_HTML', message: 'html must be a string.' };

  let document;
  try {
    ({ document } = parseHTML(html));
  } catch (e) {
    return { ok: false, code: 'PARSE_FAILED', message: `Could not parse HTML: ${String(e?.message || e).slice(0, 200)}` };
  }

  const parts = [];
  function walk(node) {
    if (node.nodeType === TEXT_NODE) { parts.push(node.textContent); return; }
    if (node.nodeType !== ELEMENT_NODE) return;
    if (SKIP_TAGS.has(node.tagName.toLowerCase())) return;
    for (const child of node.childNodes) walk(child);
  }
  // See storySkeleton.mjs's comment: walk from the Document node so a fragment with several top-level siblings
  // (no wrapping <html>) is not silently reduced to just its first element.
  for (const child of document.childNodes) walk(child);

  const collapsed = parts.join(' ').replace(/\s+/g, ' ').trim();
  const bytesOf = (s) => Buffer.byteLength(s, 'utf8');
  const truncated = bytesOf(collapsed) > maxBytes;
  let text = collapsed;
  if (truncated) {
    // Cut on a character boundary that is also a valid utf8 boundary: binary-search the largest prefix whose
    // byte length fits, rather than a fixed slice that could split a multi-byte character.
    let lo = 0;
    let hi = collapsed.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (bytesOf(collapsed.slice(0, mid)) <= maxBytes) lo = mid; else hi = mid - 1;
    }
    text = collapsed.slice(0, lo);
  }
  const suffix = truncated ? `\n… (truncated at ${maxBytes} bytes)` : '';
  return { ok: true, text: text + suffix, truncated, bytes: bytesOf(text + suffix) };
}
