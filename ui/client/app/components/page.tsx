import { ComponentsController } from '@/features/component-docs';

// The Components screen (#431): every component of the project in the Browser, the chosen one documented in the stage.
// The workflow viewer that used to be this screen is still at /workflows.
export default function Page() {
  return <ComponentsController />;
}
