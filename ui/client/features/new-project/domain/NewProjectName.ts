// Pure (DOMAIN-001): what the New project form says about the name typed so far. A mirror of the server's rule
// (the clone folder-name rule: newProjectApi.mjs -> gitUrl.validateSlug) for a quick hint; the server is the judge.

export const MAX_PROJECT_NAME_LENGTH = 100;

/** A plain problem with `name` as a project name, or null (an empty name is not a problem yet, just not ready). */
export function projectNameProblem(name: string): string | null {
  const n = name.trim();
  if (n === '') return null;
  if (n.length > MAX_PROJECT_NAME_LENGTH) return 'That name is too long.';
  if (/[\\/]/.test(n)) return 'A project name is a single name: no slashes.';
  if (/\s/.test(n)) return 'A project name has no spaces. Use "-" or "_" instead.';
  if (n.includes('..') || n.endsWith('.') || n.toLowerCase().endsWith('.git') || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n)) {
    return 'Use letters, digits, "-", "_" and inner dots. Start with a letter or digit, and do not end with a dot or ".git".';
  }
  return null;
}

/** Can the button be pressed for this form? (Advice only: the server decides.) */
export function canCreateProject(name: string, creating: boolean): boolean {
  return name.trim() !== '' && projectNameProblem(name) === null && !creating;
}

/** Where the project will be made, for the line under the field: `<workspace>/<name>`. */
export function projectDestination(workspaceRoot: string | null, name: string, parentDir = ''): string {
  const n = name.trim();
  const p = parentDir.trim().replace(/^[\\/]+|[\\/]+$/g, '');
  const root = workspaceRoot ? workspaceRoot.replace(/[\\/]+$/, '') : '';
  if (p !== '' && workspaceRoot && parentDir.trim().startsWith(root)) return `${parentDir.trim().replace(/[\\/]+$/, '')}/${n}`;
  return [root, p, n].filter((s) => s !== '').join('/');
}
