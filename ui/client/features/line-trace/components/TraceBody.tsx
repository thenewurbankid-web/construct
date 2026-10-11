import { useId } from 'react';
import type { TraceView } from '../types';
import { AutoControls } from './AutoControls';
import { TraceFindings } from './TraceFindings';

/** With Trace or Auto on: "What do you want to do?", one sentence on what Trace found, the lit controls and links, and
 * Auto's run controls. Nothing while both are off. */
export function TraceBody({ view }: { view: TraceView }) {
  const fieldId = useId();
  const { settings } = view;
  if (!settings.trace && !settings.auto) return null;
  return (
    <>
      <label className="ltr-field" htmlFor={fieldId}>
        What do you want to do?
        <input
          id={fieldId}
          value={settings.request}
          onChange={(e) => view.setRequest(e.target.value)}
          placeholder="For example: Base a new StatusBadge on Badge in orders"
          spellCheck={false}
          data-testid="trace-request"
        />
      </label>
      <p className="ltr-sentence" role="status" data-testid="trace-sentence">
        {view.sentence}
      </p>
      <TraceFindings findings={view.findings} />
      <AutoControls view={view} />
    </>
  );
}
