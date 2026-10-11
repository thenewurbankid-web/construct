import type { FeatureItem, LineProject, PageRow } from '../types';

/** "Based on ListPage", or a plain-English problem when the base is missing or names nothing in the library. */
export function baseText(project: LineProject, item: FeatureItem): { ok: boolean; text: string } {
  const { value, libraryId } = item.base;
  if (libraryId) {
    const lib = project.library.find((l) => l.id === libraryId);
    return { ok: true, text: `Based on ${lib ? lib.name : libraryId.split('/').pop()}` };
  }
  if (value) return { ok: false, text: `Its base "${value}" is not in the library, so pick a library page for it.` };
  return { ok: false, text: 'It has no library base yet, so pick the library page it is based on.' };
}

/** The pages of one feature, as rows for the screen. An unknown feature has none. */
export function featurePages(project: LineProject, feature: string): PageRow[] {
  const f = project.features.find((x) => x.name === feature);
  if (!f) return [];
  return f.items
    .filter((it) => it.kind === 'pages')
    .map((it) => ({ id: it.id, name: it.name, file: it.file, status: it.status, base: baseText(project, it), findings: it.findings }));
}

/** The feature item behind a page row id, or null (only pages count). */
export function findPage(project: LineProject, pageId: string | null): FeatureItem | null {
  if (!pageId) return null;
  for (const f of project.features) for (const it of f.items) if (it.id === pageId && it.kind === 'pages') return it;
  return null;
}
