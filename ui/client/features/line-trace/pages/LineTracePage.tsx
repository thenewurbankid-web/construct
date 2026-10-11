import { useId } from 'react';
import { AutoControls } from '../components/AutoControls';
import { SimCursor } from '../components/SimCursor';
import { TraceFindings } from '../components/TraceFindings';
import { TraceToggles } from '../components/TraceToggles';
import '../components/line-trace.css';
import type { TraceView } from '../types';

/** The Trace bar of a Line screen: Trace and Auto on or off; with either on, "What do you want to do?", one sentence
 * on what Trace found, the lit controls (here, and a link to each other screen), and Auto's run controls. */
export function LineTracePage({ view }: { view: TraceView }) {
  const fieldId = useId();
  const { settings } = view;
  const on = settings.trace || settings.auto;
  return (
    <section className="ltr" aria-label="Trace and Auto" data-testid="line-trace">
      <span className="ltr-row">
        <h2 className="ltr-head">Line modes</h2>
        <TraceToggles trace={settings.trace} auto={settings.auto} onTrace={view.setTrace} onAuto={view.setAuto} />
      </span>
      {on && (
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
          <TraceFindings match={view.match} lights={view.lights} showLights={settings.trace} />
          {settings.auto && <AutoControls view={view} />}
        </>
      )}
      <SimCursor at={view.cursor} speed={settings.speed} />
    </section>
  );
}
