// Small pure text helpers shared by the site build: slugs, escaping, title cleanup.

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'section';
}

/** Returns a slugger that de-duplicates within one scope: a, a-2, a-3. */
export function makeSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "[Demo Epic] construct create -- x" -> "construct create -- x" (and tidy the dashes). */
export function cleanTitle(title) {
  return String(title)
    .replace(/^\s*\[Demo(?: Epic)?\]\s*/i, '')
    .replace(/\s+--\s+/g, ' — ')
    .trim();
}

export function isDemoTitle(title) {
  return /^\s*\[Demo/i.test(title || '');
}

/** Strip markdown to a one-line plain-text summary. */
export function plainSummary(md, max = 220) {
  const text = String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
