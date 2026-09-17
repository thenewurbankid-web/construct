// Pure (DOMAIN-001) — the one derived label the page shows for "no project
// resolved yet", pulled out instead of an inline ternary in the page/component.
export function resolvedRootLabel(resolvedProjectRoot: string | null): string | null {
  return resolvedProjectRoot || null;
}
