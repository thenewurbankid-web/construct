import type { ComponentProps, ReactNode } from 'react';
import type { FeatureChatView, LineFeaturesView } from '../types';
import { LineFeaturesPage } from './LineFeaturesPage';

type ModeProps = Pick<ComponentProps<typeof LineFeaturesPage>, 'mode' | 'crumbs' | 'onCrumb'>;
type FeaturesSwitchPageProps = { view: LineFeaturesView; chat: FeatureChatView; plan: ReactNode; workflows?: ReactNode; trace?: ReactNode } & ModeProps;

/** The Line Features stage (a Line project only): the chat entry, with the open feature's page and its Plan panel. */
export function FeaturesSwitchPage({ view, chat, plan, workflows = null, trace = null, ...modes }: FeaturesSwitchPageProps) {
  if (!view.feature) return <LineFeaturesPage view={view} chat={chat} trace={trace} {...modes} />;
  return <LineFeaturesPage view={view} chat={chat} plan={plan} workflows={workflows} trace={trace} {...modes} />;
}
