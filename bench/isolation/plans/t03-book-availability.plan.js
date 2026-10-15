// Plan sketch, t03 (intro, BK-3): availability as words, from the book's available field only (no loans yet), and
// no raw true/false left on the page.
export function availability(book) { return book.available ? 'Available' : 'On loan'; }
export function view(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  const word = availability(book);
  return { contains: [word], absent: [word === 'Available' ? 'On loan' : 'Available', 'true', 'false'] };
}
// Wrong on purpose: the labels swapped (the K5b 1.5b plan's mistake).
export function wrongView(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  const word = book.available ? 'On loan' : 'Available';
  return { contains: [word], absent: [word === 'Available' ? 'On loan' : 'Available'] };
}
