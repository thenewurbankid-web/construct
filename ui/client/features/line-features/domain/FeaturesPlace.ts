// Two modes: where the person is on Features, as a lib/lineModes.ts Place (feature › item › part). Pure.
import type { Place, PlaceStep } from '../types';

export function featuresPlace(feature: string | null, item: string | null, part: string | null): Place {
  const steps: PlaceStep[] = [];
  const levels: [string, string | null][] = [['feature', feature], ['item', item], ['part', part]];
  for (const [param, id] of levels) {
    if (!id) break;
    steps.push({ param, id, label: id });
  }
  return { screen: 'features', steps };
}
