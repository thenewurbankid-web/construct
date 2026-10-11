// Pure (DOMAIN-001): what the Trace bar says about a match, line by line, so its components only show text.
import type { FindingsView, TraceLights, TraceMatch } from '../types.ts';

const NONE: FindingsView = { choice: null, litHere: null, elsewhere: [], missing: null, details: [] };

/** The Trace bar's lines for a match: how a tie was decided, what is lit here, links elsewhere, what Auto needs, Details. */
export function findingsOf(match: TraceMatch | null, lights: TraceLights, showLights: boolean): FindingsView {
  if (!match) return NONE;
  const first = match.tools[0];
  const details = match.tools.map((t) => `${t.toolId}${t.stepId ? ` (step ${t.stepId})` : ''}: ${t.controls.map((c) => c.controlId).join(', ')}`);
  details.push(`Decided by: ${match.via}${match.alternatives.length ? `; also possible: ${match.alternatives.join(', ')}` : ''}`);
  return {
    choice: match.choice?.sentence ?? null,
    litHere: showLights && lights.here.length ? `Lit here: ${lights.here.map((c) => c.label).join(', ')}.` : null,
    elsewhere: showLights ? lights.elsewhere.map((l) => ({ href: l.href, key: l.screen, text: `Go to ${l.title}: ${l.labels.join(', ')} light up there.` })) : [],
    missing: first && first.from === 'request' ? first.missing : null,
    details,
  };
}
