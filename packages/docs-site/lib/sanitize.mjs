// Sanitizer for the HTML the docs site renders from markdown (and for HTML that comes back from GitHub's markdown
// renderer). #421: the primary layer is `sanitize-html` (MIT), a real HTML parser with an explicit allowlist, because
// regular-expression sanitizers are routinely bypassed (malformed tags, mXSS, unclosed elements). The old regex pass stays
// as a second, cheap layer over the parser's output. The site is static, so this has no runtime footprint.
//
// The allowlist is what the site's pages actually contain: what `marked` (GFM) emits, plus the markup markdown.mjs adds
// itself (heading ids and anchors, lazy images, the <figure><video> block). Anything else is dropped, text kept.
import sanitize from 'sanitize-html';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'em', 'strong', 'del', 's', 'kbd', 'sup', 'sub',
  'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'details', 'summary',
  'figure', 'figcaption', 'video', 'audio', 'source', 'track', 'input',
];

const ALLOWED_ATTRIBUTES = {
  a: ['href', 'class', 'rel', 'download', 'aria-label', 'id', 'title'],
  img: ['src', 'alt', 'title', 'loading', 'decoding', 'width', 'height', 'class'],
  h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
  th: ['align', 'colspan', 'rowspan'], td: ['align', 'colspan', 'rowspan'],
  code: ['class'], pre: ['class'], span: ['class', 'id'], div: ['class', 'id'], p: ['class'], ul: ['class'], ol: ['class', 'start'], li: ['class'],
  details: ['open'], figure: ['class'],
  video: ['controls', 'preload', 'width', 'height', 'poster', 'aria-label'],
  audio: ['controls', 'preload'],
  source: ['src', 'type'],
  track: ['kind', 'srclang', 'label', 'src'],
  // GFM task lists: a disabled checkbox, nothing a page can submit.
  input: ['type', 'checked', 'disabled'],
};

const OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  // Relative URLs (the site's own pages and assets) always pass; of the absolute ones only these schemes do.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'poster'],
  allowProtocolRelative: false,
  // A dropped element's text is kept, except for the ones whose text is code or style, never prose.
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template'],
  // Bare attributes with no value (`<a download>`, `<video controls>`) are kept: sanitize-html drops empty ones otherwise.
  allowedEmptyAttributes: ['alt', 'download', 'controls', 'checked', 'disabled', 'open'],
  // Void elements are written without an end tag.
  selfClosing: ['img', 'br', 'hr', 'input', 'source', 'track'],
  // Only a checkbox may be an <input>.
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
};

// The second layer: the previous regex pass, now over already-parsed output.
const DANGEROUS_BLOCKS = /<(script|style|iframe|object|embed|form|template)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_OPEN = /<\/?(script|style|iframe|object|embed|form|template|link|meta|base)\b[^>]*>/gi;
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /(\s(?:href|src|xlink:href|action|formaction)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'>\s]*\2/gi;

// sanitize-html decodes entities in text (it must: an entity-encoded `javascript:` scheme is only caught once decoded) and
// writes a few characters back raw where `marked` and the page templates wrote an entity (the same character). Text
// nodes only, and `/>` back to `>` for void elements, so a page whose content did not change is byte-identical to what
// the old sanitizer produced (#421: the build is compared before and after).
const TEXT_ENTITIES = { "'": '&#39;', '"': '&quot;', '\u00b7': '&middot;' };
const keepAuthoredEntities = (html) =>
  html
    .replace(/(^|>)([^<]*)/g, (_, gt, text) => gt + text.replace(/['"\u00b7]/g, (c) => TEXT_ENTITIES[c]))
    .replace(/ \/>/g, '>')
    .replace(/ (controls|download|checked|disabled|open)=""/g, ' $1');

/** @param {unknown} html HTML from `marked` or from GitHub's renderer. @returns {string} Safe HTML for the static site. */
export function sanitizeHtml(html) {
  let out = keepAuthoredEntities(sanitize(String(html).replace(/<!--[\s\S]*?-->/g, ''), OPTIONS));
  let prev;
  do {
    prev = out;
    out = out.replace(DANGEROUS_BLOCKS, '').replace(DANGEROUS_OPEN, '').replace(EVENT_ATTR, '').replace(JS_URL, '$1$2#$2');
  } while (out !== prev);
  return out;
}
