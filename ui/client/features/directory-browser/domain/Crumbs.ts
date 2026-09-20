// Pure (DOMAIN-001): the workspace-relative breadcrumb the folder picker shows (#365). The picker can never
// leave the workspace, so the honest place to start the trail is the workspace itself, not the disk's root.

export type Crumb = { label: string; path: string };

/** "Workspace" for `root`, then one crumb per folder from `root` down to `path`. Empty if `path` is not inside `root`. */
export function crumbsFor(root: string | null, path: string): Crumb[] {
  if (!root) return [];
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmed = root.length > 1 ? root.replace(/[\\/]+$/, '') : root;
  if (path !== trimmed && !path.startsWith(trimmed + sep)) return [];
  const crumbs: Crumb[] = [{ label: 'Workspace', path: trimmed }];
  let current = trimmed;
  for (const part of path.slice(trimmed.length).split(/[\\/]+/).filter(Boolean)) {
    current = `${current}${sep}${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}
