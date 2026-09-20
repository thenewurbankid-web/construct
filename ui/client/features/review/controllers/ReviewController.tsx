'use client';

import { ProjectGateController } from '@/features/project-gate';
import '../components/review.css';
import '../components/review-findings.css';
import { useReviewRoute } from '../hooks/useReviewRoute';
import { ReviewChangeController } from './ReviewChangeController';
import { ReviewListController } from './ReviewListController';

/** The Review mode screen. `/review` is the list of changes; `/review?base=..&head=..` is one change.
 * Read-only: nothing on this screen posts, pushes or modifies a branch. */
export function ReviewController() {
  const { base, head } = useReviewRoute();
  return (
    <ProjectGateController>
      {base && head ? <ReviewChangeController key={`${base}...${head}`} base={base} head={head} /> : <ReviewListController />}
    </ProjectGateController>
  );
}
