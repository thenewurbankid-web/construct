'use client';

import { canCreateProject, projectDestination, projectNameProblem } from '../domain/NewProjectName';
import { useNewProject } from '../hooks/useNewProject';
import { NewProjectPage } from '../pages/NewProjectPage';
import '../components/new-project.css';

/** The "New project" form. `onCreated` receives the absolute folder of the project the server just made and
 * initialised; the caller (the Open-a-project screen) opens it, exactly as it does for a finished clone. */
export function NewProjectController({ onCreated, workspaceRoot = null }: { onCreated: (dir: string) => void; workspaceRoot?: string | null }) {
  const p = useNewProject(onCreated);
  const { name, framework, creating, error } = p.state;
  return (
    <NewProjectPage
      name={name}
      framework={framework}
      nameProblem={projectNameProblem(name)}
      destination={name.trim() === '' ? null : projectDestination(workspaceRoot, name)}
      canCreate={canCreateProject(name, creating)}
      creating={creating}
      error={error}
      onName={p.setName}
      onFramework={p.setFramework}
      onCreate={p.create}
    />
  );
}
