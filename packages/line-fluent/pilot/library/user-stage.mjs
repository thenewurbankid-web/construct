// The user stage (owner, 2026-10-15: "haiku inside and opus as user"): an entry the inside model could not get
// through the gate is not handed to a bigger model to answer. The inside model asks, in plain words, the one thing it
// needs to know; the outside model answers as the person who owns the code would (what it does, in everyday words,
// never code or a sentence); the inside model answers again with that, through the same gate. The person's side
// costs a few short replies, and every atom is still written by the inside model and gated.
//
//   round   inside asks one question (from its refused answer and the refusal)
//           outside, as the person, answers in one or two plain sentences
//           inside answers the entry again with the conversation so far, one retry on refusal
import { buildRequest, MAX_CANDIDATES } from '../request/request.mjs';
import { candidatesFor } from '../../generator/generator.mjs';
import { runPilot } from '../runner/runner.mjs';

const ASK_SYSTEM = [
  'You are writing one Smith Atomic English sentence for a JavaScript built-in, and your answer was refused.',
  'Ask the person who owns the code ONE question whose answer would help you most to describe what this step does.',
  'Ask in plain, friendly, non-technical English about what the step does for them: what goes in, what comes out, what changes. Never ask about code, syntax, method names or the sentence format.',
  'Reply with one JSON object only: {"question": "..."}.',
].join('\n');

const USER_SYSTEM = [
  'You are the person who owns a piece of code and knows exactly what it does. Someone describing it for you asks a question.',
  'Answer in one or two plain, everyday sentences: what goes in, what comes out, what changes, with a small example in plain words if it helps.',
  'Never write code, never name methods or functions, never suggest wording or a sentence; just say what it does.',
  'Reply with one JSON object only: {"answer": "..."}.',
].join('\n');

/** One short JSON reply from a model: the field's text, or null when the reply cannot be read. */
async function askField(model, system, user, field) {
  const prefill = `{"${field}": "`;
  const reply = await model({ system, user, prefill });
  const text = String(reply?.text ?? '');
  let value = null;
  for (const candidate of [prefill + text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1), `${prefill}${text.replace(/"?\s*}?\s*$/, '')}"}`]) {
    try {
      value = JSON.parse(candidate)[field];
      break;
    } catch {
      // try the next reading
    }
  }
  return { value: typeof value === 'string' && value.trim() ? value.trim() : null, reply };
}

/** What the entry is, for the person's side: the built-in and its inputs, no catalog and no format rules. */
export function describeEntry(entry) {
  const params = (entry.params ?? []).map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}`).join(', ');
  return `The code step is the JavaScript ${entry.kind} ${entry.id}${entry.kind === 'method' || entry.kind === 'function' ? `(${params})` : ''}.`;
}

/**
 * One entry through the user stage.
 * @param {object} entry C1 reference entry.
 * @param {object} prior The inside stage's result for it (its answer and refusal start the conversation).
 * @param {{asker: Function, user: Function, gate: Function, catalog: object[], rounds?: number, names?: {asker: string, user: string}}} how
 * @returns {Promise<object>} A stage result like runStage's, plus the conversation.
 */
export async function userStage(entry, prior, { asker, user, gate, catalog, rounds = 2, names = { asker: 'haiku', user: 'opus' } }) {
  const candidates = candidatesFor(entry, catalog).slice(0, MAX_CANDIDATES);
  const dialogue = [];
  let last = { answer: prior?.answer ?? null, gate: prior?.gate ?? null };
  let tries = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  const started = Date.now();
  const count = (reply) => {
    tokensIn += reply?.tokensIn ?? 0;
    tokensOut += reply?.tokensOut ?? 0;
    costUsd += reply?.costUsd ?? 0;
  };
  const priced = async (request) => {
    const reply = await asker(request);
    costUsd += reply?.costUsd ?? 0;
    return reply;
  };
  const said = () => dialogue.map((d) => `You asked the person: ${d.q}\nThey said: ${d.a}`).join('\n');
  try {
    for (let round = 0; round < rounds && !last.gate?.pass; round++) {
      const ask = await askField(asker, ASK_SYSTEM, [
        buildRequest(entry, { candidates }).user,
        last.answer?.sentence ? `Your refused sentence: ${last.answer.sentence}` : 'Your answer could not be read.',
        `Why it was refused: ${last.gate?.refusal ?? 'unknown'}`,
        dialogue.length ? `What the person told you so far:\n${said()}` : '',
      ].filter(Boolean).join('\n'), 'question');
      count(ask.reply);
      if (!ask.value) break;
      const reply = await askField(user, USER_SYSTEM, `${describeEntry(entry)}\nTheir question: ${ask.value}`, 'answer');
      count(reply.reply);
      if (!reply.value) break;
      dialogue.push({ q: ask.value, a: reply.value });
      const build = (e, { refusal }) => {
        const request = buildRequest(e, { candidates, refusal: refusal ?? last.gate?.refusal ?? null, shapes: true });
        return { ...request, user: `${request.user}\n${said()}` };
      };
      const { results } = await runPilot([entry], { model: priced, gate, build, maxRetries: 1 });
      const r = results[0];
      tries += r.tries;
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      last = { answer: r.answer, gate: r.gate };
    }
  } catch (e) {
    return { key: entry.key, section: entry.section, stage: 'user', model: `${names.asker}+${names.user} as user`, entry: entry.id, error: String(e?.message ?? e).slice(0, 300), dialogue, tries, tokensIn, tokensOut, costUsd: Number(costUsd.toFixed(6)), ms: Date.now() - started };
  }
  return {
    key: entry.key, section: entry.section, stage: 'user', model: `${names.asker}+${names.user} as user`, entry: entry.id,
    answer: last.answer, gate: last.gate, dialogue, tries, tokensIn, tokensOut, costUsd: Number(costUsd.toFixed(6)), ms: Date.now() - started,
  };
}
