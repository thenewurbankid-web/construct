// Pure (DOMAIN-001): the two kinds of finding, kept apart. The split is the ENGINE's `resolution`
// (mechanical | conversation), which it derives from what `construct refactor` / `construct sync` can do;
// nothing here keeps a list of rule ids. A mechanical finding shows the engine's own `fix.via` command
// verbatim; `fix.available:false` is said plainly. A conversation finding has no fix, ever.
import type { Finding, FindingDetailView, FindingRow, FindingsView, FullIndicator } from '../types.ts';

const SEVERITY: Record<Finding['severity'], string> = { error: 'Error', warning: 'Warning', info: 'Note' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const locationOf = (f: Finding): string | null => {
  const file = f.files?.[0];
  return file ? (f.line ? `${file}:${f.line}` : file) : null;
};

function fixOf(f: Finding): FindingRow['fix'] {
  if (f.resolution !== 'mechanical') return null;
  const via = f.fix?.via ?? '';
  if (!via) return { command: '', available: false, text: 'No automated fix yet.' };
  return f.fix?.available
    ? { command: via, available: true, text: 'Construct can make this change with no model. Run it yourself when you are ready; nothing here applies it.' }
    : { command: via, available: false, text: 'No automated fix yet. This is a mechanical change, but no Construct command performs it.' };
}

function rowOf(f: Finding, titles: Map<string, string>, selectedId: string | null): FindingRow {
  return {
    id: f.id,
    indicatorTitle: titles.get(f.indicator) ?? f.indicator,
    title: f.title,
    message: f.message,
    location: locationOf(f),
    severityLabel: SEVERITY[f.severity] ?? 'Note',
    selected: f.id === selectedId,
    fix: fixOf(f),
  };
}

export function buildFindingsView(findings: Finding[], indicators: FullIndicator[], selectedId: string | null): FindingsView {
  const titles = new Map(indicators.map((i) => [i.id as string, i.title]));
  const mechanical = findings.filter((f) => f.resolution === 'mechanical').map((f) => rowOf(f, titles, selectedId));
  const conversation = findings.filter((f) => f.resolution !== 'mechanical').map((f) => rowOf(f, titles, selectedId));
  const total = findings.length;
  return {
    total,
    mechanical,
    conversation,
    summary: total === 0 ? 'No findings.' : `${mechanical.length} of ${plural(total, 'finding')} can be fixed mechanically.`,
  };
}

/** The selected finding for the stage: the rule in words, why it matters, and the fix (mechanical) or the conversation. */
export function buildFindingDetail(findings: Finding[], selectedId: string | null): FindingDetailView | null {
  const f = findings.find((x) => x.id === selectedId);
  if (!f) return null;
  const c = f.constraint;
  return {
    id: f.id,
    resolution: f.resolution,
    resolutionLabel: f.resolution === 'mechanical' ? 'Can be fixed mechanically' : 'Needs a decision',
    title: f.title,
    location: locationOf(f),
    rule: f.rule ?? null,
    why: f.why ?? null,
    constraint: c ? `A ${c.layer} may import ${c.canImport && c.canImport.length ? c.canImport.join(', ') : 'nothing from other layers'}.` : null,
    message: f.message,
    files: f.files ?? [],
    fix: fixOf(f),
  };
}
