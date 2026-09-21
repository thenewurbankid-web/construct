'use client';

import { branchProblem, describeSource, folderNameProblem, normalizeCloneInput, tokenProblem } from '../domain/CloneInput';
import { buildJobView } from '../domain/CloneJobView';
import { useClone } from '../hooks/useClone';
import { useRecentClones } from '../hooks/useRecentClones';
import { ClonePage, RecentClonesPage } from '../pages/ClonePage';

const whenOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** The "Clone a repository" form, with the recent clones of this browser. `onCloned` receives the absolute folder
 * of a finished clone (and of a recent one that is opened); the caller (the Open-a-project screen) opens it. */
export function CloneController({ onCloned, workspaceRoot = null }: { onCloned: (dir: string) => void; workspaceRoot?: string | null }) {
  const c = useClone(onCloned);
  const recent = useRecentClones();
  const { input, name, branch, token, starting, job, error } = c.state;
  const read = input.trim() === '' ? null : normalizeCloneInput(input);
  const parsed = read && read.ok ? read : null;
  const effectiveBranch = branch ?? parsed?.branch ?? '';
  const rows = recent.state.items.map((r) => {
    const pull = recent.state.pulls[r.name];
    const res = pull?.result ?? null;
    return {
      id: r.id, name: r.name, url: r.url, when: whenOf(r.at), isPrivate: r.private,
      pulling: !!pull?.busy,
      pullMessage: res ? (res.ok ? `${res.message}${res.detail.length ? ` ${res.detail.join(' ')}` : ''}` : res.error) : null,
      pullOk: !!res && res.ok,
    };
  });
  const dirOf = (id: string) => recent.state.items.find((r) => r.id === id);
  return (
    <ClonePage
      input={input}
      name={name}
      branch={effectiveBranch}
      token={token}
      inputProblem={read && !read.ok ? read.problem : null}
      preview={parsed ? { url: parsed.url, folder: parsed.slug, branch: parsed.branch, how: describeSource(parsed.source), note: parsed.note } : null}
      workspaceRoot={workspaceRoot}
      folderProblem={folderNameProblem(name)}
      branchProblem={branchProblem(effectiveBranch)}
      tokenProblem={tokenProblem(token)}
      busy={starting}
      error={error}
      job={job ? buildJobView(job) : null}
      recent={
        <RecentClonesPage
          rows={rows}
          onOpen={(id) => { const r = dirOf(id); if (r) onCloned(r.dir); }}
          onPull={(id) => { const r = dirOf(id); if (r) recent.pull(r.name, token); }}
          onForget={recent.forget}
        />
      }
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
