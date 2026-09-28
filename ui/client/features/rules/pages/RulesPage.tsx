import { AdvancedPanel } from '../components/AdvancedPanel';
import { ExceptionsPanel } from '../components/ExceptionsPanel';
import { RulesList } from '../components/RulesList';
import type { ExceptionsApi, GlobListApi, RuleEditApi, RulesViewModel } from '../types';

// Presentation-only: all state comes from the controller.
export function RulesPage({
  view,
  onRun,
  edit,
  exceptions,
  nonLayer,
  frozen,
}: {
  view: RulesViewModel;
  onRun: () => void;
  edit: RuleEditApi;
  exceptions: ExceptionsApi;
  nonLayer: GlobListApi;
  frozen: GlobListApi;
}) {
  return (
    <div className="ru-page">
      <RulesList view={view} onRun={onRun} edit={edit} />
      <ExceptionsPanel exceptions={exceptions} rules={view.rows} />
      <AdvancedPanel nonLayer={nonLayer} frozen={frozen} />
    </div>
  );
}
