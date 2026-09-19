import { fetchReporting } from '../services/reportingService';
import type { ReportingState } from '../types';

export async function runReporting(): Promise<{ state: ReportingState; total: number }> {
  return { state: 'done', total: await fetchReporting() };
}
