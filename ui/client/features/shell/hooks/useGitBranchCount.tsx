'use client';

import { useEffect, useState } from 'react';
import { fetchReviewBranches } from '@/features/review';

/** How many branches the Git screen has to review (every local branch except the base), for the badge beside
 * "Git" in the top bar. Read once the project is known and again when the window regains focus. 0 when there
 * is nothing to review or the branches cannot be read (not a repository, no project): the badge then stays
 * hidden rather than saying something false. */
export function useGitBranchCount(projectKnown: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!projectKnown) return undefined;
    let alive = true;
    const read = () =>
      fetchReviewBranches().then((r) => {
        if (alive) setCount(r.ok ? r.data.branches.length : 0);
      });
    read();
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      window.removeEventListener('focus', read);
    };
  }, [projectKnown]);

  return count;
}
