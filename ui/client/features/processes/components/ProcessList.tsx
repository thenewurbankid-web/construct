import type { ListRow } from '../types';

type Props = { rows: ListRow[]; onSelect: (id: string) => void };

/** Running and recent processes, newest first: state, progress, and one click to open. */
export function ProcessList({ rows, onSelect }: Props) {
  return (
    <ul className="pr-list" aria-label="Processes" data-testid="process-list">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            className="pr-row"
            data-testid="process-row"
            data-state={row.state}
            aria-current={row.selected ? 'true' : undefined}
            onClick={() => onSelect(row.id)}
          >
            <span className="pr-row-title">{row.title}</span>
            <span className={`pr-state pr-state--${row.state}`}>{row.note ?? row.stateLabel}</span>
            <span className="pr-meter" aria-hidden="true"><span className="pr-meter-fill" style={{ width: `${row.percent}%` }} /></span>
            <span className="pr-row-meta">{row.progress}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
