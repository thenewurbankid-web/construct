import type { ImportViewModel } from '../types';
import { ScanTable } from './ScanTable';

/** The scan's one-line summary and its table, once a folder has been read (nothing before). */
export function ScanSection({ view }: { view: ImportViewModel }) {
  if (!view.summary) return null;
  return (
    <>
      <p className="li-sentence" data-testid="li-scan-summary">{view.summary}</p>
      <ScanTable view={view} />
    </>
  );
}
