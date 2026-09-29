import { GlobListEditor } from './GlobListEditor';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';
import type { GlobListApi, ProjectSettingsApi } from '../types';

/** #395 slices D/5: nonLayer/frozen glob editors and the features.root/framework picker, behind an "Advanced"
 * disclosure per #764's spec (section 2) -- rarely touched, so collapsed by default rather than competing with
 * severity/exceptions for attention. A native `<details>` gives the expand/collapse semantics for free
 * (keyboard, screen reader) with no JS. */
export function AdvancedPanel({ nonLayer, frozen, project }: { nonLayer: GlobListApi; frozen: GlobListApi; project: ProjectSettingsApi }) {
  return (
    <details className="ru-advanced" data-testid="advanced-panel">
      <summary className="ru-advanced-summary">Advanced</summary>
      <div className="ru-advanced-body">
        <GlobListEditor title="Non-layer paths (nonLayer)" testId="nonlayer" list={nonLayer} />
        <GlobListEditor title="Frozen (externally authored)" testId="frozen" list={frozen} />
        <ProjectSettingsPanel settings={project} />
      </div>
    </details>
  );
}
