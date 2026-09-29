// #387 (design docs/design/ia-five-screens.md 9.6, last bullet) -- the structure-only skeleton a login-only page is
// reduced to before "AI proposes a pattern" ever sees it: tag/id/class/data-testid tree, text truncated to 40
// characters, no other attribute values, no href, no form values, no scripts, at most 32 KB. The user sees this
// exact text before it is sent (`ia-clip-bridge`) -- there is no whole-page mode.
//
// This module is the server-side, linkedom-backed reference implementation and the one under test; the userscript
// bridge (#386, `construct-clipper.user.js`) builds the same skeleton natively (native DOM, no libraries) when a
// login-only page has no parse pattern yet and the user picks "AI proposes a pattern" -- porting this exact
// algorithm into the userscript is tracked separately so the two never silently drift.
import { parseHTML } from 'linkedom';

/** Design 9.6: "at most 32 KB". */
export const MAX_SKELETON_BYTES = 32 * 1024;
/** Design 9.6: "text truncated to 40 characters". */
export const MAX_TEXT_LEN = 40;

// A script/style/etc. never contributes a line, a tag name or its text -- the skeleton must be safe to hand to a
// model with zero risk of carrying executable content or non-visible page machinery.
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** A node's own text (direct text-node children only, not descendants' -- each element's own line carries only its
 * own text; a descendant's text is that descendant's own line). */
function ownText(el) {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeType === TEXT_NODE) out += child.textContent;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `tag#id.class1.class2[data-testid=x] "truncated text…"` -- the only attribute VALUES ever shown are id, class
 * and data-testid (named explicitly in design 9.6); every other attribute (href, form values, everything else) is
 * omitted entirely, not just its value. */
function describeNode(el, maxTextLen) {
  let desc = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) desc += `#${id}`;
  const cls = el.getAttribute('class');
  if (cls) desc += cls.trim().split(/\s+/).filter(Boolean).map((c) => `.${c}`).join('');
  const testId = el.getAttribute('data-testid');
  if (testId) desc += `[data-testid=${testId}]`;
  const text = ownText(el);
  if (text) {
    const truncated = text.length > maxTextLen;
    desc += ` "${text.slice(0, maxTextLen)}${truncated ? '…' : ''}"`;
  }
  return desc;
}

/**
 * Reduce `html` to the structure-only skeleton design 9.6 sends a login-only page's model call: one line per
 * element (indented by depth), `tag#id.class[data-testid=x] "text"`, capped at `maxBytes`. Never throws; a
 * malformed document is parsed as far as linkedom's HTML5 recovery gets, same guarantee `storyExtract.mjs` gives.
 *
 * @param {string} html
 * @param {{ maxBytes?:number, maxTextLen?:number }} [opts]
 * @returns {{ ok:true, text:string, truncated:boolean, bytes:number } | { ok:false, code:string, message:string }}
 *
 * @example
 * buildSkeleton('<h1 data-testid="t">Hi</h1>').text; // => 'html\n  head\n  body\n    h1[data-testid=t] "Hi"'
 */
export function buildSkeleton(html, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_SKELETON_BYTES;
  const maxTextLen = opts.maxTextLen ?? MAX_TEXT_LEN;
  if (typeof html !== 'string') return { ok: false, code: 'BAD_HTML', message: 'html must be a string.' };

  let document;
  try {
    ({ document } = parseHTML(html));
  } catch (e) {
    return { ok: false, code: 'PARSE_FAILED', message: `Could not parse HTML: ${String(e?.message || e).slice(0, 200)}` };
  }

  const lines = [];
  let truncated = false;
  let bytes = 0;

  function walk(el, depth) {
    if (truncated || el.nodeType !== ELEMENT_NODE) return;
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return;
    const line = `${'  '.repeat(depth)}${describeNode(el, maxTextLen)}`;
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8');
    if (bytes + lineBytes > maxBytes) { truncated = true; return; }
    lines.push(line);
    bytes += lineBytes;
    for (const child of el.children) walk(child, depth + 1);
  }

  // Walk from the Document node, not `documentElement`: a fragment with no wrapping <html> (or several top-level
  // siblings) only keeps its FIRST top-level element as `documentElement` in linkedom -- everything after it would
  // be silently dropped. `document.childNodes` sees every top-level node either way.
  // Array.from, not a direct for..of: this tsconfig has no "DOM"/"DOM.Iterable" lib, so linkedom's
  // NodeListOf type has no Symbol.iterator here even though the runtime value is iterable.
  for (const child of Array.from(document.childNodes)) walk(child, 0);
  const text = truncated ? `${lines.join('\n')}\n… (truncated at ${maxBytes} bytes)` : lines.join('\n');
  return { ok: true, text, truncated, bytes: Buffer.byteLength(text, 'utf8') };
}
