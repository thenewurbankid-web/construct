import type { ReactNode } from 'react';
import type { FeatureChatView, LineFeaturesView } from '../types';
import { LineFeaturesPage } from './LineFeaturesPage';

type FeaturesSwitchPageProps = { view: LineFeaturesView; chat: FeatureChatView; plan: ReactNode; workflows?: ReactNode; trace?: ReactNode };

/** The Line Features stage (a Line project only): the chat entry, with the open feature's page and its Plan panel. */
export function FeaturesSwitchPage({ view, chat, plan, workflows = null, trace = null }: FeaturesSwitchPageProps) {
  if (!view.feature) return <LineFeaturesPage view={view} chat={chat} trace={trace} />;
  return <LineFeaturesPage view={view} chat={chat} plan={plan} workflows={workflows} trace={trace} />;
}
