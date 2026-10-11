import { SimCursor } from '../components/SimCursor';
import { TraceBody } from '../components/TraceBody';
import { TraceToggles } from '../components/TraceToggles';
import '../components/line-trace.css';
import type { TraceView } from '../types';

/** The Trace bar of a Line screen: Trace and Auto on or off; with either on, what you want to do, what Trace found,
 * the lit controls (here, and a link to each other screen) and Auto's run controls; Auto's cursor when it shows. */
export function LineTracePage({ view }: { view: TraceView }) {
  const { settings } = view;
  return (
    <section className="ltr" aria-label="Trace and Auto" data-testid="line-trace">
      <span className="ltr-row">
        <h2 className="ltr-head">Line modes</h2>
        <TraceToggles trace={settings.trace} auto={settings.auto} onTrace={view.setTrace} onAuto={view.setAuto} />
      </span>
      <TraceBody view={view} />
      <SimCursor at={view.cursor} speed={settings.speed} />
    </section>
  );
}
