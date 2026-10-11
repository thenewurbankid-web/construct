import { StageActionsController } from '@/features/dashboard';
import { FeaturesScreenController } from '@/features/feature-catalog';
import { LineFeaturesController } from '@/features/line-features';
import { PlanController } from '@/features/plan/controllers/PlanController';

// Root route: the Features screen (#370). The Dashboard is retired as a landing, so `/` is the notes + impact + plan
// screen with the Dashboard's Create / Refactor / Research / Import forms as its stage actions. The project gate is
// PlanController's. `/dashboard` still serves the old page for existing links and is no longer in the navigation.
// A `preset: line` project gets the Line Features chat (features/line-features, cd1) as the whole stage; every other
// project keeps the feature list and details unchanged.
export default function Page() {
  return <LineFeaturesController screen={<PlanController stageActions={<StageActionsController />} featureDetail={<FeaturesScreenController />} />} />;
}
