// Pure (DOMAIN-001): what a failure says and what to do next (#318). Every failure states what happened in
// plain words and offers a next action; a raw error code alone is never the message. The `code` is the
// server's or engine's; anything unknown still gets a retry and a way back.
import type { FailureAction, FailureView } from '../types.ts';

const RETRY_BACK: FailureAction[] = ['retry', 'list'];

export function describeFailure(code: string | null | undefined, message: string | null | undefined): FailureView {
  const detail = message?.trim() || '';
  switch (code) {
    case 'NOT_A_GIT_REPO':
      return { title: 'This project is not a git repository', what: 'Review compares two commits, so it needs git history. The current project directory is not inside a git repository.', next: 'Run git init and commit your work, or pick a different project in Settings.', actions: ['settings', 'retry'] };
    case 'NO_PROJECT':
      return { title: 'No Construct project is open', what: 'Review reads the current project, and none is selected or it has no architecture.yml.', next: 'Pick a project in Settings, then come back here.', actions: ['settings', 'retry'] };
    case 'BAD_REF':
    case 'REF_NOT_FOUND':
      return { title: 'That branch is not in this project', what: detail || 'The branch you asked for does not exist here (it may have been deleted or renamed).', next: 'Go back to the list and pick one of the branches shown.', actions: ['list', 'retry'] };
    case 'BAD_PLAN':
      return { title: 'That plan is not saved in this project', what: detail || 'The plan you picked is not one of this project\'s saved plans (it may have been removed).', next: 'Review without a plan, or pick one of the saved plans.', actions: ['no-plan', 'list'] };
    case 'TIMEOUT':
      return { title: 'The analysis took too long and was stopped', what: `${detail || 'The analysis ran past its time limit and was stopped.'} Nothing was changed in your repository.`, next: 'Try again. If it keeps happening, review a smaller change or compare against a nearer base branch.', actions: RETRY_BACK };
    case 'GIT_FAILED':
    case 'CHECKOUT_FAILED':
      return { title: 'Git could not read this change', what: `${detail || 'Git failed while reading the two commits.'} Nothing was changed in your repository.`, next: 'Check that the repository is healthy (git status, git fsck), then try again.', actions: RETRY_BACK };
    case 'PROJECT_NOT_AT_HEAD':
      return { title: 'The project is not on that branch', what: detail || 'The project directory does not exist on the branch being reviewed.', next: 'Pick another branch, or compare against a base that has the project.', actions: ['list', 'retry'] };
    case 'WORKER_FAILED':
      return { title: 'The analysis stopped unexpectedly', what: `${detail || 'The analysis process ended before it produced a result.'} Nothing was changed in your repository.`, next: 'Try again.', actions: RETRY_BACK };
    default:
      return { title: 'This change could not be analysed', what: detail || 'Something went wrong while analysing this change. Nothing was changed in your repository.', next: 'Try again, or go back to the list and pick another change.', actions: RETRY_BACK };
  }
}
