import type { PathExpectation, ProjectTreeEntry } from '../types';

/** Whether an entry (or the folder being viewed) is an acceptable answer for a question: a route needs a folder that
 * holds a page file, or a code file (a controller for a react-spa project); a folder question accepts any folder. */
export function canChoose(expects: PathExpectation, entry: Pick<ProjectTreeEntry, 'kind' | 'route'>): boolean {
  if (expects === 'dir') return entry.kind === 'dir';
  return entry.kind === 'file' || entry.route;
}

/** The folders leading to `path`, for a breadcrumb: 'src/app/home' -> [{name:'src',path:'src'}, ...]. */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

/** Why a row cannot be chosen, shown next to it; empty when it can. */
export function chooseHint(expects: PathExpectation, entry: Pick<ProjectTreeEntry, 'kind' | 'route'>): string {
  if (canChoose(expects, entry)) return '';
  return expects === 'route' ? 'no page file here — open it to look inside' : '';
}
