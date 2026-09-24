'use client';

import { Button } from '@/components/ui';
import type { GithubPanelView } from '../types';
import { StatusLine } from './StatusLine';

type GithubConnectionRowProps = {
  view: GithubPanelView;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
};

const WHEN_CONNECTED = 'Clones can use your GitHub login instead of a pasted token. Nothing is saved: the connection lives in the server’s memory and ends when you sign out, disconnect or the server stops.';
const WHEN_NOT = 'Connect once to clone private repositories with your GitHub login instead of a pasted token.';

/** Presentation-only: whether the Cockpit is connected to GitHub for private repositories (#638), and for which
 * account, with Connect / Disconnect. Composed as a slot on the Settings screen. Renders nothing at all when the
 * feature is not set up on this server. */
export function GithubConnectionRow({ view, busy, error, onConnect, onDisconnect }: GithubConnectionRowProps) {
  if (!view.visible) return null;
  const connected = view.connected;
  return (
    <section className="clone" aria-labelledby="github-heading" data-testid="github-connection">
      <h2 id="github-heading" className="clone__heading">GitHub for private repositories</h2>
      <p className="hint" data-testid="github-summary">{`${view.summary}. ${connected ? WHEN_CONNECTED : WHEN_NOT}`}</p>
      <div className="clone__actions">
        <Button type="button" onClick={connected ? onDisconnect : onConnect} disabled={busy} data-testid={connected ? 'settings-github-disconnect' : 'settings-github-connect'}>
          {connected ? 'Disconnect GitHub' : 'Connect GitHub for private repositories'}
        </Button>
      </div>
      <StatusLine message={error} testId="settings-github-error" />
    </section>
  );
}
