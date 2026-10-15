// A tiny translation model from code to Smith Atomic English, trained on our own corpus (owner, 2026-10-15: "use
// traditional concepts used by LLMs but on our system and vocab"). No network, no model call; retrained from every
// passing answer, so it gets better as the library grows.
//
//   tokenize   code: `xs.lastIndexOf(x)` -> RECV . last index of ( ARG );  sentence: list(·) finds last index of(·)
//   BPE        the most frequent adjacent pairs on each side are merged into units, round after round
//   align      which code units go with which sentence units: a Dice score over the parallel corpus (counted attention)
//   LM         bigram counts over sentence units (what tends to follow what in our sentences)
//   decode     beam over the grammar's shapes for the receiver's subject and the argument count (constrained, so every
//              output is grammatical), the VERB slot filled from the phrase table or the member's tagged verb; each
//              candidate scored by how well its words cover the code's units, plus the LM, minus a length penalty
import { SHAPES } from '../../gate/grammar/shapes.mjs';
import { actionCalls } from '../../../line-smith/scripts/lib-sentence.mjs';
import { wordsOf, verbOf, SUBJECT_OF_GEN } from '../build/build.mjs';

/** Member names that ask a yes/no question (R4: they take the checks().if() frame). */
export const QUESTION_WORDS = new Set(['has', 'is', 'includes', 'starts', 'ends', 'every', 'some', 'can', 'contains', 'matches']);

const BOS = '<s>';
const EOS = '</s>';

/** Code tokens: names split into words; the receiver and arguments as RECV and ARG; punctuation kept. */
export function tokenizeCode(js, params = []) {
  const names = new Map(params.map(([n], i) => [n, i === 0 ? 'RECV' : 'ARG']));
  const out = [];
  for (const m of String(js).matchAll(/[A-Za-z_$][\w$]*|\d+|=>|[^\s\w]/g)) {
    const t = m[0];
    if (names.has(t)) out.push(names.get(t));
    else if (/^[A-Za-z_$]/.test(t)) out.push(...wordsOf(t));
    else out.push(t);
  }
  return out;
}

/** Sentence tokens: each call as its word, with · when it takes an argument. */
// The action only: R10's return clause is derived from it, so it carries nothing to learn.
export const tokenizeSentence = (fluent) => actionCalls(fluent).map(({ word, args }) => (args.length ? `${word}(·)` : word));

