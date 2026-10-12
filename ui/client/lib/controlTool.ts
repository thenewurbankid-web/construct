// Two modes, live stage: which Line tool an element on screen (or a chat sentence naming one) maps to, through the one
// control registry (LINE_CONTROLS: control -> tool). Static only at runtime: the element's own data-line-control first,
// then a unique match of its label against the registered labels (on its screen, when known). Several candidate tools,
// or none, give no tool and one sentence; the decider is recorded.
import type { LineControl } from './lineContract.ts';

export type ToolPoint = { lineControl?: string | null; label?: string | null; screen?: string | null };
export type ToolMatch = { ok: true; toolId: string; controlId: string; by: 'control' | 'label' } | { ok: false; sentence: string; candidates: string[] };

const norm = (s: string) => s.trim().toLowerCase();

export function toolForPoint(point: ToolPoint, controls: readonly LineControl[]): ToolMatch {
  const exact = point.lineControl ? controls.find((c) => c.controlId === point.lineControl) : undefined;
  if (exact) return { ok: true, toolId: exact.toolId, controlId: exact.controlId, by: 'control' };
  const label = point.label ? norm(point.label) : '';
  if (!label) return { ok: false, sentence: 'That is not a Line control, so it maps to no tool.', candidates: [] };
  const named = controls.filter((c) => norm(c.label) === label && (!point.screen || c.screen === point.screen || c.screen === 'plan' || c.screen === 'shell'));
  const tools = [...new Set(named.map((c) => c.toolId))];
  if (tools.length === 1) return { ok: true, toolId: tools[0], controlId: named[0].controlId, by: 'label' };
  if (tools.length > 1) return { ok: false, sentence: `"${point.label}" could be ${tools.length} tools, so Line does not guess.`, candidates: tools };
  return { ok: false, sentence: `"${point.label}" is not a Line control, so it maps to no tool.`, candidates: [] };
}
