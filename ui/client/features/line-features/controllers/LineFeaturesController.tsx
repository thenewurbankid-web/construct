'use client';

import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { useLineMode, useScreenDefault } from '@/features/line-modes';
import { LinePlanController, useLinePlan } from '@/features/line-plan';
import { LineTraceController } from '@/features/line-trace';
import { LineWorkflowsTab } from '@/features/line-workflows';
import { isLineMock } from '@/lib/lineMode';
import { crumbTarget, crumbsOf, effectiveMode } from '@/lib/lineModes';
import { FEATURES_MODES } from '../domain/FeaturesModes';
import { featuresPlace } from '../domain/FeaturesPlace';
import { useFeatureChat } from '../hooks/useFeatureChat';
import { useLineFeatures } from '../hooks/useLineFeatures';
import { FeaturesScreenPage } from '../pages/FeaturesScreenPage';
import { FeaturesSwitchPage } from '../pages/FeaturesSwitchPage';
import { mockAddStep } from '../services/LineFeaturesApi';
import type { Crumb, LineFeaturesView } from '../types';

type Screen = ReactElement<{ stage?: ReactNode }>;

/** A Line project's Features screen. The plan and the chat's state live here, above the route's screen (and its
 * project gate), so a re-render or remount of the screen never loses the conversation. The open feature's Workflows tab
 * (cw1) and the Trace bar (cg1/ct1) sit in it too. Two modes: chat (cd1's chat first, the default until the person
 * picks) and Under the hood (the feature cards or the open feature, with the chat as a helper). */
function LineScreen({ view, screen }: { view: LineFeaturesView; screen: Screen }) {
  const [revision, setRevision] = useState(0);
  const { reload } = view;
  const landed = useCallback(() => { reload(); setRevision((r) => r + 1); }, [reload]);
  const plan = useLinePlan(landed);
  const chat = useFeatureChat(view, isLineMock() ? mockAddStep : plan.addStep);
  const { stored, setMode } = useLineMode();
  useScreenDefault(FEATURES_MODES.defaultMode);
  const mode = effectiveMode(stored, FEATURES_MODES.defaultMode);
  const crumbs = crumbsOf(FEATURES_MODES, featuresPlace(view.feature, view.item, view.part));
  // A crumb: Under the hood at exactly that place (the same feature, item and part selected, the rest closed).
  const onCrumb = (crumb: Crumb) => {
    const target = crumbTarget(crumb);
    const [feature, item, part] = target.place.steps.map((s) => s.id);
    view.choose(feature ?? null);
    if (item) view.chooseItem(item);
    if (part) view.choosePart(part);
    setMode(target.mode);
  };
  // One Plan panel per screen: the Workflows tab adds its steps to this screen's plan (the panel beside the chat).
  const workflows = view.feature && view.tab === 'workflows' ? <LineWorkflowsTab key={view.feature} feature={view.feature} addStep={plan.addStep} revision={revision} /> : null;
  const stage = <FeaturesSwitchPage view={view} chat={chat} plan={<LinePlanController plan={plan} />} workflows={workflows} trace={<LineTraceController screen="features" steps={plan.steps} />} mode={mode} crumbs={crumbs} onCrumb={onCrumb} />;
  return <FeaturesScreenPage phase="line" screen={screen} stage={stage} />;
}

/** cd1: the Features screen (`/`, `/plan`). `screen` is the route's Features screen element (it takes a `stage` prop):
 * a Line project gets the Line chat as its stage (Features as a full-screen chat; a picked feature opens its page with
 * the chat beside it); while the project is read the screen stays as it is, and any other project also gets one line
 * offering Import. */
export function LineFeaturesController({ screen }: { screen: Screen }) {
  const { phase, view } = useLineFeatures();
  return <FeaturesScreenPage phase={phase} screen={screen} line={<LineScreen view={view} screen={screen} />} />;
}
