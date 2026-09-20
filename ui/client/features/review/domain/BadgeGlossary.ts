// Pure (DOMAIN-001): the Tools pane of the list, "What the badges mean". Plain language, and where each
// number comes from, so a badge is never a mystery. Mirrors docs/pr-health.md.
import type { GlossaryEntry } from '../types.ts';

export const GLOSSARY: GlossaryEntry[] = [
  { id: 'scope', badge: 'Scope 1 → 3', tone: 'danger', means: 'The plan declared one feature; the change touches three.', from: 'The plan’s declared files and features against the features the changed files belong to.' },
  { id: 'rules', badge: 'Rule regressions', tone: 'danger', means: 'Your project rules pass on the base branch and fail on this one.', from: 'Runs construct validate on both commits and subtracts. Violations that were already there are never counted.' },
  { id: 'unexplained', badge: 'Unexplained', tone: 'warn', means: 'Changed files with no import path to the rest of the change.', from: 'The impact analysis, walked through feature public indexes.' },
  { id: 'public', badge: 'Public API', tone: 'warn', means: 'A feature’s public index.ts changed, so other features are affected.', from: 'Exports before and after, plus the impact warning PUBLIC-API.' },
  { id: 'flow', badge: 'Flow changed', tone: 'info', means: 'A workflow can now reach different outcomes than before.', from: 'The workflow narrator’s scenarios, compared between the two commits.' },
  { id: 'noplan', badge: 'No plan', tone: 'neutral', means: 'Nothing was declared up front, so scope is not measured.', from: 'Normal for hand-written work. It is not a problem and not a warning; every other check still runs.' },
  { id: 'nothing', badge: 'Nothing found', tone: 'ok', means: 'Every measured check came back clear.', from: 'A positive result, not an empty cell.' },
];
