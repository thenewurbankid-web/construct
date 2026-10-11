// cu6: pure path rules of the Line workspace folder, shared by the shell and every Line screen (and importable by
// their node specs, so no imports here). Mirrors packages/engine/line/workspace.mjs isInsideWorkspace; the server's
// writer is what actually refuses a change outside the folder.

/** True when the root-relative `file` lies inside `folder` ('' = the whole project). */
export function isInWorkspace(folder: string, file: string): boolean {
  return folder === '' || file === folder || file.startsWith(`${folder}/`);
}

/** How the folder reads in the Cockpit: "Whole project" or the folder path. */
export function workspaceLabel(folder: string): string {
  return folder === '' ? 'Whole project' : folder;
}
