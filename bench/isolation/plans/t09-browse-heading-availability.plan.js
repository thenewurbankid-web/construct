// Plan sketch, t09 (BRW-1, wording only; every book is listed): heading "Library catalogue"; each book's title links
// to /books/<id> and the book shows "Available" or "On loan"; no raw true/false.
export function availability(book) { return book.available ? 'Available' : 'On loan'; }
export function view(_s, lib) {
  const items = lib.listBooks({});
  return {
    h1: 'Library catalogue',
    links: items.map((b) => ({ text: b.title, href: '/books/' + b.id })),
    lines: items.flatMap((b) => [b.title, availability(b)]),
    absent: ['true', 'false'],
  };
}
// Wrong on purpose: the start file's heading.
export function wrongView(s, lib) { return { ...view(s, lib), h1: 'Books' }; }
