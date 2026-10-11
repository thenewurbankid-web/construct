import { StageActionsController } from '@/features/dashboard';
import { FeaturesScreenController } from '@/features/feature-catalog';
import { LineFeaturesController } from '@/features/line-features';
import { PlanController } from '@/features/plan/controllers/PlanController';

// `/plan` is the same Features screen as `/` (the route stays so existing links and bookmarks keep working).
// A `preset: line` project gets the Line Features chat (features/line-features, cd1) as the whole stage; every other
// project keeps the feature list and details unchanged.
export default function Page() {
  return <LineFeaturesController screen={<PlanController stageActions={<StageActionsController />} featureDetail={<FeaturesScreenController />} />} />;
}
