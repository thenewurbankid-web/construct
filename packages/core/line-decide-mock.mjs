// cu2 -- a mock of decide() (line-decide.mjs) for callers' tests and Line mock mode: deterministic, no @mx/reason and no
// model. Without `pick` it answers exactly what the real decider answers with reason not linked, so a caller's test
// against it holds for the real path's fallback. `pick` scripts the picker (jev, until Line-1 ships): an index into the
// checked options (via 'jev'); `on` turns steps on (with a measured win) in a copy of the profile set, since a picker
// only runs for a step whose profile is on.
import fs from 'node:fs';
import { createDecider } from './line-decide.mjs';
import { PROFILES_FILE } from './ai-profiles.mjs';
import { createMockReason, createMockPicker } from '../line-links/mocks.mjs';

/**
 * Line's profile set with `steps` turned on (each with a test measurement), for a test's decider or repair loop.
 * @param {string[]} steps Step ids to turn on.
 * @returns {{ data: any, traceConfig: null }} Options for stepProfile / createDecider's `profiles` / repairLoop's `profiles`.
 */
export function profilesWithOn(steps) {
  const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  for (const p of data.profiles) if (steps.includes(p.step)) p.ladder = { ...p.ladder, options: { ...p.ladder.options, on: true }, measured: p.ladder.measured ?? 'test: turned on by the mock' };
  return { data, traceConfig: null };
}

/**
 * A decider over a scripted picker (no model): the same decide() as the real one.
 * @param {{ pick?: number | null, jevUp?: boolean, on?: string[] }} [script] `pick`: the picker's index (null or absent:
 *   no picker, static only); `on`: steps to turn on (default: those already on in ai-profiles.json).
 * @returns {ReturnType<typeof createDecider> & { picker: ReturnType<typeof createMockPicker> | null }}
 */
export function createMockDecide(script = {}) {
  const profiles = script.on ? profilesWithOn(script.on) : undefined;
  if (script.pick === undefined || script.pick === null) {
    const d = createDecider({ loadReason: async () => ({ module: null, note: 'The reason module is mocked off' }), profiles });
    return { ...d, picker: null };
  }
  const picker = createMockPicker(script.pick, { available: script.jevUp !== false });
  const d = createDecider({ loadReason: async () => ({ module: createMockReason(), note: null }), jev: picker, profiles });
  return { ...d, picker };
}
