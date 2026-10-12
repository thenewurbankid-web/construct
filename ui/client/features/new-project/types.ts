/** What "New project" can start from: the frameworks of the server's closed set (newProjectApi.mjs), or a Line
 * project (a library and features, POST /api/line/new-project). */
export type NewProjectFramework = 'nextjs' | 'react-spa' | 'line';

/** What the server answered to POST /api/projects: the new folder (already the open project), or a plain refusal. */
export type NewProjectResult = { ok: true; name: string; dir: string } | { ok: false; error: string };

/** The questions, one at a time: the name, what kind of project, then a last look and Create. */
export type NewProjectStep = 'name' | 'kind' | 'confirm';

/** The form's state (see workflows/NewProject.ts). */
export type NewProjectFormState = {
  /** The question on screen. */
  step: NewProjectStep;
  name: string;
  framework: NewProjectFramework;
  /** Line only: the one empty feature the project starts with. */
  firstFeature: string;
  /** Line only: the workspace folder the project goes in ("" is the workspace itself). */
  parentDir: string;
  /** The request is in flight (or the project was made and the screen is about to reload into it). */
  creating: boolean;
  error: string | null;
};
