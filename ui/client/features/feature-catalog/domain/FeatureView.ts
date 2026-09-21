// Pure (DOMAIN-001): the Features screen's rows and the details of one feature, made from what
// `construct summarize` already answers. No new analysis here: this only orders, labels and links what the engine said.
import type { FeatureFile, FeatureRow, FeatureSummaryResponse, FeatureView } from '../types.ts';

const LAYER_ORDER = ['page', 'controller', 'component', 'hook', 'workflow', 'service', 'domain'];

export function toListItems(features: FeatureRow[]): { id: string; label: string; detail: string }[] {
  return features.map((f) => ({ id: f.name, label: f.name, detail: f.summary ? f.summary.replace(/^Feature "[^"]*": /, '') : `Could not be summarized: ${f.error?.message ?? 'unknown reason'}` }));
}

/** The row for a name only when it is in the list (a stale or hand-edited ?feature= selects nothing). */
export function findFeature(features: FeatureRow[], name: string | null): FeatureRow | null {
  return name === null ? null : (features.find((f) => f.name === name) ?? null);
}

/** Where a file can be opened on another screen: components on Components, pages on Pages; other layers have no screen of their own. */
export function fileHref(feature: string, layer: string, path: string): string | null {
  if (layer === 'component') return `/components?component=${encodeURIComponent(path)}`;
  if (layer === 'page') {
    const m = path.match(new RegExp(`(?:^|/)${feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pages/(.+)$`));
    return m ? `/pages?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(m[1])}` : null;
  }
  return null;
}

export function buildFeatureView(summary: FeatureSummaryResponse): FeatureView | null {
  if (!summary.ok) return null;
  const s = summary.sections;
  const files = s.files ?? {};
  const present = s.layers?.present ?? [];
  const order = [...LAYER_ORDER.filter((l) => present.includes(l)), ...present.filter((l) => !LAYER_ORDER.includes(l))];
  const layers = order.map((layer) => ({
    layer,
    files: (files[layer] ?? []).map<FeatureFile>((f) => ({ path: f.path, purpose: f.purpose, loc: f.loc, href: fileHref(summary.name, layer, f.path) })),
  }));
  return {
    name: summary.name,
    summary: summary.summary,
    health: summary.health.status,
    findings: summary.health.findings.filter((f) => f.severity !== 'info').map((f) => f.message),
    routes: s.contracts?.routes ?? [],
    layers,
    missingLayers: s.layers?.missing ?? [],
    workflows: s.workflows ?? [],
    tests: { count: s.tests?.count ?? 0, files: s.tests?.files ?? [] },
    rules: { error: s.rules?.counts?.error ?? 0, warning: s.rules?.counts?.warning ?? 0 },
    usedBy: (s.dependencies?.usedBy ?? []).map((d) => d.name),
    usesFeatures: (s.dependencies?.usesFeatures ?? []).map((d) => d.name),
  };
}
