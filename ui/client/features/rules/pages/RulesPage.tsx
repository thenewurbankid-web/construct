import { RulesList } from '../components/RulesList';
import type { RulesViewModel } from '../types';

// Presentation-only: all state comes from the controller.
export function RulesPage({ view, onRun }: { view: RulesViewModel; onRun: () => void }) {
  return <RulesList view={view} onRun={onRun} />;
}
