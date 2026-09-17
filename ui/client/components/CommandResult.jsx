import { AttributionBadge } from './AttributionBadge.jsx';

/** Renders one command's result: the deterministic output lines it
 * printed, then — distinct from that output — what was tool-work vs
 * llm-work, or an error if the command failed. `null` while nothing has
 * run yet. */
export function CommandResult({ result }) {
  if (!result) return null;
  return (
    <div className={`command-result ${result.ok ? 'ok' : 'error'}`}>
      {result.error && <div className="command-error">Error: {result.error}</div>}
      {result.output?.length > 0 && (
        <pre className="command-output">{result.output.join('\n')}</pre>
      )}
      <AttributionBadge attribution={result.attribution} />
    </div>
  );
}
