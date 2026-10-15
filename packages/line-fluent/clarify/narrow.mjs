// Narrowing (clarify step 4, owner 2026-10-15): the person is never handed a menu of sentences to judge. The model
// only guesses synonyms; the person knows what should happen. So every option that held up runs on the same readable
// inputs, and the person is asked about the inputs where the options disagree, in plain words:
//
//   "With prices = [3,1,2], what should come out?  A. [1,2,3]  B. [2,1,3]  C. something else (tell me what)"
//
// Each answer rules options out and is kept as a confirmed fact. When the options left behave the same on every case
// they are true synonyms, and only then is the wording asked: "Which reads best?" That fixes the exact sentence. A
// "something else" answer is the person's own example, which step 5 (create) builds from.
//
// State is plain JSON (so a conversation can pause between turns): {question, options, facts, ruledOut, pending}.

const LETTERS = 'ABCDEFGHIJ';

/**
 * The next thing to ask, or the outcome.
 * @param {object} state The narrowing state.
 * @param {{run: (option: object, k: number) => Promise<string>, given: (options: object[], k: number) => string, cases?: number}} how Runs an option on readable case k (its outcome as text); `given` says case k in words.
 * @returns {Promise<object>} {kind: 'behaviour' | 'wording' | 'confirm' | 'create', text, ...}.
 */
export async function nextQuestion(state, { run, given, cases = 4 }) {
  const options = state.options;
  if (!options.length) return { kind: 'create', text: createText(state) };
  if (options.length > 1) {
    let best = null;
    for (let k = 0; k < cases; k++) {
      if (state.facts.some((f) => f.case === k)) continue;
      const groups = new Map();
      for (const o of options) {
        const out = await run(o, k);
        if (!groups.has(out)) groups.set(out, []);
        groups.get(out).push(o.answer);
      }
      if (groups.size > 1 && (!best || groups.size > best.groups.size)) best = { k, groups };
    }
    if (best) {
      const choices = [...best.groups.entries()].map(([outcome, answers], i) => ({ letter: LETTERS[i], outcome, answers }));
      const lines = choices.map((c) => `  ${c.letter}. ${c.outcome}`).join('\n');
      return {
        kind: 'behaviour', case: best.k, given: given(options, best.k), choices,
        text: `${given(options, best.k)}, what should come out?\n${lines}\n  ${LETTERS[choices.length]}. something else (tell me what)`,
      };
    }
    const lines = options.map((o, i) => `  ${i + 1}. ${o.plain}`).join('\n');
    if (state.source === 'code') {
      // The code fixes what it does; only the words are open. The question draws out the person's own word for it.
      const o = { example: codeExample(state) };
      return { kind: 'wording', text: `This part of the code ${o.example ? `does this: ${o.example}` : 'does one thing'}. Which of these says it best?\n${lines}\nOr tell me your own word for what it does.` };
    }
    return { kind: 'wording', text: `These all do the same thing. Which way of saying it reads best?\n${lines}` };
  }
  const o = options[0];
  if (state.source === 'code' && !o.created) {
    return { kind: 'wording', text: `This part of the code ${codeExample(state) ? `does this: ${codeExample(state)}` : 'does one thing'}. Does this say it well?\n  1. ${o.plain}\nAnswer 1, or tell me your own word for what it does.` };
  }
  return { kind: 'confirm', text: `So: ${o.plain}.${o.example ? ` For example, ${o.example}.` : ''} Is that what you want? (yes / no)` };
}

/** The code's own example from its input/output guess: "with items = [...] and limit = 3, it gives [\"bag\"]". */
function codeExample(state) {
  const g = state.guess;
  return g && g.output !== null ? `${g.given.replace(/^With/, 'with')}, it gives ${g.output}` : null;
}

function createText(state) {
  const facts = state.facts.map((f) => `${f.given}, it should give ${f.output}`).join('; ');
  return facts
    ? `Nothing we have does that yet, so I will make a new one from what you told me (${facts}). Is there anything else it should do?`
    : 'Nothing we have does that yet. Give one example of what should happen: what goes in, and what should come out.';
}

/**
 * Applies the person's reply to the question they were asked; returns the new state and, when finished, the outcome.
 * @param {object} state The narrowing state.
 * @param {object} question What nextQuestion() returned.
 * @param {string} reply The person's reply.
 * @returns {{state: object, done?: {status: 'chosen', option: object} | {status: 'create', facts: object[]}, again?: string}} The new state, the outcome, or what to say to ask again.
 */
export function applyAnswer(state, question, reply) {
  const text = String(reply ?? '').trim();
  const next = { ...state, facts: [...state.facts], ruledOut: [...state.ruledOut] };
  if (question.kind === 'behaviour') {
    const letter = text.toUpperCase().match(/^[A-J]\b/)?.[0];
    const choice = letter && question.choices.find((c) => c.letter === letter);
    const output = choice ? choice.outcome : text.replace(/^[A-J][.)]?\s*/i, '');
    if (!output) return { state, again: 'Answer with a letter, or say what should come out.' };
    const keep = choice ? new Set(choice.answers) : new Set(question.choices.filter((c) => c.outcome === output).flatMap((c) => c.answers));
    next.ruledOut.push(...next.options.filter((o) => !keep.has(o.answer)).map((o) => o.answer));
    next.options = next.options.filter((o) => keep.has(o.answer));
    next.facts.push({ case: question.case, given: question.given, output });
    if (!next.options.length) return { state: next, done: { status: 'create', facts: next.facts } };
    return { state: next };
  }
  if (question.kind === 'wording') {
    const n = /^\d+$/.test(text) ? Number(text) : null;
    const option = n ? next.options[n - 1] : null;
    if (!option && state.source === 'code' && /^[a-z][a-z ]*$/i.test(text)) return { state: next, done: { status: 'word', word: text.toLowerCase() } };
    if (!option) return { state, again: 'Answer with the number of the wording you like best.' };
    next.ruledOut.push(...next.options.filter((o) => o !== option).map((o) => o.answer));
    next.options = [option];
    if (state.source === 'code') return { state: next, done: { status: 'chosen', option } }; // behaviour is the code's; the words are now agreed
    return { state: next };
  }
  if (question.kind === 'confirm') {
    if (/^(y|yes|right|correct|ok)\b/i.test(text)) return { state: next, done: { status: 'chosen', option: next.options[0] } };
    next.ruledOut.push(next.options[0].answer);
    next.options = [];
    if (text && !/^(n|no)\b\.?$/i.test(text)) next.facts.push({ case: null, given: 'in your words', output: text.replace(/^(n|no)\b[,.]?\s*/i, '') });
    return { state: next, done: { status: 'create', facts: next.facts } };
  }
  return { state: next, done: { status: 'create', facts: next.facts.concat(text ? [{ case: null, given: 'in your words', output: text }] : []) } };
}
