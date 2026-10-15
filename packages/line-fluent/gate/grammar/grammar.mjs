// Gate check `grammar` (docs/line/FLUENT-PLAN-2026-10-15.md, Wave 2 leaf t1-2a-grammar).
// Walks an answer's fluent sentence word by word with C5 `nextWords`, so the gate refuses exactly
// what the LSP completions would not offer.
//
//   checkGrammar({ sentence: 'checks().if(a).is().equl().to(b)' })
//     -> { check: 'fail',
//          errors: ['The word `equl` is not legal after `checks().if(a).is()`; ... use `equal()` instead.'],
//          fixes: [{ kind: 'replace-word', from: 'equl', to: 'equal' }] }

import { readFileSync } from 'node:fs';
import { actionCalls } from '../../../line-smith/scripts/lib-sentence.mjs';
import { returnClauseOf, returnNameOf } from '../../../line-smith/scripts/lib-return.mjs';

const RETURN_NAMES = JSON.parse(readFileSync(new URL('../../../line-smith/src/atoms/naming.json', import.meta.url), 'utf8')).grammar.returnNames;
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

  // The action first (R1-R9): word by word through the trie, then its shape. R10's return clause is checked once the
  // action is sound, so a slip in a word gets its own fix, and a sound action missing its clause gets the R10 fix.
  const action = actionCalls(sentence.trim());
  const exact = walkTrie(sentence, calls);
  const r10 = checkReturn(sentence.trim());
  if (exact.check === 'pass') return r10 ?? exact;
  const actionText = action.map(callText).join('.');
  const actionKnown = exact.at >= action.length && nextWords(actionText).legal.includes('andThe');
  if (actionKnown) return r10 ?? exact;
  // Second pass: the action's shape (shapes.mjs). A known shape passes, with any new verbs reported as aliases.
  const shaped = checkShape(action);
  if (shaped.check === 'pass') return r10 ?? { check: 'pass', errors: [], fixes: [], aliases: shaped.aliases, shape: shaped.shape, ...(shaped.newShape ? { newShape: shaped.newShape } : {}) };
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

/** R10: a refusal for a missing, wrong or trailing return clause, with the fix; null when the clause is right. */
export function checkReturn(sentence) {
  const want = returnNameOf(sentence, RETURN_NAMES);
  const clause = returnClauseOf(sentence);
  if (!clause) {
    return { check: 'fail', errors: [`The sentence \`${sentence}\` does not say what it returns (R10); end it with \`.andThe().${want}()\`.`], fixes: [{ kind: 'add-return', to: want }] };
  }
  if (clause.name !== want) {
    return { check: 'fail', errors: [`The sentence returns its ${want} (R10); end it with \`.andThe().${want}()\`, not \`.${clause.name}()\`.`], fixes: [{ kind: 'replace-word', from: clause.name, to: want }] };
  }
  if (clause.extra) return { check: 'fail', errors: [`Nothing follows \`.andThe().${want}()\` (R10); end the sentence there.`], fixes: [] };
  return null;
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
          at: i,
        };
      }
      return {
        check: 'fail',
        errors: [`The word \`${word}\` is not legal ${where}; ${legalText}; remove it.`],
        fixes: [{ kind: 'remove-word', word }],
        at: i,
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
      at: calls.length,
    };
  }
  return { check: 'pass', errors: [], fixes: [] };
}
