import { AttributionBadge } from './AttributionBadge.jsx';

/** Renders one command's result: the deterministic output lines it
 * printed, then — distinct from that output — what was tool-work vs
 * llm-work, or an error if the command failed. `null` while nothing has
 * run yet.
 *
 * `result.output` already carries any per-step timing the command itself
 * printed (see #165/#166's "Created X (0.02s)" / "Total: 8.4s" lines) —
 * that shows up for free in the <pre> below, no extra handling needed.
 * `result.durationSeconds` (#167) is the whole-command wall-clock total
 * ui/server measured itself, a floor guarantee for commands that never
 * print their own "Total:" line (research, refactor, a single non-slice
 * create/generate). */
export function CommandResult({ result }) {
  if (!result) return null;
  return (
    <div className={`command-result ${result.ok ? 'ok' : 'error'}`}>
      {result.error && <div className="command-error">Error: {result.error}</div>}
      {result.output?.length > 0 && (
        <pre className="command-output">{result.output.join('\n')}</pre>
      )}
      {typeof result.durationSeconds === 'number' && (
        <div className="command-duration">Total: {result.durationSeconds.toFixed(2)}s</div>
      )}
      <AttributionBadge attribution={result.attribution} />
    </div>
  );
}
