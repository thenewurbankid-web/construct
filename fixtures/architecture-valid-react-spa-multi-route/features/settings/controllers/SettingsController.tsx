import { SettingsPage } from '../pages/SettingsPage';

// Registered directly as this route's element by react-router in
// src/App.tsx (<Route path="/settings" element={<SettingsController />} />)
// -- no per-route page.tsx wrapper file like the Next.js target uses.
export function SettingsController() {
  return <SettingsPage />;
}
