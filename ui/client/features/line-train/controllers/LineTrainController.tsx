'use client';

import { LineTrainPage } from '../pages/LineTrainPage';
import { useLineTrain } from '../hooks/useLineTrain';

/** The Train Line screen (/train): its state from useLineTrain, shown by LineTrainPage. */
export function LineTrainController() {
  const screen = useLineTrain();
  return <LineTrainPage screen={screen} />;
}
