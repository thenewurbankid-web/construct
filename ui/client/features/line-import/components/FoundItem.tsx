import type { FoundRow } from '../types';
import { TechDetails } from './TechDetails';

/** One found item: kind, name, the proposal sentence; a note when it waits on a question; file, base and rules under Details. */
export function FoundItem({ row }: { row: FoundRow }) {
  return (
    <li className="li-item" data-testid="li-found" data-ask={String(row.asks)}>
      <span className="li-chip">{row.kindLabel}</span>
      <span className="li-name">{row.name}</span>
      <p className="li-sentence">{row.sentence}</p>
      {row.asks && <p className="li-ask">Waiting on your answer below.</p>}
      <TechDetails summary="Details" lines={row.details} />
    </li>
  );
}
