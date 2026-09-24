// Pure (DOMAIN-001): the repository picker's entries and what is selected (#638).
import type { GithubRepo, RepoOption } from '../types.ts';

/** The address the clone form gets when a repository is picked. */
export const repoAddress = (fullName: string): string => `https://github.com/${fullName}`;

/** The picker's entries, in the order the server sent them. */
export function repoOptions(repos: GithubRepo[]): RepoOption[] {
  return repos.map((r) => ({ value: r.fullName, label: r.private ? `${r.fullName} (private)` : r.fullName }));
}

/** The picker's value for the address typed in the form, so the picker shows what is selected ('' when it is none of them). */
export function pickedRepo(input: string, repos: GithubRepo[]): string {
  const t = input.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  return repos.find((r) => t === repoAddress(r.fullName) || t === r.fullName)?.fullName ?? '';
}
