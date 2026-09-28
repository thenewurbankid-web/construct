import { GlobListEditor } from './GlobListEditor';
import type { GlobListApi } from '../types';

/** #395 slice D: nonLayer/frozen glob editors behind an "Advanced" disclosure, per #764's spec (section 2) --
 * rarely touched, so collapsed by default rather than competing with severity/exceptions for attention. A
 * native `<details>` gives the expand/collapse semantics for free (keyboard, screen reader) with no JS. */
export function AdvancedPanel({ nonLayer, frozen }: { nonLayer: GlobListApi; frozen: GlobListApi }) {
  return (
    <details className="ru-advanced" data-testid="advanced-panel">
      <summary className="ru-advanced-summary">Advanced</summary>
      <div className="ru-advanced-body">
        <GlobListEditor title="Non-layer paths (nonLayer)" testId="nonlayer" list={nonLayer} />
        <GlobListEditor title="Frozen (externally authored)" testId="frozen" list={frozen} />
      </div>
    </details>
  );
}
