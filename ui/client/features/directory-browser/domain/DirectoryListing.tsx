import type { DirBadge, DirEntryView, DirListingView, RawDirEntry, RawDirListing } from '../types';

/** Pure mapper: which human-readable marker badges a directory earns.
 * A Construct project (architecture.yml) is the strongest signal; React and
 * plain package.json are shown alongside so a human can tell what they are
 * about to pick. */
export function badgesFor(flags: Pick<RawDirEntry, 'isConstructProject' | 'isReact' | 'hasPackageJson'>): DirBadge[] {
  const badges: DirBadge[] = [];
  if (flags.isConstructProject) badges.push({ key: 'construct', label: 'Construct project' });
  if (flags.isReact) badges.push({ key: 'react', label: 'React' });
  else if (flags.hasPackageJson) badges.push({ key: 'package', label: 'package.json' });
  return badges;
}

export function toEntryView(entry: RawDirEntry): DirEntryView {
  const badges = badgesFor(entry);
  return { name: entry.name, path: entry.path, badges, looksLikeProject: badges.length > 0 };
}

/** Maps the server listing to what the presentational picker renders. */
export function toListingView(raw: RawDirListing): DirListingView {
  return {
    path: raw.path,
    parent: raw.parent,
    entries: raw.entries.map(toEntryView),
    total: raw.total,
    truncated: raw.truncated,
    currentBadges: badgesFor(raw.current),
  };
}
