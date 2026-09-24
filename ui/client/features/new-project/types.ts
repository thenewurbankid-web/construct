/** The frameworks "New project" can start from (mirrors the server's closed set, newProjectApi.mjs). */
export type NewProjectFramework = 'nextjs' | 'react-spa';

/** What the server answered to POST /api/projects: the new folder (already the open project), or a plain refusal. */
export type NewProjectResult = { ok: true; name: string; dir: string } | { ok: false; error: string };

/** The form's state (see workflows/NewProject.ts). */
export type NewProjectFormState = {
  name: string;
  framework: NewProjectFramework;
  /** The request is in flight (or the project was made and the screen is about to reload into it). */
  creating: boolean;
  error: string | null;
};
