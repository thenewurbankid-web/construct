// Pure (DOMAIN-001): the #375 Ctrl P quick-open entries — one "Go to page" command per
// page, so opening the palette and typing a feature or file name jumps straight to it
// (the same registry every other screen's commands use, per docs/design/ia-five-screens.md §8).
export type PageCommandSpec = {
  id: string;
  title: string;
  keywords: string[];
  group: string;
  feature: string;
  file: string;
};

/** One spec per page, ids stable on `feature`+`file` (safe to re-register on every list load). */
export function pageCommandSpecs(pages: { feature: string; file: string }[]): PageCommandSpec[] {
  return pages.map((p) => ({
    id: `page.${p.feature}/${p.file}`,
    title: `Go to ${p.feature}/${p.file}`,
    keywords: ['open', 'page', 'file', p.feature, p.file],
    group: 'Go to page',
    feature: p.feature,
    file: p.file,
  }));
}
