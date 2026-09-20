// The two things a user can actively ask commit-on-save to do (#283): answer the dirty-tree
// question, and commit what is pending without waiting for the window.
import { postJson } from '@/lib/http';
import type { DirtyAnswer } from '../types';

/** Answer "carry onto this session's branch, or stash?". `remember` keeps the answer per project. */
export const answerDirtyTree = (answer: DirtyAnswer, remember: boolean) =>
  postJson<{ ok: boolean; error?: string }>('/api/git/dirty-answer', { answer, remember });

/** Commit what is pending now — the Commit button in `manual`, and "don't wait" in `coalesce`. */
export const commitNow = () => postJson<{ ok: boolean; error?: string }>('/api/git/commit', {});
