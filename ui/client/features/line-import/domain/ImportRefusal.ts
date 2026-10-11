// Pure (DOMAIN-001): telling a refusal {ok: false, sentence} from a usable answer.
import type { LineRefusal } from '../types.ts';

/** A server answer that is a refusal `{ok: false, sentence}` rather than the shape asked for (a refused Apply, which has steps, is an answer). */
export function isRefusal(body: unknown): body is LineRefusal {
  return Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === false && !('steps' in (body as object)) && typeof (body as { sentence?: unknown }).sentence === 'string');
}

/** The sentence of any answer that is not usable, with a fallback. */
export function refusalSentence(body: unknown): string {
  const s = body && typeof body === 'object' ? (body as { sentence?: unknown }).sentence : undefined;
  return typeof s === 'string' && s ? s : 'Cockpit could not do that; nothing was changed.';
}
