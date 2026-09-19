import { getJson } from '@/lib/http';
import type { SourceDiagnostic } from '../types';

export type PageSourceResult = {
  ok?: boolean;
  error?: string;
  source: string;
  contentHash: string;
  diagnostics: SourceDiagnostic[];
};

/** Whole page file + TypeScript/architecture diagnostics (read-only). */
export const getPageSource = (feature: string, file: string) =>
  getJson<PageSourceResult>(`/api/pages/source?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`);
