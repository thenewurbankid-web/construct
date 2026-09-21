import { StageActionsController } from '@/features/dashboard';
import { FeaturesScreenController } from '@/features/feature-catalog';
import { PlanController } from '@/features/plan/controllers/PlanController';

// Root route: the Features screen (#370). The Dashboard is retired as a landing, so `/` is the notes + impact + plan
// screen with the Dashboard's Create / Refactor / Research / Import forms as its stage actions. The project gate is
// PlanController's. `/dashboard` still serves the old page for existing links and is no longer in the navigation.
export default function Page() {
  return <PlanController stageActions={<StageActionsController />} featureDetail={<FeaturesScreenController />} />;
}
