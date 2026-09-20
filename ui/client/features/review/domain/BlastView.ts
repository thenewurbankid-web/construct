// Pure (DOMAIN-001): the declared-vs-actual scope of a change (#316). Both sides come from the engine's
// blast-radius indicator (planTouches vs the changed files); nothing is read from prose. With NO plan the
// state is a calm neutral "Not measured", never red and never empty, and its copy blames nobody: most
// changes have no plan.
import type { BlastEvidence, BlastRow, BlastView, ChangeReport, Tone } from '../types.ts';

const TONE: Record<string, { tone: Tone; label: string }> = {
  clear: { tone: 'ok', label: 'As planned' },
  info: { tone: 'info', label: 'Planned work not touched yet' },
  attention: { tone: 'danger', label: 'Outside the plan' },
};

export function buildBlastView(report: ChangeReport): BlastView | null {
  const i = report.indicators.find((x) => x.id === 'blast-radius');
  if (!i) return null;
  if (!i.measured) {
    return {
      measured: false,
      tone: 'neutral',
      title: 'Scope is not measured for this change',
      text: 'No plan is linked, which is normal for hand-written work and outside contributions. Every other check on this page still runs. Pick a saved plan below to compare what it declared with what changed.',
      reason: i.reason ?? '',
    };
  }
  const ev = (i.evidence ?? {}) as BlastEvidence;
  const declared = ev.declared?.features ?? [];
  const touched = ev.touched?.features ?? [];
  const extra = new Set(ev.extraFeatures ?? []);
  const notDone = new Set(ev.unreachedFeatures ?? []);
  const fileCount = new Map(report.change.features.map((f) => [f.name, f.files]));
  const names = [...new Set([...declared, ...touched])].sort();
  const rows: BlastRow[] = names.map((feature) => ({
    feature,
    declared: declared.includes(feature),
    files: fileCount.get(feature) ?? 0,
    note: extra.has(feature) ? 'Changed here, not in the plan' : notDone.has(feature) ? 'In the plan, not touched yet' : 'As planned',
  }));
  const s = TONE[i.status] ?? TONE.info;
  return {
    measured: true,
    tone: s.tone,
    statusLabel: s.label,
    headline: i.headline,
    rows,
    extraFiles: ev.extraFiles?.items ?? [],
    extraFilesTotal: ev.extraFiles?.total ?? 0,
    missingFiles: ev.missingFiles?.items ?? [],
  };
}
