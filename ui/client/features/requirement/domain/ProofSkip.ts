// Pure (DOMAIN-001): the reason a person gives for skipping the proof of a screen (#653).

/** The reason of a skip is a sentence, not a shrug. Mirrors ui/server requirementProofApi.mjs PROOF_REASON (the server refuses the rest again). */
export const PROOF_REASON = { min: 8, max: 200 } as const;

/** The skip reason to send, trimmed, or what is wrong with it: empty, too short, too long or not one line. */
export function skipReasonOf(draft: string): { ok: true; reason: string } | { ok: false; error: string } {
  const text = draft.trim();
  if (!text) return { ok: false, error: 'Give a reason for skipping the proof.' };
  if (/[\r\n]/.test(text)) return { ok: false, error: 'The reason is one line of plain text.' };
  if (text.length < PROOF_REASON.min) return { ok: false, error: `Give a reason of at least ${PROOF_REASON.min} characters, so the skip says why.` };
  if (text.length > PROOF_REASON.max) return { ok: false, error: `Keep the reason to ${PROOF_REASON.max} characters.` };
  return { ok: true, reason: text };
}
