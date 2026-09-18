// Parse one demo issue body into the pieces the site shows.
import { plainSummary } from './text.mjs';

const BENEFIT_HEADING = /^#{2,4}\s*(?:benefit|why it matters|the benefit)\s*:?\s*$/i;
const BENEFIT_INLINE = /^\*\*(?:benefit|why it matters)\*\*\s*:?\s*(.+)$/i;
const VERIFIED = /verified on\s+(?:commit\s+)?`?([0-9a-f]{7,40})`?/i;

export function parsePartOf(body) {
  const m = /^\s*Part of\s+#(\d+)/im.exec(String(body || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Pull the optional "Benefit" block and "verified on <commit>" line out of the
 * markdown, and drop the "Part of #N" bookkeeping line. Returns the remaining
 * markdown plus the extracted pieces.
 */
export function parseStoryBody(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  let benefit = '';
  let verified = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (kept.length === 0 && /^\s*Part of\s+#\d+/i.test(line)) continue; // bookkeeping
    const v = VERIFIED.exec(line);
    if (v && line.trim().length < 200) {
      verified = v[1];
      continue;
    }
    if (BENEFIT_HEADING.test(line.trim())) {
      const block = [];
      i++;
      while (i < lines.length && !/^#{1,4}\s/.test(lines[i]) && !/^---\s*$/.test(lines[i])) block.push(lines[i++]);
      i--;
      benefit = block.join('\n').trim();
      continue;
    }
    const b = BENEFIT_INLINE.exec(line.trim());
    if (b) {
      benefit = b[1].trim();
      continue;
    }
    kept.push(line);
  }
  return { markdown: kept.join('\n').replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n'), benefit, verified };
}

/** One-line summary: the first prose paragraph, skipping headings/code/lists. */
export function firstParagraph(md) {
  const paras = String(md).split(/\n\s*\n/);
  for (const p of paras) {
    const t = p.trim();
    if (!t || /^(#|```|[-*]\s|\d+\.\s|>|!\[|\|)/.test(t)) continue;
    return plainSummary(t);
  }
  return '';
}

/** Split rendered HTML at the last <hr>, if the tail looks like the setup/API/limits reference block. */
export function splitReference(html) {
  const idx = html.lastIndexOf('<hr');
  if (idx === -1) return { main: html, reference: '' };
  const tail = html.slice(idx).replace(/^<hr[^>]*>/, '');
  if (!/(Setup|Exceptions|Future consid|What it exposes)/i.test(tail)) return { main: html, reference: '' };
  return { main: html.slice(0, idx), reference: tail };
}

/** Shift heading levels down by `by` (h2 -> h3) so a story's headings nest under its own h2. */
export function shiftHeadings(html, by = 1) {
  return html.replace(/<(\/?)h([1-6])\b/gi, (m, slash, n) => `<${slash}h${Math.min(6, Number(n) + by)}`);
}

/** Add stable ids to h3-h6 headings so they are linkable; ids are scoped by `scope`. */
export function addHeadingIds(html, scope, slugger) {
  return html.replace(/<h([3-6])([^>]*)>([\s\S]*?)<\/h\1>/gi, (m, n, attrs, inner) => {
    const id = `${scope}-${slugger(inner)}`;
    return `<h${n}${attrs.replace(/\sid="[^"]*"/, '')} id="${id}">${inner}</h${n}>`;
  });
}
