// Clarify: how we get clarity from a person (owner, 2026-10-15). Every time a step needs a person to decide, it
// runs this loop, never an open-ended question:
//
//   1. ask       the person's question, in plain English
//   2. suggest   a model proposes up to n answers (default 10)
//   3. check     each answer is built and tested statically; only answers that hold up are shown
//   4. choose    the person picks one (or none), shown in plain words with a concrete example each
//   5. create    when none fits, a new answer is made by talking with the person again: they give one example of
//                what should happen, a model drafts an answer for it, and the same static check must pass on the
//                person's own example before it is offered back to them
//
// The loop is the same for every use; a use plugs in `suggest`, `check` and `draft`. It runs in two halves so a
// conversation can sit between them (chat, the Cockpit, an agent): propose() does steps 1-3 and returns the menu;
// resolve() takes the person's reply for step 4, or their example for step 5. Nothing is approved here.

/**
 * Steps 1-3: the question, the model's suggestions, each checked; survivors first, in suggestion order.
 * @param {string} question The person's question, in plain English.
 * @param {{suggest: (q: string, n: number) => Promise<string[]>, check: (answer: string) => Promise<{ok: boolean, plain: string, example?: string, reason?: string}>, n?: number}} use The plug-ins.
 * @returns {Promise<{question: string, options: object[], refused: object[], menu: string}>} Options to show, refused ones with the reason, and the plain-English menu.
 */
export async function propose(question, { suggest, check, n = 10 }) {
  const suggestions = [...new Set((await suggest(question, n)).map((s) => String(s).trim()).filter(Boolean))].slice(0, n);
  const checked = [];
  for (const answer of suggestions) checked.push({ answer, ...(await check(answer)) });
  const options = checked.filter((c) => c.ok).map((c, i) => ({ ...c, number: i + 1 }));
  const refused = checked.filter((c) => !c.ok);
  return { question, options, refused, menu: menuFor(question, options) };
}

/** The menu a person reads: each option in plain words with its example, then how to answer. */
export function menuFor(question, options) {
  if (!options.length) {
    return `For “${question}”, none of the suggestions held up. Give one example of what should happen (what goes in, what should come out), and I will make one for it.`;
  }
  const lines = options.map((o) => `${o.number}. ${o.plain}${o.example ? `\n   For example: ${o.example}` : ''}`);
  return `For “${question}”, these hold up:\n\n${lines.join('\n')}\n\nAnswer with a number, or “none” and one example of what should happen.`;
}

/**
 * Step 4 (and the way into step 5): the person's reply to a menu.
 * @param {{options: object[]}} proposal What propose() returned.
 * @param {string} reply A number, or "none" (optionally followed by an example).
 * @returns {{status: 'chosen', option: object} | {status: 'create', example: string | null} | {status: 'unclear', message: string}} What happens next.
 */
export function choose(proposal, reply) {
  const text = String(reply ?? '').trim();
  const num = /^\d+$/.test(text) ? Number(text) : null;
  if (num !== null) {
    const option = proposal.options.find((o) => o.number === num);
    if (option) return { status: 'chosen', option };
    return { status: 'unclear', message: `There is no option ${num}; answer with a number from the list, or “none” and an example.` };
  }
  if (/^none\b/i.test(text) || !proposal.options.length) return { status: 'create', example: text.replace(/^none\b[:,.]?\s*/i, '') || null };
  return { status: 'unclear', message: 'Answer with a number from the list, or “none” and one example of what should happen.' };
}

/**
 * Step 5: make a new answer from the person's example, checked on that example before it is offered.
 * @param {string} question The question.
 * @param {string} example The person's example, in their words.
 * @param {{draft: (q: string, example: string) => Promise<string>, check: (answer: string, opts: {example: string}) => Promise<{ok: boolean, plain: string, example?: string, reason?: string}>}} use The plug-ins.
 * @returns {Promise<{status: 'offer', option: object} | {status: 'retry', message: string}>} The new answer to confirm with the person, or what to ask them next.
 */
export async function create(question, example, { draft, check }) {
  const answer = String(await draft(question, example)).trim();
  const verdict = await check(answer, { example });
  if (verdict.ok) {
    return { status: 'offer', option: { answer, ...verdict, number: 1, created: true }, message: `This is new. ${verdict.plain}${verdict.example ? `\nFor example: ${verdict.example}` : ''}\nUse it? Answer yes, or give a different example.` };
  }
  return { status: 'retry', message: `I could not make one that does that (${verdict.reason}). Could you give another example, or say it differently?` };
}
