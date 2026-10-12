'use client';

import { projectDestination, projectNameProblem } from '../domain/NewProjectName';
import { featureNameProblem, parentDirProblem } from '../domain/LineProjectFields';
import { canLeaveStep } from '../domain/NewProjectStepRules';
import { NEW_PROJECT_STEPS } from '../domain/NewProjectSteps';
import { PROJECT_KINDS } from '../domain/ProjectKinds';
import { useNewProject } from '../hooks/useNewProject';
import { NewProjectPage } from '../pages/NewProjectPage';
import '../components/new-project.css';

/** The "New project" question series. `onCreated` receives the absolute folder of the project the server just made
 * and initialised; the caller (the Open-a-project screen) opens it, exactly as it does for a finished clone. */
export function NewProjectController({ onCreated, workspaceRoot = null }: { onCreated: (dir: string) => void; workspaceRoot?: string | null }) {
  const p = useNewProject(onCreated);
  const { step, name, framework, firstFeature, parentDir, creating, error } = p.state;
  const isLine = framework === 'line';
  return (
    <NewProjectPage
      steps={NEW_PROJECT_STEPS}
      kinds={PROJECT_KINDS}
      step={step}
      name={name}
      framework={framework}
      firstFeature={firstFeature}
      parentDir={parentDir}
      nameProblem={projectNameProblem(name)}
      featureProblem={featureNameProblem(firstFeature)}
      parentProblem={parentDirProblem(parentDir)}
      destination={name.trim() === '' ? null : projectDestination(workspaceRoot, name, isLine ? parentDir : '')}
      canNext={canLeaveStep(step, p.state)}
      creating={creating}
      error={error}
      onName={p.setName}
      onFramework={p.setFramework}
      onFirstFeature={p.setFirstFeature}
      onParentDir={p.setParentDir}
      onNext={p.next}
      onBack={p.back}
      onCreate={p.create}
    />
  );
}
