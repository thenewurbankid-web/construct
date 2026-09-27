'use client';

import { DirectoryBrowserController } from '@/features/directory-browser';
import { ConnectRemoteController, GithubConnectionController } from '@/features/clone';
import { useSettings } from '../hooks/useSettings';
import { SettingsPage } from '../pages/SettingsPage';

// Settings is reachable regardless of whether the current project is valid
// (it's how you fix that) — no project-gate wrapping here, same as before.
// The folder picker (#223) is another feature's controller, composed here as
// a slot so settings stays swappable/unaware of how folders are browsed.
//
// #374: commit-on-save's controls (#283, `AutoCommitSettingsController`) moved off this screen onto
// the Git screen's Commit tab (`ia-five-screens.md`'s own decision) -- no longer composed here.
export function SettingsController() {
  const settings = useSettings();
  const picker = settings.pickerOpen ? (
    <DirectoryBrowserController onSelect={settings.chooseDirectory} />
  ) : null;
  return <SettingsPage {...settings} picker={picker} remote={<ConnectRemoteController />} github={<GithubConnectionController />} />;
}
