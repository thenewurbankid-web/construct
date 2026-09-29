import { getJson, postJson } from '@/lib/http';
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

export type LintResult = { ok?: boolean; error?: string; diagnostics: SourceDiagnostic[] };

/** #551 — diagnostics for an unsaved buffer, never written to disk. */
export const lintPageBuffer = (feature: string, file: string, source: string) =>
  postJson<LintResult>('/api/pages/lint', { feature, file, source });

export type QuickFixMode = 'mechanical' | 'ai';
export type QuickFixResult = { ok?: boolean; error?: string; fixedSource?: string; attribution?: { provider: string; rule: string } };

/** #551 — one quick fix for one diagnostic; returns the fixed buffer to diff and review, never writes. */
export const quickFixPageBuffer = (feature: string, file: string, source: string, rule: string, mode: QuickFixMode) =>
  postJson<QuickFixResult>('/api/pages/quickfix', { feature, file, source, rule, mode });
