'use client';

import type { ComponentProps } from 'react';
import type { CloneAuthMode, GithubPanelView } from '../types';
import { CloneTokenField } from './CloneTokenField';
import { GithubConnectPanel } from './GithubConnectPanel';
import { GithubConnectedPanel } from './GithubConnectedPanel';
import { GithubRepoPicker } from './GithubRepoPicker';

type TokenProps = ComponentProps<typeof CloneTokenField>;

export type CloneAuthSectionProps = TokenProps & {
  /** The GitHub connection for private repositories (#638). `visible: false` = the feature is off: only the token field shows, exactly as before. */
  view: GithubPanelView;
  mode: CloneAuthMode;
  picker: Omit<ComponentProps<typeof GithubRepoPicker>, 'disabled'>;
  /** Connecting or disconnecting is in flight. */
  busy: boolean;
  error: string | null;
  onMode: (mode: CloneAuthMode) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** Presentation-only: how a PRIVATE repository is authorised in the clone form (#638). Feature off: just the token field.
 * On but not connected: a "Connect GitHub for private repositories" button, the token field stays. Connected: "Use my
 * GitHub login" (the default, with a picker of the repositories the connection can read) or the pasted token, and a
 * Disconnect button. */
export function CloneAuthSection({ view, mode, picker, busy, error, onMode, onConnect, onDisconnect, ...token }: CloneAuthSectionProps) {
  if (!view.visible) return <CloneTokenField {...token} />;
  if (!view.connected) return <GithubConnectPanel token={token} busy={busy} error={error} onConnect={onConnect} />;
  return (
    <GithubConnectedPanel
      login={view.login}
      mode={mode}
      token={token}
      picker={{ ...picker, disabled: token.disabled }}
      busy={busy}
      error={error}
      onMode={onMode}
      onDisconnect={onDisconnect}
    />
  );
}
