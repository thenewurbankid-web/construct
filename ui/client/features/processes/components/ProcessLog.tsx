import { useEffect, useRef } from 'react';
import type { LogRow } from '../types';

/** The live log. Each line carries its provenance badge: ok (a block did it), llm (a model was
 * involved), warn (look at this). It follows new lines as they stream in, unless you scrolled up to read. */
export function ProcessLog({ rows, hidden }: { rows: LogRow[]; hidden: number }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  return (
    <div className="pr-logscroll" ref={scroller} onScroll={onScroll} tabIndex={0} role="region" aria-label="Log">
      <ol className="pr-log" aria-label="Process log" aria-live="polite" data-testid="process-log">
        {hidden > 0 && <li className="pr-log-hidden">{hidden} earlier {hidden === 1 ? 'line' : 'lines'} not shown</li>}
        {rows.map((row) => (
          <li key={row.key} className="pr-log-line" data-provenance={row.provenance}>
            <time className="pr-log-time">{row.time}</time>
            <span className={`pr-prov pr-prov--${row.provenance}`} title={row.meaning}>{row.provenance}</span>
            <span className="pr-log-text">{row.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
