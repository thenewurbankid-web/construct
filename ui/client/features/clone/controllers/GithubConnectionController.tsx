'use client';

import { githubPanelView } from '../domain/GithubConnection';
import { useGithubConnection } from '../hooks/useGithubConnection';
import { GithubConnectionPage } from '../pages/GithubConnectionPage';

/** Whether the Cockpit is connected to GitHub for private repositories, and for which account, with Connect and
 * Disconnect (#638). Composed as a slot by the Settings screen; renders nothing when the server has no such app set up. */
export function GithubConnectionController() {
  const gh = useGithubConnection();
  return (
    <GithubConnectionPage
      view={githubPanelView(gh.state.status)}
      busy={gh.state.busy}
      error={gh.state.error}
      onConnect={gh.connect}
      onDisconnect={gh.disconnect}
    />
  );
}
