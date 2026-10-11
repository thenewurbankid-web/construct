import type { PropValue, RenderProp, RenderPropKind } from '../types';

/** The value a field's raw input stands for, or null when it is not one (an empty or non-numeric number). */
export function propValueFromInput(kind: RenderPropKind, raw: string | boolean): PropValue | null {
  if (kind === 'boolean') return Boolean(raw);
  if (kind === 'number') {
    const text = String(raw).trim();
    const n = Number(text);
    return text !== '' && Number.isFinite(n) ? n : null;
  }
  if (kind === 'string') return String(raw);
  return null;
}

/** The `props` query value for the edits so far, or undefined when there are none. */
export function propsQuery(edits: Record<string, PropValue>): string | undefined {
  return Object.keys(edits).length > 0 ? JSON.stringify(edits) : undefined;
}

/** What a field shows for a prop's value. */
export function inputFor(prop: RenderProp): string | boolean {
  if (prop.kind === 'boolean') return Boolean(prop.value);
  return prop.value === null || prop.value === undefined ? '' : String(prop.value);
}
