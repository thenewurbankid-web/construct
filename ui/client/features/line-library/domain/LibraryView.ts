// Pure (DOMAIN-001): a LineProject turned into exactly what the Line Components screen renders, and which screen
// a load state shows.
import type { LibraryView, LineProject, LineProjectState, LineScreen } from '../types.ts';
import { featureSections } from './FeatureSections.ts';
import { libraryGroups } from './LibraryGroups.ts';

export function buildLibraryView(project: LineProject): LibraryView {
  const groups = libraryGroups(project);
  return { total: groups.reduce((n, g) => n + g.cards.length, 0), groups, features: featureSections(project) };
}

/** What the Components screen shows for a load state: a loading note, today's screen (not a Line project, or the
 * Line view could not be read), or the Line library. */
export function screenFor(state: LineProjectState): LineScreen {
  if (state.status === 'loading') return { kind: 'loading' };
  if (state.status === 'ready' && state.project.isLine) return { kind: 'line', view: buildLibraryView(state.project) };
  return { kind: 'fallback' };
}
