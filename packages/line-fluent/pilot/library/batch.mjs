// Batched turns (owner, 2026-10-15): most of a per-entry call was the claude CLI starting (about 3s of 4s) and the
// same long instructions sent again. A batch sends one section's entries (default 20) in one call, the instructions
// once; each answer still goes through the gate on its own. Each turn learns from the one before:
//
//   turn 1   every entry, in batches by section
//   turn 2   the refused ones, again in batches, each with its own refusal
//   user     the still-refused ones: the inside model asks all its questions in one call, the user model answers
//            them all in one call as the person, the inside model answers the batch again with that (rounds times)
//
// A reply that cannot be read fails only the entries it does not answer; those go to the next turn.
import { SYSTEM, SHAPES_SECTION, buildRequest } from '../request/request.mjs';
import { parseFailure } from '../runner/runner.mjs';
import { describeEntry } from './user-stage.mjs';

export const BATCH_SIZE = 20;

export const BATCH_SYSTEM = [
  SYSTEM.replace('Task: write one fluent answer for one JavaScript reference entry, in Smith Atomic English.\nReply with one JSON object and nothing else.',
    'Task: write one fluent answer for EACH JavaScript reference entry below, in Smith Atomic English.\nReply with one JSON object and nothing else: {"answers": [<one answer object per entry, in the same order>]}. Each answer object has the fields below; its entry is the label after ### exactly as written (for example "Array.from #2").'),
  SHAPES_SECTION,
  'Entries from the same section are given together: keep their sentences consistent with each other.',
].join('\n');

const ASK_SYSTEM = [
  'You are writing Smith Atomic English sentences for JavaScript built-ins, and the answers below were refused.',
  'For each entry, ask the person who owns the code ONE question whose answer would help you most to describe what the step does.',
  'Ask in plain, friendly, non-technical English about what the step does for them: what goes in, what comes out, what changes. Never ask about code, syntax, method names or the sentence format.',
  'Reply with one JSON object only: {"questions": [{"entry": "<the label after ###, exactly>", "question": "..."}, ...]}, one per entry, same order.',
].join('\n');

const USER_SYSTEM = [
  'You are the person who owns some code and know exactly what each step does. Someone describing it for you asks one question per step.',
  'Answer each in one or two plain, everyday sentences: what goes in, what comes out, what changes, with a small example in plain words if it helps.',
  'Never write code, never name methods or functions, never suggest wording or a sentence; just say what it does.',
  'Reply with one JSON object only: {"answers": [{"entry": "<the label after ###, exactly>", "answer": "..."}, ...]}, one per question, same order.',
].join('\n');

/** Splits entries into batches of at most `size`, never mixing sections. */
export function batches(entries, size = BATCH_SIZE) {
  const bySection = new Map();
  for (const e of entries) (bySection.get(e.section) ?? bySection.set(e.section, []).get(e.section)).push(e);
  const out = [];
  for (const list of bySection.values()) for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The list a reply holds under `field`, from the prefill plus the text, or from the text alone; null if unreadable. */
export function readList(prefill, text, field) {
  const raw = String(text ?? '');
  for (const candidate of [prefill + raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    try {
      const list = JSON.parse(candidate)?.[field];
      if (Array.isArray(list)) return list;
    } catch {
      // the next reading
    }
  }
  return null;
}

/**
 * Each item's own object from a list: by its label (the entry's key, unique even where ids repeat), else by position
 * when the label is missing or is not another item's. The true entry id is written back; the label was only a label.
 */
export function matchUp(items, list) {
  const objects = (list ?? []).map((x) => (x && typeof x === 'object' ? x : null));
  const labels = new Set(items.map((it) => it.entry.key));
  const byLabel = new Map(objects.filter((x) => x && labels.has(x.entry)).map((x) => [x.entry, x]));
  return items.map((it, i) => {
    const own = byLabel.get(it.entry.key) ?? (objects[i] && !labels.has(objects[i].entry) ? objects[i] : null);
    return own ? { ...own, entry: it.entry.id } : null;
  });
}

/**
 * One batched answer turn: one call for all items, then the gate on each answer.
 * @param {{entry: object, candidates: object[], refusal?: string, dialogue?: {q: string, a: string}[]}[]} items
 * @returns {Promise<{answer: object|null, gate: object, tokensIn: number, tokensOut: number, costUsd: number}[]>}
 */
export async function answerTurn(items, { model, gateOf }) {
  const user = items.map((it, i) => [
    `### ${it.entry.key}`,
    buildRequest(it.entry, { candidates: it.candidates, refusal: it.refusal ?? null }).user,
    ...(it.dialogue ?? []).map((d) => `You asked the person: ${d.q}\nThey said: ${d.a}`),
  ].join('\n')).join('\n\n');
  const prefill = '{"answers": [';
  const reply = await model({ system: BATCH_SYSTEM, user, prefill });
  const answers = matchUp(items, readList(prefill, reply?.text, 'answers'));
  const share = (k) => (reply?.[k] ?? 0) / items.length;
  return Promise.all(items.map(async (it, i) => {
    const answer = answers[i];
    const gate = answer ? await gateOf(it.entry)(answer) : parseFailure(it.entry.id, new Error('the batch reply had no answer for this entry'));
    return { answer: answer ?? null, gate, tokensIn: share('tokensIn'), tokensOut: share('tokensOut'), costUsd: share('costUsd') };
  }));
}

/** One batched round of questions: the inside model asks for every item at once; null where it asked nothing. */
export async function askTurn(items, { model }) {
  const user = items.map((it, i) => [
    `### ${it.entry.key}`,
    buildRequest(it.entry, { candidates: it.candidates }).user,
    it.answer?.sentence ? `Your refused sentence: ${it.answer.sentence}` : 'Your answer could not be read.',
    `Why it was refused: ${it.refusal ?? 'unknown'}`,
    ...(it.dialogue ?? []).map((d) => `You asked the person: ${d.q}\nThey said: ${d.a}`),
  ].join('\n')).join('\n\n');
  const prefill = '{"questions": [';
  const reply = await model({ system: ASK_SYSTEM, user, prefill });
  const asked = matchUp(items, readList(prefill, reply?.text, 'questions'));
  return { questions: asked.map((x) => (typeof x?.question === 'string' && x.question.trim() ? x.question.trim() : null)), reply };
}

/** The person's side, batched: every question answered in one call, seeing only what each step is. */
export async function tellTurn(items, questions, { model }) {
  const user = items.map((it, i) => `### ${it.entry.key}\n${describeEntry(it.entry)}\nTheir question: ${questions[i]}`).join('\n\n');
  const prefill = '{"answers": [';
  const reply = await model({ system: USER_SYSTEM, user, prefill });
  const told = matchUp(items, readList(prefill, reply?.text, 'answers'));
  return { answers: told.map((x) => (typeof x?.answer === 'string' && x.answer.trim() ? x.answer.trim() : null)), reply };
}
