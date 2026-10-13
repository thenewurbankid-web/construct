// #932 the ledger turn builder (owner, 13 Oct: no long context for the coder). Each turn is a FRESH, SMALL context:
//   1. the short rules (the system prompt)
//   2. the ledger view (ledger.mjs ledgerView: facts, decisions, open questions with cites; every earlier tool result
//      lives here as one sentence, never as a raw message)
//   3. the current step or point and its context pack (plan-cli card(): the open-work card, which carries the pack)
//   4. only the last turn's call and its tool result
//   (and "Your notes:", the model's own scratchpad entries (scratch.md), when there are any; they count against the
//   same budget and are never part of the ledger)
// Previous turns' raw messages are not resent. The model gets anything else with its own tool calls.
//
//   buildTurn(ctx)  -> {messages, tokens, parts: {system, ledger, card, last}} (tokens are estimates, compact.mjs)
import { estimateTokens, CHARS_PER_TOKEN } from './compact.mjs';

/** Token budgets per part (estimates). The card carries the context pack (<= ~1k tokens) and the feature's points. */
export const TURN_BUDGET = Object.freeze({ ledger: 1200, card: 2600, last: 2400, notes: 450 });

const cut = (s, tokens) => { const n = Math.floor(tokens * CHARS_PER_TOKEN); const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}\n…(cut; call the tool again for the rest)` : t; };

/**
 * One turn's messages.
 * @param {{system: {role: 'system', content: string}, ledger: any, ledgerView: (ctx: any, budget: number) => string, card?: string,
 *   last?: any[] | null, tools?: any[], budget?: Partial<typeof TURN_BUDGET>, task?: string, notes?: string}} ctx
 *   `card`: the current step/point and its pack; `last`: the last turn's assistant message and its tool (or nudge)
 *   messages; `task`: the standing instruction (start building, use only your tools, finish when done).
 *   `notes`: the scratchpad's entries as text (shown under "Your notes:" when not empty).
 * @returns {{messages: any[], tokens: number, parts: {system: number, ledger: number, card: number, last: number, notes: number}}}
 */
export function buildTurn(ctx) {
  const b = { ...TURN_BUDGET, ...(ctx.budget ?? {}) };
  const ledger = ctx.ledgerView({ ledger: ctx.ledger }, b.ledger);
  const card = cut(ctx.card ?? '', b.card);
  const notes = ctx.notes ? cut(ctx.notes, b.notes) : '';
  const user = { role: 'user', content: [`What is known so far (the ledger; one line per earlier tool result):\n${ledger}`, card ? `Now:\n${card}` : '', notes ? `Your notes (your own scratchpad, not checked by Line):\n${notes}` : '', ctx.task ?? 'Use only your tools. Call finish when every acceptance point is done or you cannot make more progress.'].filter(Boolean).join('\n\n') };
  const last = (ctx.last ?? []).map((m) => (m.role === 'tool' ? { ...m, content: cut(m.content, b.last) } : m));
  const messages = [ctx.system, user, ...last];
  const t = (ms) => estimateTokens(ms);
  return { messages, tokens: estimateTokens(messages, ctx.tools ?? []), parts: { system: t([ctx.system]), ledger: Math.ceil(ledger.length / CHARS_PER_TOKEN), card: Math.ceil(card.length / CHARS_PER_TOKEN), last: t(last), notes: Math.ceil(notes.length / CHARS_PER_TOKEN) } };
}
