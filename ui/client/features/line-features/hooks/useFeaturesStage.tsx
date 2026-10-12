'use client';

import { useMemo } from 'react';
import { stageBlocks, stepsFromRows, type StageBlock } from '@/lib/liveStage';
import { featuresPlace } from '../domain/FeaturesPlace';
import { featuresStageParts } from '../domain/FeaturesStage';
import type { LineFeaturesView } from '../types';

type Row = Parameters<typeof stepsFromRows>[0][number];

/** Live stage on Features (chat mode): the open feature, item and part, then the Plan's open steps and its last one. */
export function useFeaturesStage(view: LineFeaturesView, rows: Row[]): StageBlock[] {
  const { feature, item, part, project } = view;
  return useMemo(() => {
    const place = featuresPlace(feature, item, part);
    return stageBlocks(place, project ? featuresStageParts(place, project) : [], stepsFromRows(rows));
  }, [feature, item, part, project, rows]);
}
