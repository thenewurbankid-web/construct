import { StageActionsController } from '@/features/dashboard';
import { FeaturesScreenController } from '@/features/feature-catalog';
import { LineFeaturesController } from '@/features/line-features';
import { PlanController } from '@/features/plan/controllers/PlanController';

// `/plan` is the same Features screen as `/` (the route stays so existing links and bookmarks keep working).
// A `preset: line` project gets the Line Features view (features/line-features) in place of the feature list and
// details; every other project keeps them unchanged.
export default function Page() {
  return <PlanController stageActions={<StageActionsController />} featureDetail={<LineFeaturesController fallback={<FeaturesScreenController />} />} />;
}
