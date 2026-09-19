// Pure (DOMAIN-001): short display name of a project directory.

/** Last path segment of a directory (handles / and \ and trailing separators);
 * "No project" when unknown. */
export function projectLabel(dir: string | null | undefined): string {
  if (!dir) return 'No project';
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : dir;
}
