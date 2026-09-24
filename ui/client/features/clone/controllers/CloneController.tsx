'use client';

import { branchProblem, folderNameProblem, tokenProblem } from '../domain/CloneFieldHints';
import { buildRecentRows, readCloneForm } from '../domain/CloneFormView';
import { buildJobView } from '../domain/CloneJobView';
import { effectiveAuthMode, githubPanelView } from '../domain/GithubConnection';
import { pickedRepo, repoOptions } from '../domain/GithubRepoPick';
import { reposHint } from '../domain/GithubRepoPages';
import { useClone } from '../hooks/useClone';
import { useGithubConnection } from '../hooks/useGithubConnection';
import { useRecentClones } from '../hooks/useRecentClones';
import { ClonePage } from '../pages/ClonePage';
import { RecentClonesPage } from '../pages/RecentClonesPage';

/** The "Clone a repository" form, with the recent clones of this browser. `onCloned` receives the absolute folder
 * of a finished clone (and of a recent one that is opened); the caller (the Open-a-project screen) opens it.
 * #638: when the server has a GitHub connection set up, a private repository can use the person's GitHub login
 * (the default once connected, with a picker of their repositories) instead of the pasted token. */
export function CloneController({ onCloned, workspaceRoot = null }: { onCloned: (dir: string) => void; workspaceRoot?: string | null }) {
  const gh = useGithubConnection({ withRepos: true });
  const c = useClone(onCloned, gh.state.status);
  const recent = useRecentClones(onCloned);
  const { input, name, token, starting, job, error } = c.state;
  const reading = readCloneForm(input, c.state.branch);
  const mode = effectiveAuthMode(gh.state.status, c.state.authChoice);
  return (
    <ClonePage
      input={input}
      name={name}
      branch={reading.branch}
      inputProblem={reading.inputProblem}
      preview={reading.preview}
      workspaceRoot={workspaceRoot}
      folderProblem={folderNameProblem(name)}
      branchProblem={branchProblem(reading.branch)}
      auth={{
        view: githubPanelView(gh.state.status),
        mode,
        token,
        tokenProblem: tokenProblem(token),
        picker: {
          options: repoOptions(gh.state.repos),
          picked: pickedRepo(input, gh.state.repos),
          query: gh.state.query,
          loading: gh.state.reposLoading,
          hasMore: gh.state.list?.hasMore === true,
          hint: reposHint(gh.state.list, gh.state.query, gh.state.reposError),
          onPick: c.pickRepo,
          onQuery: gh.setQuery,
          onMore: gh.more,
          onReload: gh.reload,
        },
        busy: gh.state.busy || starting,
        error: gh.state.error,
        onToken: c.setToken,
        onMode: c.setAuthMode,
        onConnect: gh.connect,
        onDisconnect: gh.disconnect,
      }}
      busy={starting}
      error={error}
      job={job ? buildJobView(job) : null}
      recent={<RecentClonesPage rows={buildRecentRows(recent.state.items, recent.state.pulls)} onOpen={recent.open} onPull={(id) => recent.pull(id, token, mode === 'login')} onForget={recent.forget} />}
      onInput={c.setInput}
      onName={c.setName}
      onBranch={c.setBranch}
      onStart={c.start}
      onCancel={c.cancel}
      onDismiss={c.dismiss}
    />
  );
}
