// Pure (DOMAIN-001): paging and plain-words hints for the repository picker (#638).
import type { GithubRepo, GithubRepoList } from '../types.ts';

/** Add one more page of repositories to what is shown (page 1 replaces it). */
export function mergeRepoPages(current: GithubRepo[], list: GithubRepoList): GithubRepo[] {
  if (list.page <= 1) return list.repos;
  const have = new Set(current.map((r) => r.fullName));
  return [...current, ...list.repos.filter((r) => !have.has(r.fullName))];
}

/** Plain words when the picker has nothing to offer (or could not be filled), else null. */
export function reposHint(list: GithubRepoList | null, query: string, error: string | null): string | null {
  if (error) return error;
  if (!list) return null;
  if (list.total > 0) return list.truncated ? 'Only the first repositories are listed. Type to narrow the list, or paste an address above.' : null;
  if (query.trim() !== '') return 'No repository matches that.';
  if (list.installations === 0) {
    return 'The Cockpit’s GitHub app is not installed on any repository yet. Install it on the repositories you want to open (an organisation owner has to do this for an organisation’s repositories), then reload this list.';
  }
  return 'The connection cannot see any repository yet. Install the Cockpit’s GitHub app on the repositories you want to open, then reload this list.';
}
