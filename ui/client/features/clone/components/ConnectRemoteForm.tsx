'use client';

import { Button, Field, Input } from '@/components/ui';

type ConnectRemoteFormProps = {
  loaded: boolean;
  /** Is the open project a repository at all? */
  repo: boolean;
  connected: boolean;
  current: string | null;
  url: string;
  urlHint: string | null;
  busy: boolean;
  error: string | null;
  onUrl: (v: string) => void;
  onConnect: () => void;
};

/** Presentation-only "Connect a remote" (#330): shown on Settings for the open project. Connected projects only
 * show where they point; a project with no `origin` gets one address field; a folder that is not a repository
 * says so. */
export function ConnectRemoteForm({ loaded, repo, connected, current, url, urlHint, busy, error, onUrl, onConnect }: ConnectRemoteFormProps) {
  return (
    <section className="clone" aria-labelledby="remote-heading" data-testid="connect-remote">
      <h2 id="remote-heading" className="clone__heading">Connect a remote</h2>
      {!loaded && <p className="hint">Checking the project&apos;s remote…</p>}
      {loaded && !repo && (
        <p className="hint" data-testid="remote-not-repo">
          This project is not a repository yet, so there is nothing to connect. Run <code>git init</code> in it first.
        </p>
      )}
      {loaded && repo && connected && (
        <p className="hint" data-testid="remote-connected">
          Connected: <code>origin</code> is <code>{current}</code>.
        </p>
      )}
      {loaded && repo && !connected && (
        <form
          className="clone__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && !busy) onConnect();
          }}
        >
          <p className="hint">This project has no remote. Give it the https address of the repository it belongs to; nothing is pushed.</p>
          <Field label="Remote address" hint={urlHint}>
            <Input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://github.com/owner/repository"
              value={url}
              disabled={busy}
              onChange={(e) => onUrl(e.target.value)}
              data-testid="remote-url"
            />
          </Field>
          <div className="clone__actions">
            <Button type="submit" disabled={busy || url.trim() === ''} data-testid="remote-connect">
              {busy ? 'Connecting…' : 'Connect remote'}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="status-error" role="alert" data-testid="remote-error">
          {error}
        </p>
      )}
    </section>
  );
}
