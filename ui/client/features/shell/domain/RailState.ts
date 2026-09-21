// Pure (DOMAIN-001): whether the screens rail shows icon + label or icons only, and its storage key. The
// preference is per person (per browser), not per project: the rail is chrome, not project state.

export const RAIL_STORAGE_KEY = 'construct.shell.rail';

/** Turns whatever was in storage into a collapsed flag (anything but the exact string `collapsed` is expanded). */
export function parseRailCollapsed(raw: string | null): boolean {
  return raw === 'collapsed';
}

export function serializeRailCollapsed(collapsed: boolean): string {
  return collapsed ? 'collapsed' : 'expanded';
}
