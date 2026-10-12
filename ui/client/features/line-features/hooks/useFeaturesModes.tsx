'use client';

import { useLineMode, useScreenDefault } from '@/features/line-modes';
import { crumbTarget, crumbsOf, effectiveMode } from '@/lib/lineModes';
import { FEATURES_MODES } from '../domain/FeaturesProvider';
import { featuresPlace } from '../domain/FeaturesPlace';
import type { Crumb, LineFeaturesView } from '../types';

/** Two modes on Features: the mode (cd1's chat until the person picks), the breadcrumb of the open feature, item and
 * part, and a crumb: Under the hood at exactly that place (the outer levels selected, the inner ones closed). */
export function useFeaturesModes(view: LineFeaturesView) {
  const { stored, setMode } = useLineMode();
  useScreenDefault(FEATURES_MODES.defaultMode);
  const mode = effectiveMode(stored, FEATURES_MODES.defaultMode);
  const crumbs = crumbsOf(FEATURES_MODES, featuresPlace(view.feature, view.item, view.part));
  const onCrumb = (crumb: Crumb) => {
    const target = crumbTarget(crumb);
    const [feature = null, item = null, part = null] = target.place.steps.map((s) => s.id);
    view.choose(feature);
    view.chooseItem(item);
    view.choosePart(part);
    setMode(target.mode);
  };
  return { mode, crumbs, onCrumb };
}
