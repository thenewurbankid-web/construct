import type { DirBadge, DirEntryView, DirListingView, RawDirEntry, RawDirListing } from '../types';

/** Pure mapper: which human-readable marker badges a directory earns. A Construct project (architecture.yml)
 * is the strongest signal; a folder without one says so plainly ("not a Construct project yet", #568), and
 * React / plain package.json are shown alongside so a human can tell what they are about to pick. */
export function badgesFor(flags: Pick<RawDirEntry, 'isConstructProject' | 'isReact' | 'hasPackageJson'>): DirBadge[] {
  const badges: DirBadge[] = [];
  if (flags.isConstructProject) badges.push({ key: 'construct', label: 'Construct project' });
  else badges.push({ key: 'plain', label: 'not a Construct project yet' });
  if (flags.isReact) badges.push({ key: 'react', label: 'React' });
  else if (flags.hasPackageJson) badges.push({ key: 'package', label: 'package.json' });
  return badges;
}

export function toEntryView(entry: RawDirEntry): DirEntryView {
  return { name: entry.name, path: entry.path, badges: badgesFor(entry), isConstructProject: entry.isConstructProject };
}

/** Maps the server listing to what the presentational list renders. */
export function toListingView(raw: RawDirListing): DirListingView {
  return { entries: raw.entries.map(toEntryView), total: raw.total, truncated: raw.truncated };
}
