// #932 the ledger turn builder (owner, 13 Oct: no long context for the coder). Each turn is a FRESH, SMALL context:
//   1. the short rules (the system prompt)
//   2. the ledger view (ledger.mjs ledgerView: facts, decisions, open questions with cites; every earlier tool result
//      lives here as one sentence, never as a raw message)
//   3. the current step or point and its context pack (plan-cli card(): the open-work card, which carries the pack)
//   4. only the last turn's call and its tool result
//   (and "Your notes:", the model's own scratchpad entries (scratch.md), when there are any; they count against the
//   same budget and are never part of the ledger)
// Previous turns' raw messages are not resent. The model gets anything else with its own tool calls.
// When the last turn was refused, that refusal is the FINAL message (the thing the model answers next). Standing facts
// about the project now (projectFacts, e.g. "No feature has usecases, services or domains yet.") go with the ledger.
//
//   buildTurn(ctx)      -> {messages, tokens, parts: {system, ledger, card, last}} (tokens are estimates, compact.mjs)
//   projectFacts(root)  -> the standing facts read from the project on disk (deterministic, no model call)
import { estimateTokens, CHARS_PER_TOKEN } from './compact.mjs';
import { readLineProject } from '../../../packages/engine/line/model.mjs';

/** The logic kinds a feature may hold (Line ITEM_KINDS), named the way the fact says them. */
const LOGIC = Object.freeze(['usecases', 'services', 'domains']);

/**
 * The standing facts about the project now, read from disk: today, whether any feature has a usecase, service or
 * domain yet (the coder otherwise assumes one exists and imports it).
 * @param {string} root Project root.
 * @returns {string[]}
 * @example projectFacts(root) // => ['No feature has usecases, services or domains yet.']
 */
export function projectFacts(root) {
  let p;
  try { p = readLineProject(root); } catch { return []; }
  if (!p?.isLine) return [];
  const has = LOGIC.filter((k) => p.features.some((f) => f.items.some((i) => i.kind === k)));
  if (!has.length) return ['No feature has usecases, services or domains yet.'];
  const none = LOGIC.filter((k) => !has.includes(k));
  return none.length ? [`No feature has ${none.join(' or ')} yet.`] : [];
}

/** `last` with its last refused tool result moved to the end, so the refusal is the final message. */
function refusalLast(last) {
  const refused = (m) => { if (m?.role !== 'tool') return false; try { return JSON.parse(m.content)?.ok === false; } catch { return /^\{"ok":false\b/.test(String(m.content)); } };
  let at = -1;
  for (let i = last.length - 1; i >= 0; i -= 1) if (refused(last[i])) { at = i; break; }
  if (at < 0 || at === last.length - 1) return last;
  return [...last.slice(0, at), ...last.slice(at + 1), last[at]];
}

/** Token budgets per part (estimates). The card carries the context pack (<= ~1k tokens) and the feature's points. */
export const TURN_BUDGET = Object.freeze({ ledger: 1200, card: 2600, last: 2400, notes: 450 });

const cut = (s, tokens) => { const n = Math.floor(tokens * CHARS_PER_TOKEN); const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}\n…(cut; call the tool again for the rest)` : t; };

/**
 * One turn's messages.
 * @param {{system: {role: 'system', content: string}, ledger: any, ledgerView: (ctx: any, budget: number) => string, card?: string,
 *   last?: any[] | null, tools?: any[], budget?: Partial<typeof TURN_BUDGET>, task?: string, notes?: string, facts?: string[]}} ctx
 *   `card`: the current step/point and its pack; `last`: the last turn's assistant message and its tool (or nudge)
 *   messages; `task`: the standing instruction (start building, use only your tools, finish when done).
 *   `notes`: the scratchpad's entries as text (shown under "Your notes:" when not empty).
 *   `facts`: standing facts about the project now (projectFacts), shown under the ledger.
 * @returns {{messages: any[], tokens: number, parts: {system: number, ledger: number, card: number, last: number, notes: number}}}
 */
export function buildTurn(ctx) {
  const b = { ...TURN_BUDGET, ...(ctx.budget ?? {}) };
  const ledger = ctx.ledgerView({ ledger: ctx.ledger }, b.ledger);
  const card = cut(ctx.card ?? '', b.card);
  const notes = ctx.notes ? cut(ctx.notes, b.notes) : '';
  const facts = (ctx.facts ?? []).filter(Boolean);
  const user = { role: 'user', content: [`What is known so far (the ledger; one line per earlier tool result):\n${ledger}`, facts.length ? `The project now:\n${facts.map((f) => `- ${f}`).join('\n')}` : '', card ? `Now:\n${card}` : '', notes ? `Your notes (your own scratchpad, not checked by Line):\n${notes}` : '', ctx.task ?? 'Use only your tools. Call finish when every acceptance point is done or you cannot make more progress.'].filter(Boolean).join('\n\n') };
  const last = refusalLast(ctx.last ?? []).map((m) => (m.role === 'tool' ? { ...m, content: cut(m.content, b.last) } : m));
  const messages = [ctx.system, user, ...last];
  const t = (ms) => estimateTokens(ms);
  return { messages, tokens: estimateTokens(messages, ctx.tools ?? []), parts: { system: t([ctx.system]), ledger: Math.ceil(ledger.length / CHARS_PER_TOKEN), card: Math.ceil(card.length / CHARS_PER_TOKEN), last: t(last), notes: Math.ceil(notes.length / CHARS_PER_TOKEN) } };
}
