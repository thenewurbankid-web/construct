// Pure (DOMAIN-001): the Features screen's rows and the details of one feature, made from what
// `construct summarize` already answers. No new analysis here: this only orders, labels and links what the engine said.
import { LAYER_ORDER } from '../../../lib/layerOrder.ts';
import type { FeatureFile, FeatureLayerView, FeatureRow, FeatureSummaryResponse, FeatureView, LegacyFiles, SummaryViolation } from '../types.ts';

export function toListItems(features: FeatureRow[]): { id: string; label: string; detail: string }[] {
  return features.map((f) => ({ id: f.name, label: f.name, detail: f.summary ? f.summary.replace(/^Feature "[^"]*": /, '') : `Could not be summarized: ${f.error?.message ?? 'unknown reason'}` }));
}

/** "Legacy, outside <root>/ (N files, not managed)" -- only for a non-default root with files to report (#791, #393's mock). */
export function legacyNote(featuresRoot: string | undefined, legacy: LegacyFiles | undefined): string | null {
  if (!featuresRoot || featuresRoot === 'features' || !legacy || legacy.count === 0) return null;
  return `Legacy, outside ${featuresRoot}/ (${legacy.count} file${legacy.count === 1 ? '' : 's'}, not managed)`;
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

/** Which layer owns each violation, by matching `violation.file` against the layer's own file list
 * (#803: a violation carries a file, not a layer, so the grouping has to go through `sections.files`). */
function violationsByLayer(files: Record<string, { path: string }[]>, violations: SummaryViolation[]): Map<string, SummaryViolation[]> {
  const layerOf = new Map<string, string>();
  for (const [layer, fs] of Object.entries(files)) for (const f of fs) layerOf.set(f.path, layer);
  const out = new Map<string, SummaryViolation[]>();
  for (const v of violations) {
    const layer = layerOf.get(v.file);
    if (!layer) continue; // a violation outside this feature's own files (shouldn't happen; never guessed at)
    (out.get(layer) ?? out.set(layer, []).get(layer))!.push(v);
  }
  return out;
}

/** The Adapter file a ViewModel file reaches through, by deterministic naming (LIN-150, LIN-163's vm-chain):
 * strip the file's `ViewModel` suffix and look for the same base name with an `Adapter` suffix in the adapter
 * layer. Mirrors packages/core/generators.mjs's layerFileBaseName convention -- no file is read to find it. */
export function apiFileFor(viewModelFile: FeatureFile, layers: FeatureLayerView[]): FeatureFile | null {
  const base = viewModelFile.path.split('/').pop() ?? '';
  const m = base.match(/^(.*)ViewModel\.(tsx?|jsx?)$/);
  if (!m) return null;
  const adapterFiles = layers.find((l) => l.layer === 'adapter')?.files ?? [];
  return adapterFiles.find((f) => (f.path.split('/').pop() ?? '').startsWith(`${m[1]}Adapter.`)) ?? null;
}

export function buildFeatureView(summary: FeatureSummaryResponse): FeatureView | null {
  if (!summary.ok) return null;
  const s = summary.sections;
  const files = s.files ?? {};
  // A layer with files is present even if the engine's own `layers.present` doesn't say so yet (packages/engine's
  // CORE_LAYERS -- a copy of this same list, with the same LIN-150 drift -- hasn't been taught the vm-chain's
  // viewmodel/adapter/expression layers): `files`'s own keys are the ground truth of what has files, same as
  // violationsByLayer above already treats them.
  const present = [...new Set([...(s.layers?.present ?? []), ...Object.keys(files)])];
  const order = [...LAYER_ORDER.filter((l) => present.includes(l)), ...present.filter((l) => !LAYER_ORDER.includes(l))];
  const byLayer = violationsByLayer(files, s.rules?.violations ?? []);
  const layers = order.map((layer) => ({
    layer,
    files: (files[layer] ?? []).map<FeatureFile>((f) => ({ path: f.path, purpose: f.purpose, loc: f.loc, href: fileHref(summary.name, layer, f.path), frozen: f.frozen })),
    violations: byLayer.get(layer) ?? [],
  }));
  // `path` is `<root>/<name>`; strip the trailing `/<name>` to get the configured root (`features` unless overridden).
  const root = summary.path.slice(0, summary.path.length - summary.name.length - 1) || 'features';
  return {
    name: summary.name,
    root,
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
