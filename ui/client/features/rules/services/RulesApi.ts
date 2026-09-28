// Reuses `/api/validate` (ui/server/src/validateApi.mjs) exactly as the Diagnostics tab does — the Rules composer
// does not reinvent validation (docs/design/rules-envelopes.md section 0), it only reads `body.summary`, the same
// per-rule grouping #758 added for this purpose.
import { getJson } from '@/lib/http';
import type { RuleRow, RuleSummaryEntry } from '../types';

export type RulesResult = { ok: true; rows: RuleRow[] } | { ok: false; error: string };

function toRow(id: string, entry: RuleSummaryEntry): RuleRow {
  const severity = entry.severity === 'error' || entry.severity === 'warning' ? entry.severity : 'off';
  return { id, name: entry.name ?? id, severity, why: entry.why ?? entry.name ?? id, count: entry.count };
}

/** Every rule for the current project, with its severity, plain-words "why" and live violation count. */
export async function fetchRules(): Promise<RulesResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; summary?: Record<string, RuleSummaryEntry> }>('/api/validate');
    if (!body.ok) return { ok: false, error: body.error ?? 'Validation could not run.' };
    const summary = body.summary ?? {};
    const rows = Object.keys(summary)
      .sort()
      .map((id) => toRow(id, summary[id]));
    return { ok: true, rows };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}
