import { ExceptionsPanel } from '../components/ExceptionsPanel';
import { RulesList } from '../components/RulesList';
import type { ExceptionsApi, RuleEditApi, RulesViewModel } from '../types';

// Presentation-only: all state comes from the controller.
export function RulesPage({
  view,
  onRun,
  edit,
  exceptions,
}: {
  view: RulesViewModel;
  onRun: () => void;
  edit: RuleEditApi;
  exceptions: ExceptionsApi;
}) {
  return (
    <div className="ru-page">
      <RulesList view={view} onRun={onRun} edit={edit} />
      <ExceptionsPanel exceptions={exceptions} rules={view.rows} />
    </div>
  );
}
