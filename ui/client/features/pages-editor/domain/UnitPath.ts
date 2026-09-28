// #381 — the Inspector Change tab acts on the unit the currently open file already is. The Pages Editor
// only ever opens a file from a feature's pages/ layer (`file` here is relative to that pages/ directory,
// e.g. "BillingPage.tsx" — see ui/server/src/pagesEditor.mjs), so the layer is always 'page' and the base
// name always carries the generator's 'Page' suffix (`layerFileBaseName`, packages/core/generators.mjs).
// Pure (DOMAIN-001).
export type UnitLocation = { feature: string; layer: 'page'; name: string };

/** `null` when there is no feature/file yet to act on (nothing open). */
export function parseUnitPath(feature: string, file: string): UnitLocation | null {
  if (!feature || !file) return null;
  const base = file.split('/').pop()!.replace(/\.[^./]+$/, '');
  const name = base.endsWith('Page') ? base.slice(0, -'Page'.length) : base;
  if (!name) return null;
  return { feature, layer: 'page', name };
}
