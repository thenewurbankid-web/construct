import type { ReactNode } from 'react';
import type { FeatureChatView, LineFeaturesView } from '../types';
import { LineFeaturesPage } from './LineFeaturesPage';

type FeaturesSwitchPageProps = { view: LineFeaturesView; chat: FeatureChatView; plan: ReactNode };

/** The Line Features stage (a Line project only): the chat entry, with the open feature's page and its Plan panel. */
export function FeaturesSwitchPage({ view, chat, plan }: FeaturesSwitchPageProps) {
  if (!view.feature) return <LineFeaturesPage view={view} chat={chat} />;
  return <LineFeaturesPage view={view} chat={chat} plan={plan} />;
}
