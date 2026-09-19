import { totalReporting } from '../domain/reportingRules';

export async function fetchReporting(): Promise<number> {
  const res = await fetch('/api/reporting');
  return totalReporting(await res.json());
}