/** BPE: learns `rounds` merges of the most frequent adjacent pairs (count >= min) over token sequences. */
export function learnBpe(seqs, { rounds = 50, min = 3 } = {}) {
  let data = seqs.map((s) => [...s]);
  const merges = [];
  for (let r = 0; r < rounds; r++) {
    const counts = new Map();
    for (const s of data) for (let i = 0; i + 1 < s.length; i++) {
      const k = `${s[i]}\u0001${s[i + 1]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!best || n < min) break;
    const pair = best.split('\u0001');
    merges.push(pair);
    data = data.map((s) => applyMerge(s, pair));
  }
  return merges;
}
function applyMerge(s, [a, b]) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === a && s[i + 1] === b) {
      out.push(`${a}_${b}`);
      i++;
    } else out.push(s[i]);
  }
  return out;
}
export const applyBpe = (seq, merges) => merges.reduce((s, m) => applyMerge(s, m), [...seq]);

/** The parallel corpus: catalog atoms with a sentence (each js form), plus passing answers given. */
export function corpusFrom(catalog, answers = []) {
  const pairs = [];
  for (const a of catalog) {
    if (!a.fluent) continue;
    const params = Array.isArray(a.check) ? a.check[0]?.params ?? [] : [];
    // The source side is the code and the atom's name: the name's words bridge code pieces and sentence words (R8).
    for (const js of a.js ?? []) pairs.push({ code: [...tokenizeCode(js, params), ...wordsOf(a.atom)], sentence: tokenizeSentence(a.fluent) });
  }
  for (const x of answers) {
    if (x?.sentence && x?.js) pairs.push({ code: [...tokenizeCode(x.js, x.params ?? []), ...wordsOf(x.existing ?? x.atom ?? '')], sentence: tokenizeSentence(x.sentence) });
  }
  return pairs;
}

const CONTENT = (t) => /^[a-z]/.test(t); // words, not punctuation or RECV/ARG

/** Trains the model: BPE on both sides, the Dice phrase table, the bigram LM. Plain JSON, so it can be saved. */
export function train(pairs, { rounds = 50 } = {}) {
  const codeMerges = learnBpe(pairs.map((p) => p.code.filter(CONTENT)), { rounds });
  const sentMerges = learnBpe(pairs.map((p) => p.sentence), { rounds });
  const both = new Map();
  const cCount = new Map();
  const sCount = new Map();
  const bigram = new Map();
  const unigram = new Map();
  const units = (p) => ({
    c: [...new Set([...p.code.filter(CONTENT), ...applyBpe(p.code.filter(CONTENT), codeMerges)])],
    s: [...new Set(p.sentence.map((t) => t.replace(/\(·\)$/, '')))],
  });
  for (const p of pairs) {
    const { c, s } = units(p);
    for (const x of c) cCount.set(x, (cCount.get(x) ?? 0) + 1);
    for (const y of s) sCount.set(y, (sCount.get(y) ?? 0) + 1);
    for (const x of c) for (const y of s) both.set(`${x}\u0001${y}`, (both.get(`${x}\u0001${y}`) ?? 0) + 1);
    const seq = [BOS, ...p.sentence, EOS];
    for (let i = 0; i + 1 < seq.length; i++) {
      bigram.set(`${seq[i]}\u0001${seq[i + 1]}`, (bigram.get(`${seq[i]}\u0001${seq[i + 1]}`) ?? 0) + 1);
      unigram.set(seq[i], (unigram.get(seq[i]) ?? 0) + 1);
    }
  }
  const phrase = {};
  for (const [k, n] of both) {
    const [x, y] = k.split('\u0001');
    const dice = (2 * n) / (cCount.get(x) + sCount.get(y));
    if (dice >= 0.2) (phrase[x] ??= {})[y] = Number(dice.toFixed(3));
  }
  return { codeMerges, sentMerges, phrase, bigram: Object.fromEntries(bigram), unigram: Object.fromEntries(unigram), vocab: unigram.size, pairs: pairs.length };
}

/** log P(b | a), add-one smoothed. */
function lm(model, a, b) {
  return Math.log(((model.bigram[`${a}\u0001${b}`] ?? 0) + 1) / ((model.unigram[a] ?? 0) + model.vocab));
}

/** The code units of an atom (words plus learned merges): what a sentence should cover. */
export function codeUnits(model, js, params) {
  const words = tokenizeCode(js, params).filter(CONTENT);
  return [...new Set([...words, ...applyBpe(words, model.codeMerges)])];
}

/** The verbs the phrase table offers for the code's units (third person only), best first. */
export function verbsFor(model, units, verbWords) {
  const score = new Map();
  for (const u of units) for (const [y, d] of Object.entries(model.phrase[u] ?? {})) if (verbWords.has(y)) score.set(y, Math.max(score.get(y) ?? 0, d));
  return [...score].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/**
 * Decodes sentences for an atom: every known shape for the subject and argument count, the VERB slot filled from the
 * phrase table and the member's tagged verb, scored by coverage of the code's units, the LM and length. Best first.
 */
export function decode(model, { js, params, member, verbWords, k = 5, shapes = [...SHAPES.keys()] }) {
  const subject = SUBJECT_OF_GEN[params[0]?.[1]];
  if (!subject) return [];
  const units = codeUnits(model, js, params);
  // The verb comes from the code: the member's own verb, or one the phrase table ties strongly to the member's words.
  const strong = verbsFor({ ...model, phrase: Object.fromEntries(Object.entries(model.phrase).map(([u, ys]) => [u, Object.fromEntries(Object.entries(ys).filter(([, d]) => d >= 0.5))])) }, wordsOf(member), verbWords);
  const verbs = [...new Set([verbOf(member, verbWords), ...strong.slice(0, 2)].filter(Boolean))];
  if (!verbs.length) return [];
  // The receiver's subject leads, or follows a frame: clones().text(·).and() for a copy, checks().if(·) for a question.
  const question = QUESTION_WORDS.has(wordsOf(member)[0]);
  const framed = (sh) => (question ? sh.startsWith('checks().if(·).') : sh.startsWith(`${subject}(·).`) || sh.startsWith(`clones().${subject}(·).and().`));
  const fits = shapes.filter((sh) => framed(sh) && (sh.match(/\(·\)/g) ?? []).length === params.length && (sh.match(/VERB\(\)/g) ?? []).length <= 1 && !sh.includes('VERB(·)'));
  const names = params.map(([n]) => n);
  const out = [];
  for (const shape of fits) {
    for (const verb of shape.includes('VERB()') ? verbs : [null]) {
      const toks = shape.split('.').map((t) => t.replace(/^VERB\(\)$/, verb));
      const words = toks.map((t) => t.replace(/\(·?\)$/, ''));
      // Coverage (attention, counted): each code unit is explained by the best sentence word for it.
      const cover = units.reduce((a, u) => a + Math.max(0, ...words.map((w) => model.phrase[u]?.[w] ?? (u === w || `${u}s` === w ? 1 : 0))), 0) / Math.max(1, units.length);
      const seq = [BOS, ...toks, EOS];
      let lp = 0;
      for (let i = 0; i + 1 < seq.length; i++) lp += lm(model, seq[i], seq[i + 1]);
      const score = 3 * cover + lp / seq.length - 0.05 * toks.length;
      let i = 0;
      const sentence = toks.map((t) => (t.endsWith('(·)') ? `${t.slice(0, -3)}(${names[i++]})` : t.endsWith('()') ? t : `${t}()`)).join('.');
      out.push({ sentence, score: Number(score.toFixed(3)), cover: Number(cover.toFixed(2)) });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
