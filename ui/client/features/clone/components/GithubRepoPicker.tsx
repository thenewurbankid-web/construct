'use client';

import { Button, Field, Input, Select } from '@/components/ui';
import type { RepoOption } from '../types';
import { RepoOptions } from './RepoOptions';

type GithubRepoPickerProps = {
  options: RepoOption[];
  /** The option matching the address typed in the form, or ''. */
  picked: string;
  query: string;
  loading: boolean;
  hasMore: boolean;
  /** Why the list is empty or could not be filled, in plain words, or null. */
  hint: string | null;
  disabled: boolean;
  onPick: (fullName: string) => void;
  onQuery: (q: string) => void;
  onMore: () => void;
  onReload: () => void;
};

/** Presentation-only: the repositories the GitHub connection can read (names and visibility only), a filter, and a
 * list to pick one from. Picking fills the repository address of the form; nothing is cloned until "Clone and open". */
export function GithubRepoPicker({ options, picked, query, loading, hasMore, hint, disabled, onPick, onQuery, onMore, onReload }: GithubRepoPickerProps) {
  const empty = options.length === 0;
  return (
    <div className="clone__picker" data-testid="github-repo-picker">
      <Field label="Filter your repositories" hint={hint}>
        <Input
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Type part of a name"
          value={query}
          disabled={disabled}
          onChange={(e) => onQuery(e.target.value)}
          data-testid="github-repo-filter"
        />
      </Field>
      <Field label="Repositories from GitHub" hint={loading ? 'Loading…' : null}>
        <Select value={picked} disabled={disabled || empty} onChange={(e) => onPick(e.target.value)} data-testid="github-repo-select">
          <option value="">{empty ? 'No repositories to show' : 'Choose a repository…'}</option>
          <RepoOptions options={options} />
        </Select>
      </Field>
      <Button type="button" variant="ghost" onClick={onMore} disabled={disabled || loading || !hasMore} data-testid="github-repo-more">
        Show more repositories
      </Button>
      <Button type="button" variant="ghost" onClick={onReload} disabled={disabled || loading} data-testid="github-repo-reload">
        Reload the list
      </Button>
    </div>
  );
}
