import { RulesList } from '../components/RulesList';
import type { RuleEditApi, RulesViewModel } from '../types';

// Presentation-only: all state comes from the controller.
export function RulesPage({ view, onRun, edit }: { view: RulesViewModel; onRun: () => void; edit: RuleEditApi }) {
  return <RulesList view={view} onRun={onRun} edit={edit} />;
}
