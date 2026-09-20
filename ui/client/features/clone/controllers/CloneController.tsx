'use client';

import { buildJobView, suggestFolderName, urlProblem } from '../domain/CloneWording';
import { useClone } from '../hooks/useClone';
import { ClonePage } from '../pages/ClonePage';

/** The "Clone a repository" form. `onCloned` receives the absolute folder of the finished clone; the caller
 * (the Open-a-project screen) opens it. */
export function CloneController({ onCloned }: { onCloned: (dir: string) => void }) {
  const c = useClone(onCloned);
  const { url, name, starting, job, error } = c.state;
  return (
    <ClonePage
      url={url}
      name={name}
      urlHint={urlProblem(url)}
      suggestedName={suggestFolderName(url)}
      busy={starting}
      error={error}
      job={job ? buildJobView(job) : null}
      onUrl={c.setUrl}
      onName={c.setName}
      onStart={c.start}
      onCancel={c.cancel}
      onDismiss={c.dismiss}
    />
  );
}
