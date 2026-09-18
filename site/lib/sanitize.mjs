// Defensive sanitizer for HTML that comes back from GitHub's markdown renderer.
// GitHub already sanitizes; this is belt-and-braces for our own static output.

const DANGEROUS_BLOCKS = /<(script|style|iframe|object|embed|form|template)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_OPEN = /<\/?(script|style|iframe|object|embed|form|template|link|meta|base)\b[^>]*>/gi;
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /(\s(?:href|src|xlink:href|action|formaction)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'>\s]*\2/gi;

export function sanitizeHtml(html) {
  let out = String(html).replace(/<!--[\s\S]*?-->/g, '');
  let prev;
  do {
    prev = out;
    out = out.replace(DANGEROUS_BLOCKS, '').replace(DANGEROUS_OPEN, '').replace(EVENT_ATTR, '').replace(JS_URL, '$1$2#$2');
  } while (out !== prev);
  return out;
}
