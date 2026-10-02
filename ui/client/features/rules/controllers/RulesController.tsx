'use client';

import '../components/rules.css';
import { buildRulesView } from '../domain/RulesView';
import { useRules } from '../hooks/useRules';
import { useRuleEdit } from '../hooks/useRuleEdit';
import { useExceptions } from '../hooks/useExceptions';
import { useGlobList } from '../hooks/useGlobList';
import { useProjectSettings } from '../hooks/useProjectSettings';
import { usePreset } from '../hooks/usePreset';
import { RulesPage } from '../pages/RulesPage';

/** The Rules tab of the Features screen's Browser pane (#395/#781): every active rule from this project's
 * `architecture.yml`, with its severity, plain-words "why" and live violation count, reusing `/api/validate`
 * exactly as Diagnostics does. #395 slices B-6 add this screen's write paths -- severity, scoped/time-boxed
 * exceptions, nonLayer/frozen globs, features.root/framework (behind an "Advanced" disclosure) and the preset
 * switch (a bulk severity reset to `strict-nextjs`, the only named preset today) -- each pick/edit -> reviewable
 * diff -> save, the same per-artifact approval pattern every other Construct write uses
 * (`ui/server/src/rulesApi.mjs`). */
export function RulesController() {
  const rules = useRules();
  const view = buildRulesView(rules.state);
  const edit = useRuleEdit(rules.run);
  const exceptions = useExceptions();
  const nonLayer = useGlobList('nonLayer');
  const frozen = useGlobList('frozen');
  const project = useProjectSettings();
  const preset = usePreset(project.state.value?.preset ?? 'strict-nextjs', rules.run);
  return (
    <RulesPage view={view} onRun={rules.run} edit={edit} exceptions={exceptions} nonLayer={nonLayer} frozen={frozen} project={project} preset={preset} />
  );
}
