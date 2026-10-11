// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatMessage } from '../types';

/** What the chat says after a plan step was added or refused: the sentence first, the tool call under Details. */
export function stepAnswer(r: { ok: boolean; sentence: string; code?: string; detail?: string }, call: string, id: string): ChatMessage {
  const details = [call, ...(r.code ? [`code: ${r.code}`] : []), ...(r.detail ? [r.detail] : [])];
  if (!r.ok) return { id, from: 'line', tone: 'refusal', text: r.sentence, details };
  return { id, from: 'line', text: `${r.sentence} Approve it in the Plan below.`, details };
}
