'use client';

import { DirectoryBrowserController } from '@/features/directory-browser';
import { ConnectRemoteController } from '@/features/clone';
import { AutoCommitSettingsController } from '@/features/git-session';
import { useSettings } from '../hooks/useSettings';
import { SettingsPage } from '../pages/SettingsPage';

// Settings is reachable regardless of whether the current project is valid
// (it's how you fix that) — no project-gate wrapping here, same as before.
// The folder picker (#223) is another feature's controller, composed here as
// a slot so settings stays swappable/unaware of how folders are browsed.
export function SettingsController() {
  const settings = useSettings();
  const picker = settings.pickerOpen ? (
    <DirectoryBrowserController onSelect={settings.chooseDirectory} initialPath={settings.settings?.projectDir ?? undefined} />
  ) : null;
  // Commit-on-save's controls (#283) are another feature's controller, composed here as a second
  // slot for the same reason the picker is: settings stays unaware of how git is configured.
  return <SettingsPage {...settings} picker={picker} gitSession={<AutoCommitSettingsController />} remote={<ConnectRemoteController />} />;
}
