// Pure (DOMAIN-001), Line cu6: which cards and feature rows of the Components screen lie outside the project's
// workspace folder, so Line will not change them (they show a quiet "Read-only" tag).
import { isInWorkspace } from '../../../lib/lineWorkspacePaths.ts';
import type { LibraryView, LineScreen } from '../types.ts';

/** Mark every card and feature row outside `folder` read-only. null (not read yet, or no project) or '' (the whole
 * project) marks nothing. */
export function markReadOnly(view: LibraryView, folder: string | null): LibraryView {
  if (!folder) return view;
  return {
    ...view,
    groups: view.groups.map((g) => ({ ...g, cards: g.cards.map((c) => ({ ...c, readOnly: !isInWorkspace(folder, c.file) })) })),
    features: view.features.map((f) => ({ ...f, rows: f.rows.map((r) => ({ ...r, readOnly: !isInWorkspace(folder, r.file) })) })),
  };
}

/** The screen with its view marked (loading and fallback screens pass through). */
export function screenWithWorkspace(screen: LineScreen, folder: string | null): LineScreen {
  return screen.kind === 'line' ? { kind: 'line', view: markReadOnly(screen.view, folder) } : screen;
}
