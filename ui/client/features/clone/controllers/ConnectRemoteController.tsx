'use client';

import { urlProblem } from '../domain/CloneUrl';
import { useRemote } from '../hooks/useRemote';
import { ConnectRemotePage } from '../pages/ClonePage';

/** "Connect a remote" for the open project (composed as a slot by the Settings screen). */
export function ConnectRemoteController() {
  const r = useRemote();
  const s = r.state;
  return (
    <ConnectRemotePage
      loaded={s.loaded}
      repo={s.repo}
      connected={s.connected}
      current={s.current}
      url={s.url}
      urlHint={urlProblem(s.url)}
      busy={s.busy}
      error={s.error}
      onUrl={r.setUrl}
      onConnect={r.connect}
    />
  );
}
