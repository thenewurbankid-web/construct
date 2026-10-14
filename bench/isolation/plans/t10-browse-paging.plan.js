// Plan sketch, t10 (BRW-1, BRW-2): six books a page, a line "Page <n> of <total>", "Previous page" disabled on the
// first page and "Next page" disabled on the last.
export function pageOf(items, page, size) { return items.slice(page * size, page * size + size); }
export function pageView(s, lib, size) {
  const items = lib.listBooks({});
  const total = Math.ceil(items.length / size);
  let page = 0;
  for (const a of s.actions ?? []) {
    if (a.click === 'Next page') page = Math.min(page + 1, total - 1);
    if (a.click === 'Previous page') page = Math.max(page - 1, 0);
  }
  return {
    links: pageOf(items, page, size).map((b) => ({ text: b.title, href: '/books/' + b.id })),
    contains: ['Page ' + (page + 1) + ' of ' + total],
    buttons: [{ text: 'Previous page', disabled: page === 0 }, { text: 'Next page', disabled: page === total - 1 }],
  };
}
export function view(s, lib) { return pageView(s, lib, 6); }
// Wrong on purpose: five books a page.
export function wrongView(s, lib) { return pageView(s, lib, 5); }
