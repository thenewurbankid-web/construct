'use client';

import '../components/rules.css';
import { buildRulesView } from '../domain/RulesView';
import { useRules } from '../hooks/useRules';
import { RulesPage } from '../pages/RulesPage';

/** The Rules tab of the Features screen's Browser pane (#395/#781): every active rule from this project's
 * `architecture.yml`, with its severity, plain-words "why" and live violation count, reusing `/api/validate`
 * exactly as Diagnostics does. Read-only for this slice -- editing severity, exceptions and presets is #395's
 * next slice. */
export function RulesController() {
  const rules = useRules();
  const view = buildRulesView(rules.state);
  return <RulesPage view={view} onRun={rules.run} />;
}
