type TraceTogglesProps = {
  trace: boolean;
  auto: boolean;
  onTrace: (on: boolean) => void;
  onAuto: (on: boolean) => void;
};

/** Line's two modes, each on or off: Trace lights up the controls; Auto does the steps (with Trace, as a show). */
export function TraceToggles({ trace, auto, onTrace, onAuto }: TraceTogglesProps) {
  return (
    <span className="ltr-toggles" role="group" aria-label="Line modes">
      <button type="button" className="ltr-toggle" aria-pressed={trace} onClick={() => onTrace(!trace)} data-testid="trace-toggle">
        Trace
      </button>
      <button type="button" className="ltr-toggle" aria-pressed={auto} onClick={() => onAuto(!auto)} data-testid="auto-toggle">
        Auto
      </button>
    </span>
  );
}
