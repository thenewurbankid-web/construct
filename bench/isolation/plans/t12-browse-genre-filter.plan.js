// Plan sketch, t12 (BRW-4, no paging yet): a select labelled "Genre" offering All genres, Fiction, History, Science;
// picking a genre lists only that genre's books, All genres lists every book (order not specified).
export function genresOf(books) { return [...new Set(books.map((b) => b.genre))].sort(); }
export function filterView(s, lib, options) {
  const items = lib.listBooks({});
  let genre = 'All genres';
  for (const a of s.actions ?? []) if (a.change === 'Genre') genre = a.value;
  const shown = genre === 'All genres' ? items : items.filter((b) => b.genre === genre);
  return {
    selects: [{ label: 'Genre', options: options(items) }],
    links: shown.map((b) => ({ text: b.title, href: '/books/' + b.id })),
    unordered: true,
  };
}
export function view(s, lib) { return filterView(s, lib, (items) => ['All genres', ...genresOf(items)]); }
// Wrong on purpose: no "All genres" option.
export function wrongView(s, lib) { return filterView(s, lib, (items) => genresOf(items)); }
