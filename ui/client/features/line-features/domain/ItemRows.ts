import type { FeatureItem, ItemRow } from '../types';

/** "Based on Button", or a plain-English problem when the base is missing or names nothing in the library. */
export function itemBase(item: FeatureItem): { ok: boolean; text: string } {
  const { value, libraryId } = item.base;
  if (libraryId) return { ok: true, text: `Based on ${libraryId.split('/').pop()}` };
  if (value) return { ok: false, text: `Its base "${value}" is not in the library, so pick a library item for it.` };
  return { ok: false, text: 'It has no library base yet, so pick the library item it is based on.' };
}

/** Where an item is edited: a page opens on the Pages screen inside its feature, a component on the Components screen. */
export function itemLink(item: FeatureItem): ItemRow['link'] {
  if (item.kind === 'pages') return { href: `/pages?feature=${encodeURIComponent(item.feature)}&page=${encodeURIComponent(item.id)}`, label: `Open ${item.name} in Pages` };
  if (item.kind === 'components') return { href: '/components', label: `Open ${item.name} in Components` };
  return null;
}
