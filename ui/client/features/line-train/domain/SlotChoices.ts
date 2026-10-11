import type { DraftEdit, SlotChoice, TrainChoices } from '../types';

const SLOT_RE = /<([a-z]+):([A-Z][A-Za-z]*\d+)>/g;
const LABEL: Record<string, string> = { feature: 'Feature', library: 'Library item', item: 'Feature item', finding: 'Problem', name: 'New name', text: 'Text', number: 'Number', missing: 'Missing item' };

/** The options a slot of this type can take in this world (closed choices). */
function optionsFor(type: string, kind: string | undefined, c: TrainChoices): { value: string; label: string }[] {
  if (type === 'feature') return c.features.map((f) => ({ value: f.ref, label: f.name }));
  if (type === 'library') return c.library.filter((l) => !kind || l.kind === kind).map((l) => ({ value: l.ref, label: l.name }));
  if (type === 'item') return c.items.filter((i) => !kind || i.kind === kind).map((i) => ({ value: i.ref, label: `${i.name} (${i.feature})` }));
  if (type === 'finding') return c.findings.map((f) => ({ value: f.ref, label: f.sentence }));
  return [];
}

/** One closed choice (or typed value) per slot the request names, in the order the request names them. */
export function slotChoices(edit: DraftEdit | null, c: TrainChoices | null, values: Record<string, string>): SlotChoice[] {
  if (!edit || !c) return [];
  const names = [...new Set([...edit.request.matchAll(SLOT_RE)].map((m) => m[2]))];
  return names.filter((n) => edit.slots[n]).map((n) => {
    const s = edit.slots[n];
    const options = s.ref ? optionsFor(s.type, s.kind, c) : [];
    const kind: SlotChoice['kind'] = options.length ? 'pick' : s.type === 'number' ? 'number' : 'text';
    return { name: n, label: LABEL[s.type] ?? s.type, kind, current: options.length ? String(s.ref) : values[n] ?? '', options };
  });
}
