// Pure (DOMAIN-001): when Next may be pressed on a "From GitHub" question, and which question a refusal belongs to.
// Advice only: the server is the judge.
import type { CloneStep } from '../types.ts';
import { branchProblem, folderNameProblem, tokenProblem } from './CloneFieldHints.ts';
import { readCloneForm } from './CloneFormView.ts';

type Answers = { input: string; name: string; branch: string | null; token: string; isPrivate: boolean | null };

/** May Next (or "Bring it in", on the last step) be pressed on this question? */
export function canLeaveCloneStep(step: CloneStep, a: Answers, working: boolean): boolean {
  if (working) return false;
  const reading = readCloneForm(a.input, a.branch);
  const linkOk = a.input.trim() !== '' && reading.inputProblem === null;
  if (step === 'link') return linkOk;
  if (step === 'private') return a.isPrivate !== null && (a.isPrivate === false || tokenProblem(a.token) === null);
  return linkOk && folderNameProblem(a.name) === null && branchProblem(reading.branch) === null && tokenProblem(a.token) === null;
}

/** The question a refusal belongs to: access (private, token, sign-in) -> "Is it private?", the folder or branch ->
 * the last step (under More options), anything else (the link itself, not found) -> the link. */
export function cloneRefusalStep(error: string): CloneStep {
  if (/token|private|access|permission|sign in|log ?in|authori[sz]/i.test(error)) return 'private';
  if (/folder|branch|already/i.test(error)) return 'confirm';
  return 'link';
}
