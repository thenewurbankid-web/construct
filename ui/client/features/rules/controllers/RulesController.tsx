'use client';

import '../components/rules.css';
import { buildRulesView } from '../domain/RulesView';
import { useRules } from '../hooks/useRules';
import { useRuleEdit } from '../hooks/useRuleEdit';
import { useExceptions } from '../hooks/useExceptions';
import { RulesPage } from '../pages/RulesPage';

/** The Rules tab of the Features screen's Browser pane (#395/#781): every active rule from this project's
 * `architecture.yml`, with its severity, plain-words "why" and live violation count, reusing `/api/validate`
 * exactly as Diagnostics does. #395 slice B/C add the two write paths this screen has: severity (pick, review
 * the diff, save) and scoped/time-boxed exceptions (add or remove, same reviewable-diff shape) -- both the same
 * per-artifact approval pattern every other Construct write uses (`ui/server/src/rulesApi.mjs`). Presets and
 * `nonLayer:`/`frozen:` are later slices. */
export function RulesController() {
  const rules = useRules();
  const view = buildRulesView(rules.state);
  const edit = useRuleEdit(rules.run);
  const exceptions = useExceptions();
  return <RulesPage view={view} onRun={rules.run} edit={edit} exceptions={exceptions} />;
}
