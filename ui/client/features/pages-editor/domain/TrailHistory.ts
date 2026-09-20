import type { NavView, Trail } from '../types';

// Pure (DOMAIN-001): the breadcrumb trail of files visited by following references (#321). It is a
// history, not the file tree.

export const emptyTrail: Trail = { steps: [], index: -1 };

/** Display name of a page file: `features/catalog/pages/HomePage.tsx` -> `HomePage`. */
export function fileTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '');
}

export function startTrail(view: NavView): Trail {
  return { steps: [{ name: fileTitle(view.path), relation: null, view }], index: 0 };
}
