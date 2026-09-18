import { DashboardPage } from '../pages/DashboardPage';

// Registered directly as this route's element by react-router in
// src/App.tsx (<Route path="/dashboard" element={<DashboardController />} />)
// -- no per-route page.tsx wrapper file like the Next.js target uses.
export function DashboardController() {
  return <DashboardPage />;
}
