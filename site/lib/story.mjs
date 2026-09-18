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
export function stripComments(md) {
  return String(md || '').replace(/<!--[\s\S]*?-->/g, '');
}

const V1_MARKER = /^\s*(?:\*\*Who it is for:\*\*|>\s*\*\*As a\*\*)/m;
const VERIFIED_V1 = /\*?Verified on\s+`?([^`\s@]+)`?\s*@\s*`?([0-9a-f]{7,40})`?\s*\(([^)]*)\)[^\n]*/i;
const plain = (s) => String(s).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * New "demo-curator" shape. Guides: Who it is for / The problem it solves / hero image /
 * ### Contents table / ### Why this matters / Evidence / Verified-on. Stories: a
 * "> As a .. I want .. so that .." sentence, "### Benefit", Verified-on. Everything after
 * the first `---` is the older ticket text, returned as `legacy` (callers decide whether
 * it carries real walkthrough content). Returns null when the new markers are absent.
 */
export function parseDemoBody(body) {
  const md = stripComments(body).replace(/\r\n/g, '\n');
  if (!V1_MARKER.test(md)) return null;
  const cut = /^\s*---\s*$/m.exec(md);
  const head = cut ? md.slice(0, cut.index) : md;
  const legacy = cut ? md.slice(cut.index + cut[0].length) : '';
  const out = { sentence: '', who: '', problem: '', hero: null, contents: {}, why: '', evidence: '', benefit: '', verified: null, verifiedDate: null, legacy: legacy.trim() };

  const sentence = /^>\s*(.+)$/m.exec(head);
  if (sentence) out.sentence = plain(sentence[1]);
  out.who = (/\*\*Who it is for:\*\*\s*(.+)/.exec(head) || [])[1]?.trim() || '';
  out.problem = (/\*\*The problem it solves:\*\*\s*(.+)/.exec(head) || [])[1]?.trim() || '';
  out.hero = (/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(head) || [])[1] || null;
  for (const m of head.matchAll(/^\|\s*#(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)) {
    out.contents[m[1]] = { story: plain(m[2]), benefit: plain(m[3]), surface: plain(m[4]) };
  }
  const v = VERIFIED_V1.exec(head);
  if (v) [out.verified, out.verifiedDate] = [v[2], v[3]];

  const section = (name) => {
    const re = new RegExp(`^###\\s+${name}\\s*\\n([\\s\\S]*?)(?=^###\\s|^\\*Verified|(?![\\s\\S]))`, 'im');
    return (re.exec(head) || [])[1]?.trim() || '';
  };
  out.benefit = section('Benefit');
  let why = section('Why this matters');
  const ev = /^\*\*Evidence[^\n]*/im.exec(why);
  if (ev) {
    out.evidence = ev[0].trim();
    why = why.replace(ev[0], '').trim();
  }
  out.why = why;
  return out;
}

export function parseStoryBody(body) {
  const lines = stripComments(body).replace(/\r\n/g, '\n').split('\n');
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
