// Pure (DOMAIN-001): each feature's own components with the library item they are based on, in plain English.
import type { FeatureComponentRow, FeatureSection, LineProject } from '../types.ts';
import { promoteText } from './ChangeText.ts';

/** How a feature component's base link reads in plain English. */
export function baseText(base: { value: string | null; libraryId: string | null }, libraryName: (id: string) => string | undefined): string {
  if (base.libraryId) return `Based on ${libraryName(base.libraryId) ?? base.libraryId}`;
  if (base.value) return `Based on ${base.value}, which is not in the library`;
  return 'No library base yet';
}

/** Each feature with its components (not pages, workflows or fixtures), features without components dropped. */
export function featureSections(project: LineProject): FeatureSection[] {
  const names = new Map(project.library.map((l) => [l.id, l.name]));
  return project.features
    .map((f) => ({
      name: f.name,
      rows: f.items
        .filter((i) => i.kind === 'components')
        .map((i): FeatureComponentRow => ({
          id: i.id,
          name: i.name,
          file: i.file,
          baseText: baseText(i.base, (id) => names.get(id)),
          linked: i.base.libraryId !== null,
          problem: i.status === 'problem',
          promoteText: promoteText(i.name, project.layout.library),
          findings: i.findings,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((f) => f.rows.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
