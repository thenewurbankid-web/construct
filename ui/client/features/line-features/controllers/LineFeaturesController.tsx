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

type Screen = ReactElement<{ stage?: ReactNode }>;

/** A Line project's Features screen. The plan and the chat's state live here, above the route's screen (and its
 * project gate), so a re-render or remount of the screen never loses the conversation. */
function LineScreen({ view, screen }: { view: LineFeaturesView; screen: Screen }) {
  const plan = useLinePlan(view.reload);
  const chat = useFeatureChat(view, isLineMock() ? mockAddStep : plan.addStep);
  return <FeaturesScreenPage phase="line" screen={screen} stage={<FeaturesSwitchPage view={view} chat={chat} plan={<LinePlanController plan={plan} />} />} />;
}

/** cd1: the Features screen (`/`, `/plan`). `screen` is the route's Features screen element (it takes a `stage` prop):
 * a Line project gets the Line chat as its stage (Features as a full-screen chat; a picked feature opens its page with
 * the chat beside it); while the project is read, and for any other project, the screen stays as it is. */
export function LineFeaturesController({ screen }: { screen: Screen }) {
  const { phase, view } = useLineFeatures();
  return <FeaturesScreenPage phase={phase} screen={screen} line={<LineScreen view={view} screen={screen} />} />;
}
