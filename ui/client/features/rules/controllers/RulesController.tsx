'use client';

import '../components/rules.css';
import { buildRulesView } from '../domain/RulesView';
import { useRules } from '../hooks/useRules';
import { useRuleEdit } from '../hooks/useRuleEdit';
import { RulesPage } from '../pages/RulesPage';

/** The Rules tab of the Features screen's Browser pane (#395/#781): every active rule from this project's
 * `architecture.yml`, with its severity, plain-words "why" and live violation count, reusing `/api/validate`
 * exactly as Diagnostics does. #395 slice B adds the one write path this screen has: pick a new severity for
 * a rule, review the architecture.yml diff it would make, then save -- the same reviewable-diff, per-artifact
 * approval shape every other Construct write uses (`ui/server/src/rulesApi.mjs`). Exceptions and presets are
 * later slices. */
export function RulesController() {
  const rules = useRules();
  const view = buildRulesView(rules.state);
  const edit = useRuleEdit(rules.run);
  return <RulesPage view={view} onRun={rules.run} edit={edit} />;
}
