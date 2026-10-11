'use client';

import { canCreateProject, projectDestination, projectNameProblem } from '../domain/NewProjectName';
import { canCreateLineProject, featureNameProblem, parentDirProblem } from '../domain/LineProjectFields';
import { useNewProject } from '../hooks/useNewProject';
import { NewProjectPage } from '../pages/NewProjectPage';
import '../components/new-project.css';

/** The "New project" form. `onCreated` receives the absolute folder of the project the server just made and
 * initialised; the caller (the Open-a-project screen) opens it, exactly as it does for a finished clone. */
export function NewProjectController({ onCreated, workspaceRoot = null }: { onCreated: (dir: string) => void; workspaceRoot?: string | null }) {
  const p = useNewProject(onCreated);
  const { name, framework, firstFeature, parentDir, creating, error } = p.state;
  const isLine = framework === 'line';
  return (
    <NewProjectPage
      name={name}
      framework={framework}
      firstFeature={firstFeature}
      parentDir={parentDir}
      nameProblem={projectNameProblem(name)}
      featureProblem={featureNameProblem(firstFeature)}
      parentProblem={parentDirProblem(parentDir)}
      destination={name.trim() === '' ? null : projectDestination(workspaceRoot, name, isLine ? parentDir : '')}
      canCreate={isLine ? canCreateLineProject(name, firstFeature, parentDir, creating) : canCreateProject(name, creating)}
      creating={creating}
      error={error}
      onName={p.setName}
      onFramework={p.setFramework}
      onFirstFeature={p.setFirstFeature}
      onParentDir={p.setParentDir}
      onCreate={p.create}
    />
  );
}
