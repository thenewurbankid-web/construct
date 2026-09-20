// Pure (DOMAIN-001): the scenario sentences the enumerator writes mark a state with *asterisks* and a name with
// `backticks`. Split one into plain / emphasised / code parts so the screen shows them, not the markup.
import type { InlinePart } from '../types.ts';

export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    parts.push(m[1] !== undefined ? { kind: 'em', text: m[1] } : { kind: 'code', text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}
