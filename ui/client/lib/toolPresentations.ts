// Two modes, live stage: how a tool call shows on the chat's live stage. The data is generated offline (rules, then jev
// where the rules cannot decide) by packages/tools/tool-presentations/generate.mjs and reviewed: toolPresentations.json.
// At runtime the stage only reads it (no model). This file is its contract: the shapes, the closed options, the check.
import doc from './toolPresentations.json' with { type: 'json' };

export type StageKind = 'feature' | 'page' | 'component' | 'workflow' | 'step' | 'finding';
export type StageOverlay = 'outline' | 'badge' | 'ghost-after' | 'connector';
export type StageFocus = 'self' | 'base' | 'feature' | 'target';
export type UiState = 'loading' | 'empty' | 'error' | 'disabled' | 'filled';

/** One field and who decided it: the rules, or jev (offline) where the rules could not. */
export type Decided<T> = { value: T; by: 'rules' | 'jev' };

export type ToolPresentation = {
  kind: Decided<StageKind>;
  icon: Decided<string>;
  overlay: Decided<StageOverlay>;
  states: Decided<UiState[]>;
  focus: Decided<StageFocus>;
  caption: Decided<string>;
};

export type ToolPresentationDoc = { version: 1; note: string; options: Record<string, string[]>; tools: Record<string, ToolPresentation> };

export const STAGE_KINDS: readonly StageKind[] = ['feature', 'page', 'component', 'workflow', 'step', 'finding'];
const OVERLAYS: readonly StageOverlay[] = ['outline', 'badge', 'ghost-after', 'connector'];
const FOCUSES: readonly StageFocus[] = ['self', 'base', 'feature', 'target'];
export const UI_STATES: readonly UiState[] = ['loading', 'empty', 'error', 'disabled', 'filled'];

const decided = (f: unknown): f is Decided<unknown> => typeof f === 'object' && f !== null && 'value' in f && ((f as Decided<unknown>).by === 'rules' || (f as Decided<unknown>).by === 'jev');

/** The contract's check of the saved file against the registry's tool ids, in plain English (none: []). */
export function presentationProblems(d: { tools: Record<string, unknown> }, toolIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of toolIds) {
    const t = d.tools[id] as Partial<ToolPresentation> | undefined;
    if (!t) {
      out.push(`Tool "${id}" has no presentation; run node packages/tools/tool-presentations/generate.mjs.`);
      continue;
    }
    for (const name of ['kind', 'icon', 'overlay', 'states', 'focus', 'caption'] as const) if (!decided(t[name])) out.push(`Tool "${id}" has no decided ${name}.`);
    if (t.kind && !STAGE_KINDS.includes(t.kind.value)) out.push(`Tool "${id}" has an unknown kind "${t.kind.value}".`);
    if (t.overlay && !OVERLAYS.includes(t.overlay.value)) out.push(`Tool "${id}" has an unknown overlay "${t.overlay.value}".`);
    if (t.focus && !FOCUSES.includes(t.focus.value)) out.push(`Tool "${id}" has an unknown focus "${t.focus.value}".`);
    if (t.states && (!Array.isArray(t.states.value) || t.states.value.some((s) => !UI_STATES.includes(s)))) out.push(`Tool "${id}" has an unknown UI state.`);
    if (t.caption && !/[.?!]$/.test(String(t.caption.value))) out.push(`Tool "${id}"'s caption is not a full sentence.`);
  }
  for (const id of Object.keys(d.tools)) if (!toolIds.includes(id)) out.push(`Presentation "${id}" is for a tool the registry does not have.`);
  return out;
}

const PRESENTATIONS = (doc as ToolPresentationDoc).tools;

/** The saved presentation of one tool, or null for a tool the file does not know. */
export function presentationOf(toolId: string): ToolPresentation | null {
  return PRESENTATIONS[toolId] ?? null;
}
