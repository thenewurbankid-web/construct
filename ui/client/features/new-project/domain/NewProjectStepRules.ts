// Pure (DOMAIN-001): when Next may be pressed on a New project question, and which question a server refusal belongs
// to. Advice only: the server is the judge.
import type { NewProjectFormState, NewProjectStep } from '../types.ts';
import { canCreateProject, projectNameProblem } from './NewProjectName.ts';
import { canCreateLineProject, featureNameProblem, parentDirProblem } from './LineProjectFields.ts';

/** The problem that stops this question from moving on, or null. */
export function stepProblem(step: NewProjectStep, s: Pick<NewProjectFormState, 'name' | 'framework' | 'firstFeature' | 'parentDir'>): string | null {
  if (step === 'name') return projectNameProblem(s.name);
  if (step === 'kind' && s.framework === 'line') return featureNameProblem(s.firstFeature) ?? parentDirProblem(s.parentDir);
  return null;
}

/** May Next (or Create, on the last step) be pressed on this question? */
export function canLeaveStep(step: NewProjectStep, s: Pick<NewProjectFormState, 'name' | 'framework' | 'firstFeature' | 'parentDir' | 'creating'>): boolean {
  if (step === 'name') return s.name.trim() !== '' && projectNameProblem(s.name) === null && !s.creating;
  if (step === 'kind') return s.framework !== 'line' || (s.firstFeature.trim() !== '' && stepProblem('kind', s) === null);
  return s.framework === 'line' ? canCreateLineProject(s.name, s.firstFeature, s.parentDir, s.creating) : canCreateProject(s.name, s.creating);
}

/** The question a server refusal belongs to: the first feature or the folder it goes in (More options under "What
 * kind") or, for everything else (a taken or bad name, a failed set-up), the name. */
export function refusalStep(error: string): NewProjectStep {
  if (/already something called|another name|project name/i.test(error)) return 'name';
  if (/feature name|first feature|that folder|that is a file|pick a folder|pick another folder/i.test(error)) return 'kind';
  return 'name';
}
