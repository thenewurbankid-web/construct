'use client';

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui';
import { CloneTokenField } from './CloneTokenField';
import { StatusLine } from './StatusLine';

type GithubConnectPanelProps = {
  token: ComponentProps<typeof CloneTokenField>;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
};

/** Presentation-only: the connection is set up on this server but not made yet (#638). One button starts it; the
 * pasted-token field stays right below, exactly as it was. */
export function GithubConnectPanel({ token, busy, error, onConnect }: GithubConnectPanelProps) {
  return (
    <div className="clone__github" data-testid="github-connect-panel">
      <p className="hint">Private repository? Connect your GitHub account once instead of pasting a token. Sign-in stays as it is; this is a separate permission you can take back at any time.</p>
      <div className="clone__actions">
        <Button type="button" onClick={onConnect} disabled={busy} data-testid="github-connect">
          Connect GitHub for private repositories
        </Button>
      </div>
      <StatusLine message={error} testId="github-error" />
      <CloneTokenField {...token} />
    </div>
  );
}
