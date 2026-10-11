// Pure (DOMAIN-001): edit form values and question options.
import { EDITABLE } from './AgentLabels.ts';
import type { ImportAgentQuestion, ImportAgentStep } from '../types.ts';

/** An edit form's values as step args: features become a list; empty fields are left out. */
export function editArgs(tool: string, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key } of EDITABLE[tool] ?? []) {
    const v = (values[key] ?? '').trim();
    if (!v) continue;
    out[key] = key === 'features' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
  }
  return out;
}

/** The value an edit field starts with. */
export function editValue(step: Pick<ImportAgentStep, 'args'>, key: string): string {
  const v = step.args[key];
  return Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '';
}

/** A question's options, recommended first. */
export function orderedOptions(q: ImportAgentQuestion): { id: string; sentence: string; recommended: boolean }[] {
  const rec = q.options.filter((o) => o.id === q.recommended);
  const rest = q.options.filter((o) => o.id !== q.recommended);
  return [...rec, ...rest].map((o) => ({ ...o, recommended: o.id === q.recommended }));
}
