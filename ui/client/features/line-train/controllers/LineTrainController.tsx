'use client';

import { ScreenModesController } from '@/features/line-modes';
import { TRAIN_MODES, TRAIN_MODE_DATA } from '../domain/TrainModes';
import { LineTrainPage } from '../pages/LineTrainPage';
import { useLineTrain } from '../hooks/useLineTrain';

/** The Train Line screen (/train): its state from useLineTrain, shown by LineTrainPage, in both modes. */
export function LineTrainController() {
  const screen = useLineTrain();
  return <ScreenModesController provider={TRAIN_MODES} data={TRAIN_MODE_DATA} hood={<LineTrainPage screen={screen} />} />;
}
