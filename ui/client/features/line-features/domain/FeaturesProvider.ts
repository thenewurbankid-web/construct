// Two modes: the Features screen's provider (lib/lineModes.ts), built from FeaturesModes.ts. Pure.
import type { ScreenChatProvider } from '../types';
import { featuresAnswer, featuresIntro, featuresOptions, type FeaturesModeData } from './FeaturesModes.ts';

/** The Features screen's provider (cd1's chat first: Features opens in chat mode until the person picks a mode). */
export const FEATURES_MODES: ScreenChatProvider<FeaturesModeData> = {
  screen: 'features',
  label: 'Features',
  href: '/',
  params: ['feature', 'item', 'part'],
  defaultMode: 'chat',
  options: (place, data) => featuresOptions(place, data),
  answer: featuresAnswer,
  intro: featuresIntro,
};
