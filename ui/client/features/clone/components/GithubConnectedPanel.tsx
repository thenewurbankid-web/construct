'use client';

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui';
import type { CloneAuthMode } from '../types';
import { CloneTokenField } from './CloneTokenField';
import { GithubRepoPicker } from './GithubRepoPicker';
import { StatusLine } from './StatusLine';

type GithubConnectedPanelProps = {
  login: string | null;
  mode: CloneAuthMode;
  token: ComponentProps<typeof CloneTokenField>;
  picker: ComponentProps<typeof GithubRepoPicker>;
  busy: boolean;
  error: string | null;
  onMode: (mode: CloneAuthMode) => void;
  onDisconnect: () => void;
};

/** Presentation-only: GitHub is connected (#638). "Use my GitHub login" is the default, with a picker of the
 * repositories the connection can read; "Paste an access token instead" keeps the token field as the fallback; and
 * Disconnect takes the connection away at once. */
export function GithubConnectedPanel({ login, mode, token, picker, busy, error, onMode, onDisconnect }: GithubConnectedPanelProps) {
  const asLogin = mode === 'login';
  const sign = login ? ` (${login})` : '';
  return (
    <fieldset className="clone__github" data-testid="github-connected-panel">
      <legend>Private repository</legend>
      <label className="clone__choice">
        <input type="radio" name="clone-auth" checked={asLogin} onChange={() => onMode('login')} data-testid="clone-auth-login" />
        <span>{`Use my GitHub login${sign}`}</span>
      </label>
      <label className="clone__choice">
        <input type="radio" name="clone-auth" checked={!asLogin} onChange={() => onMode('token')} data-testid="clone-auth-token" />
        <span>Paste an access token instead</span>
      </label>
      {asLogin ? <GithubRepoPicker {...picker} /> : <CloneTokenField {...token} />}
      <div className="clone__actions">
        <Button type="button" variant="ghost" onClick={onDisconnect} disabled={busy} data-testid="github-disconnect">
          Disconnect GitHub
        </Button>
      </div>
      <StatusLine message={error} testId="github-error" />
    </fieldset>
  );
}
