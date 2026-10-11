import type { Severity } from '../types';

const LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' } as const;

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge-${severity}`}>{LABELS[severity]}</span>;
}
