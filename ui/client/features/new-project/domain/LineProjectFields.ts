// Pure (DOMAIN-001), cu7: what the New project form says about a Line project's extra fields (its first feature and
// the workspace folder it goes in). A quick hint mirroring the server (packages/engine/line/newProject.mjs and the
// workspace containment in lineNewProjectApi.mjs); the server is the judge.
import { MAX_PROJECT_NAME_LENGTH, canCreateProject } from './NewProjectName.ts';

/** A plain problem with `name` as a Line feature name, or null (empty is not a problem yet, just not ready). */
export function featureNameProblem(name: string): string | null {
  const n = name.trim();
  if (n === '') return null;
  if (n.length > MAX_PROJECT_NAME_LENGTH) return 'That feature name is too long.';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(n)) return 'A feature name uses letters, digits, "-" and "_", starting with a letter or digit.';
  return null;
}

/** A plain problem with the folder the Line project goes in, or null ("" is the workspace itself). */
export function parentDirProblem(parentDir: string): string | null {
  return parentDir.split(/[\\/]/).includes('..') ? 'Pick a folder inside your workspace: no "..".' : null;
}

/** Can a Line project be asked for: a good name, a good first feature and a folder inside the workspace? */
export function canCreateLineProject(name: string, firstFeature: string, parentDir: string, creating: boolean): boolean {
  return canCreateProject(name, creating) && firstFeature.trim() !== '' && featureNameProblem(firstFeature) === null && parentDirProblem(parentDir) === null;
}
