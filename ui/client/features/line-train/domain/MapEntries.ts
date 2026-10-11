import type { TrainChoices } from '../types';

const KIND: Record<string, string> = { feature: 'a feature', library: 'a library item', item: 'a feature item', finding: 'a problem', text: 'a word' };

/** The world's domain map for the collapsed Details: each name, what kind of thing it is, its words and synonyms. */
export function mapEntries(c: TrainChoices | null): { label: string; entries: { ref: string; type: string; name: string; words: string; synonyms: string }[] } {
  if (!c) return { label: '', entries: [] };
  return {
    label: `How Line reads names in ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}`,
    entries: c.map.filter((e) => e.type !== 'finding').map((e) => ({ ref: e.ref, type: KIND[e.type] ?? e.type, name: e.name, words: e.words.join(', '), synonyms: e.synonyms.join(', ') || 'none' })),
  };
}
