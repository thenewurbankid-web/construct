import type { LineProject } from '../types';
import { featurePages } from './PageRows.ts';

/** The feature names of a Line project, in the order the project lists them. */
export function featureNames(project: LineProject): string[] {
  return project.features.map((f) => f.name);
}

/** One line about a feature for the picker: how many pages it has and how many need attention. */
export function featureSummary(project: LineProject, feature: string): string {
  const pages = featurePages(project, feature);
  if (pages.length === 0) return 'No pages yet.';
  const problems = pages.filter((p) => p.status === 'problem').length;
  const count = pages.length === 1 ? 'One page' : `${pages.length} pages`;
  if (problems === 0) return `${count}, all fine.`;
  return `${count}, ${problems === 1 ? 'one needs' : `${problems} need`} attention.`;
}
