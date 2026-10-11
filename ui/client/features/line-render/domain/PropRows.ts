import type { RenderProp, RenderPropRowView } from '../types';
import { inputFor } from './PropInput.ts';

/** The prop's value as plain text for its row. */
export function valueText(prop: RenderProp): string {
  if (prop.value === null || prop.value === undefined) return 'no sample value';
  if (prop.kind === 'boolean') return prop.value ? 'yes' : 'no';
  return typeof prop.value === 'string' ? `"${prop.value}"` : JSON.stringify(prop.value);
}

/** One row per prop: what its field shows (the person's input once they typed one) and its value as text. */
export function propRows(props: RenderProp[], inputs: Record<string, string | boolean>): RenderPropRowView[] {
  return props.map((prop) => ({ prop, input: prop.name in inputs ? inputs[prop.name] : inputFor(prop), text: valueText(prop) }));
}
