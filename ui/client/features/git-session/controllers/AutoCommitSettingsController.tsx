'use client';

import { useGitSession } from '../hooks/useGitSession';
import { buildAutoCommitView } from '../domain/GitSessionView';
import { AutoCommitSettings } from '../components/AutoCommitSettings';

// The Settings-screen half of commit-on-save. Composed as a slot by SettingsController, so the
// settings feature stays unaware of how git is configured — same pattern as the folder picker.
export function AutoCommitSettingsController() {
  const { status, busy, error, updateConfig } = useGitSession();
  return status ? (
    <AutoCommitSettings view={buildAutoCommitView(status)} busy={busy} error={error} onChange={updateConfig} />
  ) : null;
}
