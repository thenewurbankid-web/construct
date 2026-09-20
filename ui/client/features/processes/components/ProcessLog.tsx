import { useEffect, useRef } from 'react';
import type { LogRow } from '../types';

/** The live log. Each line carries its provenance badge: ok (a block did it), llm (a model was
 * involved), warn (look at this). New lines scroll into view as they stream in. */
export function ProcessLog({ rows, hidden }: { rows: LogRow[]; hidden: number }) {
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [rows.length]);
  return (
    <ol className="pr-log" aria-label="Process log" aria-live="polite" data-testid="process-log">
      {hidden > 0 && <li className="pr-log-hidden">{hidden} earlier {hidden === 1 ? 'line' : 'lines'} not shown</li>}
      {rows.map((row) => (
        <li key={row.key} className="pr-log-line" data-provenance={row.provenance}>
          <time className="pr-log-time">{row.time}</time>
          <span className={`pr-prov pr-prov--${row.provenance}`} title={row.meaning}>{row.provenance}</span>
          <span className="pr-log-text">{row.text}</span>
        </li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}
