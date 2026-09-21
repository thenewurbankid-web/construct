// Pure (DOMAIN-001): the filter box of a Browser-pane list. Every word typed must appear in the row's label or
// detail (case-insensitive), in any order, so "shop view" finds "View  features/shop/components/View.tsx".
import type { ListItem } from '../types.ts';

export function filterItems(items: ListItem[], query: string): ListItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const hay = `${item.label} ${item.detail ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "3 of 12" while filtering, "12" otherwise: what the live region under the filter box says. */
export function countText(shown: number, total: number, query: string): string {
  return query.trim() ? `${shown} of ${total}` : String(total);
}
