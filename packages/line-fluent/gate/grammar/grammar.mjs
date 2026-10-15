// Gate check `grammar` (docs/line/FLUENT-PLAN-2026-10-15.md, Wave 2 leaf t1-2a-grammar).
// Walks an answer's fluent sentence word by word with C5 `nextWords`, so the gate refuses exactly
// what the LSP completions would not offer.
//
//   checkGrammar({ sentence: 'checks().if(a).is().equl().to(b)' })
//     -> { check: 'fail',
//          errors: ['The word `equl` is not legal after `checks().if(a).is()`; ... use `equal()` instead.'],
//          fixes: [{ kind: 'replace-word', from: 'equl', to: 'equal' }] }

import { parse } from '../../../line-smith/scripts/lib-sentence.mjs';
import { nextWords } from '../../grammar/next-words.mjs';
import { checkShape } from './shapes.mjs';

/** Legal words listed in one error sentence; the rest are counted. */
const LISTED = 12;

/** Levenshtein distance between two words. */
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The legal word closest to `word`, or null when none is close enough to be a misspelling
 * (distance above half the longer word). Ties go to the alphabetically first word.
 */
export function closestWord(word, legal) {
  let best = null;
  let bestDist = Infinity;
  for (const w of [...legal].sort()) {
    const d = editDistance(word, w);
    if (d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  if (best === null) return null;
  return bestDist <= Math.max(1, Math.floor(Math.max(word.length, best.length) / 2)) ? best : null;
}

const quoteList = (words) => {
  const shown = words.slice(0, LISTED).map((w) => `\`${w}\``).join(', ');
  return words.length > LISTED ? `${shown} and ${words.length - LISTED} more` : shown;
};

const callText = ({ word, args }) => `${word}(${args.join(', ')})`;

/**
 * CheckResult for an answer's `sentence`: `skip` when it is null, `fail` on the first word the
 * grammar does not allow (with a replace-word or remove-word fix) or when the sentence stops early,
 * otherwise `pass`.
 */
export function checkGrammar(answer) {
  const sentence = answer?.sentence;
  if (sentence === null || sentence === undefined) return { check: 'skip', errors: [], fixes: [] };

  let calls;
  try {
    if (typeof sentence !== 'string' || !sentence.trim()) throw new Error('empty');
    calls = parse(sentence.trim());
  } catch {
    return {
      check: 'fail',
      errors: [`The sentence \`${sentence}\` is not a chain of calls like \`word(args).word(args)\`; write it as one.`],
      fixes: [],
    };
  }

  const exact = walkTrie(sentence, calls);
  if (exact.check === 'pass') return exact;
  // Second pass: the sentence's shape (shapes.mjs). A known shape passes, with any new verbs reported as aliases.
  const shaped = checkShape(calls);
  if (shaped.check === 'pass') return { check: 'pass', errors: [], fixes: [], aliases: shaped.aliases, shape: shaped.shape, ...(shaped.newShape ? { newShape: shaped.newShape } : {}) };
  // A slip of a known word keeps the trie's fix; only a new verb in a shape the grammar lacks gets the shape refusal,
  // with the nearest real sentences as examples. Every other failure is the trie's.
  if (shaped.typo || !shaped.newVerb) return exact;
  const examples = shaped.nearest.map((n) => `\`${n.example}\``).join(', ');
  return {
    check: 'fail',
    errors: [`The sentence \`${sentence.trim()}\` does not fit the grammar: ${shaped.reason}. Sentences with the nearest shapes: ${examples}; write it in one of those shapes.`],
    fixes: [],
  };
}

/** The first pass: the sentence word by word through the C5 trie (only word paths a known sentence uses). */
function walkTrie(sentence, calls) {
  const done = [];
  for (let i = 0; i < calls.length; i++) {
    const { word } = calls[i];
    const prefix = done.join('.');
    const { legal } = nextWords(prefix);
    if (!legal.includes(word)) {
      const where = prefix ? `after \`${prefix}\`` : 'at the start of a sentence';
      const legalText = legal.length ? `legal words there are ${quoteList(legal)}` : 'no word is legal there';
      const to = closestWord(word, legal);
      if (to) {
        return {
          check: 'fail',
          errors: [`The word \`${word}\` is not legal ${where}; ${legalText}; use \`${to}()\` instead.`],
          fixes: [{ kind: 'replace-word', from: word, to }],
        };
      }
      return {
        check: 'fail',
        errors: [`The word \`${word}\` is not legal ${where}; ${legalText}; remove it.`],
        fixes: [{ kind: 'remove-word', word }],
      };
    }
    done.push(callText(calls[i]));
  }

  const end = nextWords(done.join('.'));
  if (!end.complete) {
    return {
      check: 'fail',
      errors: [
        `The sentence \`${sentence.trim()}\` is incomplete; it may continue with ${quoteList(end.legal)}.`,
      ],
      fixes: [],
    };
  }
  return { check: 'pass', errors: [], fixes: [] };
}
