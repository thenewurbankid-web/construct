// Reuses `/api/validate` (ui/server/src/validateApi.mjs) exactly as the Diagnostics tab does — the Rules composer
// does not reinvent validation (docs/design/rules-envelopes.md section 0), it only reads `body.summary`, the same
// per-rule grouping #758 added for this purpose.
import { getJson, postJson } from '@/lib/http';
import type { ExceptionRow, GlobField, NewException, PresetChange, ProjectSettingField, ProjectSettings, RuleRow, RuleSeverity, RuleSummaryEntry } from '../types';

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

export type RuleSeverityDiff = { ok: true; before: string; after: string; contentHash: string } | { ok: false; error: string };
export type RuleSeveritySaved = { ok: true } | { ok: false; error: string };

type SeverityResponse = { ok: boolean; error?: string; before?: string; after?: string; contentHash?: string };

/** #395 slice B -- the diff a severity change would make to architecture.yml, computed but not written
 * (POST /api/rules/severity with `commit: false`). */
export async function previewRuleSeverity(ruleId: string, severity: RuleSeverity): Promise<RuleSeverityDiff> {
  try {
    const body = await postJson<SeverityResponse>('/api/rules/severity', { ruleId, severity, commit: false });
    if (!body.ok || body.before === undefined || body.after === undefined || body.contentHash === undefined) {
      return { ok: false, error: body.error ?? 'Could not preview that change.' };
    }
    return { ok: true, before: body.before, after: body.after, contentHash: body.contentHash };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/** Commits a severity change previewed via `previewRuleSeverity`; `contentHash` is the one that preview returned, so
 * a change to architecture.yml on disk in between (another tab, the CLI, an agent) is refused (409) instead of
 * silently overwritten. */
export async function saveRuleSeverity(ruleId: string, severity: RuleSeverity, contentHash: string): Promise<RuleSeveritySaved> {
  try {
    const body = await postJson<SeverityResponse>('/api/rules/severity', { ruleId, severity, contentHash, commit: true });
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not save that change.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

// #395 slice C -- scoped, time-boxed exceptions.

export type ExceptionsResult = { ok: true; rows: ExceptionRow[] } | { ok: false; error: string };

/** Every exception in the project's architecture.yml (GET /api/rules, ui/server/src/rulesApi.mjs). */
export async function fetchExceptions(): Promise<ExceptionsResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; exceptions?: ExceptionRow[] }>('/api/rules');
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not read exceptions.' };
    return { ok: true, rows: body.exceptions ?? [] };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

type ExceptionResponse = SeverityResponse & { exceptions?: ExceptionRow[] };

function exceptionBody(action: 'add' | 'remove', input: NewException | number, extra: { contentHash?: string; commit: boolean }) {
  if (action === 'add') {
    const draft = input as NewException;
    return { action, path: draft.path, rule: draft.rule, ...(draft.expires ? { expires: draft.expires } : {}), ...(draft.reason ? { reason: draft.reason } : {}), ...extra };
  }
  return { action, index: input as number, ...extra };
}

/** The diff adding or removing one exception would make, computed but not written (`commit: false`). */
export async function previewException(action: 'add' | 'remove', input: NewException | number): Promise<RuleSeverityDiff> {
  try {
    const body = await postJson<ExceptionResponse>('/api/rules/exceptions', exceptionBody(action, input, { commit: false }));
    if (!body.ok || body.before === undefined || body.after === undefined || body.contentHash === undefined) {
      return { ok: false, error: body.error ?? 'Could not preview that change.' };
    }
    return { ok: true, before: body.before, after: body.after, contentHash: body.contentHash };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/** Commits an add/remove previewed via `previewException`; same staleness guard as `saveRuleSeverity`. */
export async function saveException(action: 'add' | 'remove', input: NewException | number, contentHash: string): Promise<RuleSeveritySaved> {
  try {
    const body = await postJson<ExceptionResponse>('/api/rules/exceptions', exceptionBody(action, input, { contentHash, commit: true }));
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not save that change.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

// #395 slice D -- nonLayer/frozen glob lists.

export type GlobListResult = { ok: true; rows: string[] } | { ok: false; error: string };

/** `field`'s glob list from the current project's architecture.yml (GET /api/rules). */
export async function fetchGlobs(field: GlobField): Promise<GlobListResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; nonLayer?: string[]; frozen?: string[] }>('/api/rules');
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not read that list.' };
    return { ok: true, rows: body[field] ?? [] };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

type GlobResponse = SeverityResponse & { nonLayer?: string[]; frozen?: string[] };

function globBody(field: GlobField, action: 'add' | 'remove', input: string | number, extra: { contentHash?: string; commit: boolean }) {
  return action === 'add' ? { field, action, glob: input as string, ...extra } : { field, action, index: input as number, ...extra };
}

/** The diff adding or removing one glob would make, computed but not written (`commit: false`). */
export async function previewGlob(field: GlobField, action: 'add' | 'remove', input: string | number): Promise<RuleSeverityDiff> {
  try {
    const body = await postJson<GlobResponse>('/api/rules/globs', globBody(field, action, input, { commit: false }));
    if (!body.ok || body.before === undefined || body.after === undefined || body.contentHash === undefined) {
      return { ok: false, error: body.error ?? 'Could not preview that change.' };
    }
    return { ok: true, before: body.before, after: body.after, contentHash: body.contentHash };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/** Commits an add/remove previewed via `previewGlob`; same staleness guard as `saveRuleSeverity`. */
export async function saveGlob(field: GlobField, action: 'add' | 'remove', input: string | number, contentHash: string): Promise<RuleSeveritySaved> {
  try {
    const body = await postJson<GlobResponse>('/api/rules/globs', globBody(field, action, input, { contentHash, commit: true }));
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not save that change.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

// #395 slice 5 -- project.framework (route adapter) + features.root.

export type ProjectSettingsResult = { ok: true; value: ProjectSettings } | { ok: false; error: string };

/** The current project's framework and features.root (GET /api/rules, body.project). */
export async function fetchProjectSettings(): Promise<ProjectSettingsResult> {
  try {
    const body = await getJson<{ ok?: boolean; error?: string; project?: ProjectSettings }>('/api/rules');
    if (!body.ok || !body.project) return { ok: false, error: body.error ?? 'Could not read project settings.' };
    return { ok: true, value: body.project };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

type ProjectSettingsResponse = SeverityResponse & { project?: ProjectSettings };

function projectSettingBody(field: ProjectSettingField, value: string, extra: { contentHash?: string; commit: boolean }) {
  return field === 'framework' ? { framework: value, ...extra } : { featuresRoot: value, ...extra };
}

/** The diff changing one project setting would make, computed but not written (`commit: false`). */
export async function previewProjectSetting(field: ProjectSettingField, value: string): Promise<RuleSeverityDiff> {
  try {
    const body = await postJson<ProjectSettingsResponse>('/api/rules/project', projectSettingBody(field, value, { commit: false }));
    if (!body.ok || body.before === undefined || body.after === undefined || body.contentHash === undefined) {
      return { ok: false, error: body.error ?? 'Could not preview that change.' };
    }
    return { ok: true, before: body.before, after: body.after, contentHash: body.contentHash };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/** Commits a setting change previewed via `previewProjectSetting`; same staleness guard as `saveRuleSeverity`. */
export async function saveProjectSetting(field: ProjectSettingField, value: string, contentHash: string): Promise<RuleSeveritySaved> {
  try {
    const body = await postJson<ProjectSettingsResponse>('/api/rules/project', projectSettingBody(field, value, { contentHash, commit: true }));
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not save that change.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

// #395 slice 6 -- switch to a named preset (today, just `strict-nextjs`), a confirmed bulk-severity diff.

export type PresetDiff = { ok: true; before: string; after: string; contentHash: string; changes: PresetChange[] } | { ok: false; error: string };

type PresetResponse = SeverityResponse & { changes?: PresetChange[] };

/** The per-rule severity diff switching to `preset` would make, computed but not written (`commit: false`). */
export async function previewPreset(preset: string): Promise<PresetDiff> {
  try {
    const body = await postJson<PresetResponse>('/api/rules/preset', { preset, commit: false });
    if (!body.ok || body.before === undefined || body.after === undefined || body.contentHash === undefined) {
      return { ok: false, error: body.error ?? 'Could not preview that change.' };
    }
    return { ok: true, before: body.before, after: body.after, contentHash: body.contentHash, changes: body.changes ?? [] };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}

/** Commits a preset switch previewed via `previewPreset`; same staleness guard as `saveRuleSeverity`. */
export async function savePreset(preset: string, contentHash: string): Promise<RuleSeveritySaved> {
  try {
    const body = await postJson<PresetResponse>('/api/rules/preset', { preset, contentHash, commit: true });
    if (!body.ok) return { ok: false, error: body.error ?? 'Could not save that change.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the Construct server.' };
  }
}
