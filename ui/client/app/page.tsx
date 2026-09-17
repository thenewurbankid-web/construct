import { DashboardController } from '@/features/dashboard/controllers/DashboardController';

// Root route — carries the same ProjectGate check (inside
// DashboardController) before rendering Dashboard, matching today's
// behavior of "/" being the Dashboard. Also reachable at /dashboard.
export default function Page() {
  return <DashboardController />;
}
