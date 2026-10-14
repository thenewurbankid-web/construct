// Plan sketch, t02 (BK-1): the page count reads "<pages> pages" (like "312 pages"); the heading is the title.
export function pageCount(book) { return book.pages + ' pages'; }
export function view(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  return { h1: book.title, contains: [pageCount(book)] };
}
// Wrong on purpose: the year where the page count belongs.
export function wrongView(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  return { h1: book.title, contains: [book.year + ' pages'] };
}
