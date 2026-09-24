// Pure (DOMAIN-001): "Run this block" is not a new way to run anything. It only builds the ONE step the Plan screen adds
// (the block's own example, tagged with the project's default engine); the Plan screen then validates it and runs it
// through the same Run plan button as every other step, so every check and every guardrail still applies.
import type { BlockRow, BlockRunRequest } from './BlockTypes.ts';

/** What the model box saves: an empty box puts the default model back (the server refuses an empty name). */
export const modelPatch = (text: string): { model: string | null } => ({ model: text.trim() === '' ? null : text.trim() });

/** Can the card offer Run at all? A block the Cockpit never offers, or one that is turned off, cannot be run from it. */
export function runBlocked(row: BlockRow): string | null {
  if (!row.offered) return row.notOffered ?? 'The Cockpit does not offer this block.';
  if (!row.settings.enabled) return 'Turned off for this project.';
  if (!row.example) return 'This block has no example to start from.';
  return null;
}

/**
 * The step to add to the plan for `row`, or null when it cannot be run from here. With the default engine set to AI (only
 * possible on a block that has a model path) the step is tagged "local model" with the one local provider, so the plan
 * says plainly that a model is involved; otherwise it is the plain mechanical example.
 */
export function blockRunRequest(row: BlockRow): BlockRunRequest | null {
  if (runBlocked(row) || !row.example) return null;
  const ai = row.settings.engine === 'ai' && row.engines.includes('ai') && row.settings.provider;
  const { title, flow, executor, args, touches } = row.example;
  return {
    flow,
    title,
    executor: ai ? 'local-model' : executor,
    args: ai ? { ...args, llm: row.settings.provider } : { ...args },
    ...(touches ? { touches } : {}),
  };
}
