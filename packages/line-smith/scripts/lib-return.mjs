// R10 (ENGLISH-RULES.md): every sentence ends `andThe().<name>()`, the name of what it returns. The name is decided by
// rules, never per atom, so the grammar test, gen-atoms and the fluent gate all derive the same one:
//
//   returnNameOf('clones().text(s).and().lowercases()')   -> 'lowercased'
//   returnNameOf('checks().if(a).is().equal().to(b)')     -> 'answer'
//   returnNameOf('text(s).splits().by(sep)')              -> 'parts'   (grammar.returnNames)
import { parse } from './lib-sentence.mjs';

/** The word that opens the return clause. */
export const RETURN_WORD = 'andThe';

/** Irregular past participles of third-person verbs (regular ones are derived). */
const IRREGULAR = {
  finds: 'found', takes: 'taken', splits: 'split', keeps: 'kept', sends: 'sent', makes: 'made', gets: 'got',
  sets: 'set', puts: 'put', cuts: 'cut', reads: 'read', writes: 'written', gives: 'given', holds: 'held',
  leaves: 'left', builds: 'built', shuts: 'shut', spreads: 'spread', binds: 'bound', breaks: 'broken',
};

/** The past participle of a third-person verb: lowercases -> lowercased, trims -> trimmed, copies -> copied. */
export function participleOf(verb) {
  if (IRREGULAR[verb]) return IRREGULAR[verb];
  let base;
  if (/ies$/.test(verb)) base = `${verb.slice(0, -3)}y`;
  else if (/(ss|sh|ch|x|zz|o)es$/.test(verb)) base = verb.slice(0, -2);
  else base = verb.slice(0, -1);
  if (/y$/.test(base) && !/[aeiou]y$/.test(base)) return `${base.slice(0, -1)}ied`;
  if (/e$/.test(base)) return `${base}d`;
  // One short vowel before one final consonant doubles it: trim -> trimmed, map -> mapped, drop -> dropped.
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(base)) return `${base}${base.at(-1)}ed`;
  return `${base}ed`;
}

/** The sentence without its return clause (a sentence that has none comes back unchanged). */
export function withoutReturn(sentence) {
  const i = sentence.lastIndexOf(`.${RETURN_WORD}()`);
  return i >= 0 ? sentence.slice(0, i) : sentence;
}

/** The return clause a sentence has, `{ name }`, or null. */
export function returnClauseOf(sentence) {
  const calls = parse(sentence);
  const k = calls.findIndex((c) => c.word === RETURN_WORD);
  if (k < 0) return null;
  return { name: calls[k + 1]?.word ?? null, extra: calls.length - k - 2 };
}

/** First words whose kind fixes the name (R9 and the frames). */
const BY_FIRST = { checks: 'answer', when: 'chosen', chooses: 'chosen', matches: 'matched', attempts: 'result', folds: 'total' };

/**
 * The return name R10 gives a sentence (its return clause, if any, is ignored).
 * @param {string} sentence An Atomic English sentence.
 * @param {Record<string, string>} returnNames grammar.returnNames: the exceptions, keyed by the verb and the words
 *   that follow it with no argument (`takes.first`, `drops.duplicates`) or by the verb alone (`splits`).
 */
export function returnNameOf(sentence, returnNames = {}) {
  const calls = parse(withoutReturn(sentence));
  const first = calls[0]?.word;
  if (BY_FIRST[first]) return BY_FIRST[first];
  if (first === 'the') return 'found';
  if (first === 'every') {
    // R9: every(x).in(xs).is().mapped()... or .is().kept()...: the participle after the first is().
    const i = calls.findIndex((c) => c.word === 'is');
    return calls[i + 1]?.word ?? 'mapped';
  }
  // The content verb: after and() in a copy (R5), else right after the subject.
  const at = first === 'clones' ? calls.findIndex((c) => c.word === 'and') + 1 : 1;
  const verb = calls[at]?.word;
  if (!verb) return null;
  const tail = [];
  for (let j = at + 1; j < calls.length && !calls[j].args.length; j++) tail.push(calls[j].word);
  for (let n = tail.length; n >= 0; n--) {
    const key = [verb, ...tail.slice(0, n)].join('.');
    if (returnNames[key]) return returnNames[key];
  }
  return participleOf(verb);
}

/** The sentence with its R10 return clause: any clause it has is replaced by the derived one. */
export function withReturn(sentence, returnNames = {}) {
  const base = withoutReturn(sentence);
  return `${base}.${RETURN_WORD}().${returnNameOf(base, returnNames)}()`;
}
