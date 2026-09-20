import type { RunPanelProps } from '../types';
import { RunControls } from './RunControls';
import { RunResults } from './RunResults';

/** The run controls and results of the Tests stage (#305). A run is a Process, so it is also in the Processes drawer. */
export function RunPanel(p: RunPanelProps) {
  return (
    <section className="ts-run" data-testid="run-panel" aria-label="Run the tests">
      <RunControls {...p} />
      <RunResults {...p} />
    </section>
  );
}
