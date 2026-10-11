// Pure (DOMAIN-001): which lit controls sit on this screen, and which need a link to another screen.
import { SCREENS, isOnScreen } from './TraceScreens.ts';
import type { ElsewhereLink, LineScreen, LitControl, PlanStepView, TraceLights, TraceMatch, TraceRequest, TraceScreen } from '../types.ts';

/** The match's controls split into this screen's (lit in place) and other screens' (a link each). */
export function lightsFor(match: TraceMatch | null, here: TraceScreen): TraceLights {
  if (!match) return { here: [], elsewhere: [] };
  const lit: LitControl[] = [];
  const away = new Map<LineScreen, string[]>();
  for (const tool of match.tools) {
    for (const c of tool.controls) {
      if (isOnScreen(c.screen, here)) lit.push({ controlId: c.controlId, target: c.target, kind: tool.from, label: c.target ? `${c.label} (${c.target})` : c.label });
      else if (tool.from === 'request') away.set(c.screen, [...(away.get(c.screen) ?? []), c.label]);
    }
  }
  const elsewhere: ElsewhereLink[] = [...away.entries()].map(([screen, labels]) => ({ screen, title: SCREENS[screen].title, href: SCREENS[screen].href, labels: [...new Set(labels)] }));
  return { here: lit, elsewhere };
}

/** The open plan steps, as the trace call takes them. */
export function stepsForTrace(steps: PlanStepView[]): NonNullable<TraceRequest['steps']> {
  return steps.filter((s) => s.state === 'waiting' || s.state === 'needs-you' || s.state === 'needs-fix').map((s) => ({ id: s.id, n: s.n, tool: s.tool, state: s.state }));
}

/** The Trace bar's sentence when there is no match yet. */
export function idleSentence(trace: boolean, auto: boolean): string {
  if (!trace && !auto) return 'Trace and Auto are off.';
  return 'Type what you want to do, and Trace lights up the controls that do it.';
}
