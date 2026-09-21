'use client';

import { branchProblem, folderNameProblem, tokenProblem } from '../domain/CloneFieldHints';
import { buildRecentRows, readCloneForm } from '../domain/CloneFormView';
import { buildJobView } from '../domain/CloneJobView';
import { useClone } from '../hooks/useClone';
import { useRecentClones } from '../hooks/useRecentClones';
import { ClonePage } from '../pages/ClonePage';
import { RecentClonesPage } from '../pages/RecentClonesPage';

/** The "Clone a repository" form, with the recent clones of this browser. `onCloned` receives the absolute folder
 * of a finished clone (and of a recent one that is opened); the caller (the Open-a-project screen) opens it. */
export function CloneController({ onCloned, workspaceRoot = null }: { onCloned: (dir: string) => void; workspaceRoot?: string | null }) {
  const c = useClone(onCloned);
  const recent = useRecentClones(onCloned);
  const { input, name, token, starting, job, error } = c.state;
  const reading = readCloneForm(input, c.state.branch);
  return (
    <ClonePage
      input={input}
      name={name}
      branch={reading.branch}
      token={token}
      inputProblem={reading.inputProblem}
      preview={reading.preview}
      workspaceRoot={workspaceRoot}
      folderProblem={folderNameProblem(name)}
      branchProblem={branchProblem(reading.branch)}
      tokenProblem={tokenProblem(token)}
      busy={starting}
      error={error}
      job={job ? buildJobView(job) : null}
      recent={<RecentClonesPage rows={buildRecentRows(recent.state.items, recent.state.pulls)} onOpen={recent.open} onPull={(id) => recent.pull(id, token)} onForget={recent.forget} />}
      onInput={c.setInput}
      onName={c.setName}
      onBranch={c.setBranch}
      onToken={c.setToken}
      onStart={c.start}
      onCancel={c.cancel}
      onDismiss={c.dismiss}
    />
  );
}
