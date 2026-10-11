// cu2 -- a mock of decide() (line-decide.mjs) for callers' tests and Line mock mode: static only, deterministic, no
// @mx/reason and no model. It answers exactly what the real decider answers with reason not linked, so a caller's test
// against it holds for the real path's fallback. `pick` scripts jev: an index into the checked options (via 'jev').
import { createDecider } from './line-decide.mjs';
import { createMockReason, createMockPicker } from '../line-links/mocks.mjs';

/**
 * A decider over a scripted jev (no model): the same decide() and decideUntilAccepted() as the real one.
 * @param {{ pick?: number | null, jevUp?: boolean }} [script] `pick`: jev's index (null or absent: no jev, static only).
 * @returns {ReturnType<typeof createDecider> & { picker: ReturnType<typeof createMockPicker> | null }}
 */
export function createMockDecide(script = {}) {
  if (script.pick === undefined || script.pick === null) {
    const d = createDecider({ loadReason: async () => ({ module: null, note: 'The reason module is mocked off' }) });
    return { ...d, picker: null };
  }
  const picker = createMockPicker(script.pick, { available: script.jevUp !== false });
  const d = createDecider({ loadReason: async () => ({ module: createMockReason(), note: null }), jev: picker });
  return { ...d, picker };
}
