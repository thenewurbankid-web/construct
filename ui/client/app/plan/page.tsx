import { StageActionsController } from '@/features/dashboard';
import { FeaturesScreenController } from '@/features/feature-catalog';
import { PlanController } from '@/features/plan/controllers/PlanController';

// `/plan` is the same Features screen as `/` (the route stays so existing links and bookmarks keep working).
export default function Page() {
  return <PlanController stageActions={<StageActionsController />} featureDetail={<FeaturesScreenController />} />;
}
