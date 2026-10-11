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

/** The features "Base on this" may write into: those whose components folder lies inside `folder` (or every feature
 * for the whole project). Offering a feature outside the folder only led to a refusal (pre-UAT cu6: the form opened on
 * billing while the folder was features/orders). A feature's folder is read from its rows; with none, `features/`. */
export function writableFeatures(view: LibraryView, folder: string | null): string[] {
  if (!folder) return view.featureNames;
  const rootOf = (name: string) => {
    const file = view.features.find((f) => f.name === name)?.rows[0]?.file;
    const at = file ? file.indexOf(`/${name}/`) : -1;
    return at >= 0 ? `${file!.slice(0, at)}/${name}` : `features/${name}`;
  };
  return view.featureNames.filter((name) => isInWorkspace(folder, `${rootOf(name)}/components/New.tsx`));
}
