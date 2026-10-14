// Plan sketch, t11 (BRW-3, default order only): the catalogue lists the books by title A-Z.
export function sortByTitle(books) { return books.slice().sort((a, b) => a.title.localeCompare(b.title)); }
export function view(_s, lib) {
  return { links: sortByTitle(lib.listBooks({})).map((b) => ({ text: b.title, href: '/books/' + b.id })) };
}
// Wrong on purpose: ordered by author.
export function wrongView(_s, lib) {
  return { links: lib.listBooks({}).slice().sort((a, b) => a.author.localeCompare(b.author)).map((b) => ({ text: b.title, href: '/books/' + b.id })) };
}
