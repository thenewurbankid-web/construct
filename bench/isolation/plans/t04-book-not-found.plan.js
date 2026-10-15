// Plan sketch, t04 (BK-4): every book page links "Back to the catalogue" to /; an unknown id says
// "We could not find that book" with the same link.
const BACK = { text: 'Back to the catalogue', href: '/' };
export function view(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  if (!book) return { contains: ['We could not find that book'], links: [BACK] };
  return { h1: book.title, links: [BACK] };
}
// Wrong on purpose: the start file's link text.
export function wrongView(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  const back = { text: 'Back to Books', href: '/' };
  return book ? { h1: book.title, links: [back] } : { contains: ['We could not find that book'], links: [back] };
}
