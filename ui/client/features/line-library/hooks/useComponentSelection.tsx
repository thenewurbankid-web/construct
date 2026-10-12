'use client';

import { useEffect, useState } from 'react';
import { componentPlace } from '../domain/ComponentsChat';

export type ComponentSelection = { feature: string | null; component: string | null };

const NONE: ComponentSelection = { feature: null, component: null };

/** Two modes, Under the hood: the feature and component the URL selects (?feature=, ?component=, the Components chat's
 * levels), read once after mount (the two-modes frame remounts this view when the chat or a crumb moves). The selected
 * feature is scrolled into view. */
export function useComponentSelection(): ComponentSelection {
  const [selected, setSelected] = useState<ComponentSelection>(NONE);
  useEffect(() => setSelected(componentPlace(window.location.search)), []);
  useEffect(() => {
    if (!selected.feature) return;
    const el = document.querySelector('[data-testid="ll-feature"][data-selected="true"]');
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return selected;
}
