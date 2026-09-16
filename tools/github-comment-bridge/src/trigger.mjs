// The one supported trigger convention (see README): a comment whose FIRST
// LINE is exactly "/claude <instruction text>" (case-sensitive, must start
// the comment). This is deliberately the only pattern supported, so that
// ordinary discussion on an issue never accidentally fires a run.

const TRIGGER_WORD = '/claude';

/**
 * @param {string} commentBody
 * @returns {{ instruction: string } | null}
 */
export function parseTrigger(commentBody) {
  if (typeof commentBody !== 'string') return null;

  const lines = commentBody.split(/\r?\n/);
  const firstLine = lines[0] ?? '';

  const isBareTrigger = firstLine === TRIGGER_WORD;
  const isTriggerWithText = firstLine.startsWith(`${TRIGGER_WORD} `);
  if (!isBareTrigger && !isTriggerWithText) return null;

  const inlineInstruction = isBareTrigger ? '' : firstLine.slice(TRIGGER_WORD.length + 1).trim();
  const remainingLines = lines.slice(1).join('\n').trim();

  const instruction = [inlineInstruction, remainingLines].filter(Boolean).join('\n\n').trim();
  if (!instruction) return null;

  return { instruction };
}
