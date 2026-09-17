'use client';

import { useSettings } from '../hooks/useSettings';
import { SettingsPage } from '../pages/SettingsPage';

// Settings is reachable regardless of whether the current project is valid
// (it's how you fix that) — no project-gate wrapping here, same as before.
export function SettingsController() {
  const settings = useSettings();
  return <SettingsPage {...settings} />;
}
