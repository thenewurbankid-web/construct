// LSP go-to-definition over fluent sentences (FLUENT-PLAN "Wave 2 leaves", t4-4a-definition).
// buildIndex() joins the Smith catalog (atoms[]) with the C1 reference (entries[]); definitionAt()
// finds the catalog atom whose sentence words cover a cursor offset. Deterministic, no model.
import { readFileSync } from 'node:fs';
import { actionCalls, parse } from '../../../line-smith/scripts/lib-sentence.mjs';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const defaultCatalog = () => readJson('../../../line-smith/src/atoms/catalog.json');
const defaultReference = () => readJson('../../../line-codemod/bench/atoms/js-reference/reference.json');

/** A sentence's word key: its words in order, args dropped, joined by '.'. */
// R10's return clause is not part of what a sentence's words look up.
export const wordKey = (sentence) => actionCalls(sentence).map((c) => c.word).join('.');

const CALL = /(new\s+)?(\.?)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;

/**
 * The members a JS snippet calls, as `{key}` (a static or constructor key such as `Math.max`,
 * `new Set`) or `{method}` (a prototype method such as `includes`). Plain calls (`fn(x)`) and
 * statements (`if (`) name no member.
 */
export function membersOf(js) {
  const out = [];
  for (const [, isNew, leadingDot, chain] of js.matchAll(CALL)) {
    const segs = chain.split('.');
    if (isNew && !leadingDot) out.push({ key: `new ${chain}` });
    else if (leadingDot) out.push({ method: segs.at(-1) });
    else if (segs.length === 1) continue;
    else if (/^[A-Z]/.test(segs[0])) {
      // `Object.prototype.hasOwnProperty.call(` names `Object.prototype.hasOwnProperty`.
      const s = segs.length > 2 && ['call', 'apply'].includes(segs.at(-1)) && segs.includes('prototype') ? segs.slice(0, -1) : segs;
      out.push({ key: s.join('.') });
    } else out.push({ method: segs.at(-1) });
  }
  return out;
}

/** Reference entry ids for one atom's js snippets: exact key match, or every `*.prototype.m` / `*#m`. */
function referenceFor(jsList, byKey, byMethod) {
  const ids = new Set();
  for (const js of jsList) {
    for (const m of membersOf(js)) {
      const hits = m.key ? byKey.get(m.key) ?? [] : byMethod.get(m.method) ?? [];
      hits.forEach((id) => ids.add(id));
    }
  }
  return [...ids];
}

/**
 * @returns {{ byAtom: Map<string, {atom, fluent, module, js, reference: string[]}>,
 *   bySentenceWords: Map<string, string>, counts: {atoms, withFluent, withReference} }}
 */
export function buildIndex({ catalog = defaultCatalog(), reference = defaultReference() } = {}) {
  const byKey = new Map();
  const byMethod = new Map();
  const push = (map, k, id) => map.set(k, [...(map.get(k) ?? []), id]);
  for (const e of reference.entries) {
    push(byKey, e.key, e.id);
    const m = e.key.match(/(?:\.prototype\.|#)([A-Za-z_$][\w$]*)$/);
    if (m) push(byMethod, m[1], e.id);
  }

  const byAtom = new Map();
  const bySentenceWords = new Map();
  for (const a of catalog.atoms) {
    const js = Array.isArray(a.js) ? a.js : a.js ? [a.js] : [];
    const fluent = a.fluent ?? null;
    byAtom.set(a.atom, { atom: a.atom, fluent, module: a.module, js, reference: referenceFor(js, byKey, byMethod) });
    if (fluent) {
      const k = wordKey(fluent);
      if (!bySentenceWords.has(k)) bySentenceWords.set(k, a.atom);
    }
  }
  const all = [...byAtom.values()];
  return {
    byAtom,
    bySentenceWords,
    counts: {
      atoms: all.length,
      withFluent: all.filter((e) => e.fluent).length,
      withReference: all.filter((e) => e.reference.length).length,
    },
  };
}

/** The calls of a (possibly unfinished) sentence as `{word, start, end}` spans, end exclusive. */
export function wordSpans(sentence) {
  const spans = [];
  const ident = /[A-Za-z_$][\w$]*/y;
  let i = 0;
  while (i < sentence.length) {
    ident.lastIndex = i;
    const m = ident.exec(sentence);
    if (!m) break;
    const start = i;
    let j = i + m[0].length;
    if (sentence[j] === '(') {
      let depth = 0;
      let quote = null;
      for (; j < sentence.length; j++) {
        const ch = sentence[j];
        if (quote) {
          if (ch === '\\') j++;
          else if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch) && --depth === 0) { j++; break; }
      }
    }
    spans.push({ word: m[0], start, end: j });
    if (sentence[j] !== '.') break;
    i = j + 1;
  }
  return spans;
}

/**
 * The atom whose catalog sentence covers `offset`: the longest catalog word key that is a
 * contiguous run of the sentence's words containing the word at `offset`. A dot belongs to the
 * word before it. Returns `{atom, fluent, module, reference}` or null.
 */
export function definitionAt(index, sentence, offset) {
  const spans = wordSpans(sentence);
  const k = spans.findIndex((s, n) => offset >= s.start && offset < (spans[n + 1]?.start ?? s.end + 1));
  if (k < 0) return null;
  const words = spans.map((s) => s.word);
  for (let len = words.length; len >= 1; len--) {
    for (let from = Math.max(0, k - len + 1); from <= k && from + len <= words.length; from++) {
      const atom = index.bySentenceWords.get(words.slice(from, from + len).join('.'));
      if (atom) {
        const { fluent, module, reference } = index.byAtom.get(atom);
        return { atom, fluent, module, reference };
      }
    }
  }
  return null;
}
