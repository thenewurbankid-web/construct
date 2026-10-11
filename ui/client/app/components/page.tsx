import { LineComponentsController } from '@/features/line-library/controllers/LineComponentsController';

// The Components screen (#431): every component of the project in the Browser, the chosen one documented in the stage.
// A `preset: line` project gets its library as cards by level instead (features/line-library); every other project
// gets the same screen as before. The workflow viewer that used to be this screen is still at /workflows.
export default function Page() {
  return <LineComponentsController />;
}
