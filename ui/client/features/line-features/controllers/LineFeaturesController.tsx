'use client';

import type { ReactElement, ReactNode } from 'react';
import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { isLineMock } from '@/lib/lineMode';
import { useFeatureChat } from '../hooks/useFeatureChat';
import { useLineFeatures } from '../hooks/useLineFeatures';
import { FeaturesScreenPage } from '../pages/FeaturesScreenPage';
import { FeaturesSwitchPage } from '../pages/FeaturesSwitchPage';
import { mockAddStep } from '../services/LineFeaturesApi';
import type { LineFeaturesView } from '../types';

/** The Line stage, mounted only for a Line project: the plan (writes wait for approval there) and the chat. */
function LineChatStage({ view }: { view: LineFeaturesView }) {
  const plan = useLinePlan(view.reload);
  const chat = useFeatureChat(view, isLineMock() ? mockAddStep : plan.addStep);
  return <FeaturesSwitchPage view={view} chat={chat} plan={<LinePlanController plan={plan} />} />;
}

/** cd1: the Features screen (`/`, `/plan`). `screen` is the route's Features screen element (it takes a `stage` prop):
 * a Line project gets the Line chat stage in it (Features as a full-screen chat; a picked feature opens its page with
 * the chat beside it); while the project is read, and for any other project, the screen stays as it is. */
export function LineFeaturesController({ screen }: { screen: ReactElement<{ stage?: ReactNode }> }) {
  const { phase, view } = useLineFeatures();
  return <FeaturesScreenPage phase={phase} screen={screen} stage={<LineChatStage view={view} />} />;
}
