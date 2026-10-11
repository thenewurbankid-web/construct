'use client';

import { useMemo, useState } from 'react';
import { lineTrainApi } from '../services/LineTrainApi';
import { scoreLines } from '../domain/ScoreLines';
import { mapEntries } from '../domain/MapEntries';
import { caseView } from '../domain/CaseViews';
import type { TrainHttp, TrainScreen } from '../types';
import { useScoreboard } from './useScoreboard';
import { useReviewQueue } from './useReviewQueue';
import { useTrainWorld } from './useTrainWorld';
import { useTeach } from './useTeach';

/** Everything Train Line shows and does: Claude's cases to review, a request to teach, the scoreboard, the domain map.
 * One error sentence at a time; nothing here touches the open project. */
export function useLineTrain(api: TrainHttp = lineTrainApi): TrainScreen {
  const [error, setError] = useState<string | null>(null);
  const board = useScoreboard(api, setError);
  const queue = useReviewQueue(api, board.reload, setError);
  const world = useTrainWorld(api, setError);
  const teach = useTeach(api, world, board.reload, setError);
  const score = useMemo(() => ({ ...scoreLines(board.board), run: () => void board.run(), running: board.running }), [board]);
  const map = useMemo(() => mapEntries(world.choices), [world.choices]);
  return {
    error,
    busy: queue.review.busy || board.running,
    queue: { cases: queue.cases.map(caseView), total: queue.total, open: queue.open, more: queue.more, review: queue.review },
    teach, score, map,
  };
}
