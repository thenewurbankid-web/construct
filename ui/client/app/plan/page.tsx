import { StageActionsController } from '@/features/dashboard';
import { PlanController } from '@/features/plan/controllers/PlanController';

// `/plan` is the same Features screen as `/` (the route stays so existing links and bookmarks keep working).
export default function Page() {
  return <PlanController stageActions={<StageActionsController />} />;
}
