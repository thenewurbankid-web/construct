import { getJson } from '@/lib/http';
import type { Violation } from '../types';

export type ValidateResult =
  | { ok: true; violations: Violation[]; total: number; truncated: boolean; durationMs: number }
  | { ok: false; error: string };

/** Runs `construct validate` for the current project (ui/server GET /api/validate). */
export async function fetchValidation(): Promise<ValidateResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; violations?: Violation[]; total?: number; truncated?: boolean; durationMs?: number }>('/api/validate');
    if (!body.ok) return { ok: false, error: body.error ?? 'Validation could not run.' };
    const violations = body.violations ?? [];
    return { ok: true, violations, total: body.total ?? violations.length, truncated: Boolean(body.truncated), durationMs: body.durationMs ?? 0 };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}
