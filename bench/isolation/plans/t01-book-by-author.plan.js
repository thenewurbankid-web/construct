// Plan sketch, t01 (BK-1), written from the goal and SPEC only: the book page's heading is the book's title and it
// shows "by <author>". view(scenario, lib) is what the page shows (a View, quickjs/view.mjs); wrongView is
// deliberately wrong: the author without "by".
export function bookPage(book) {
  return { h1: book.title, contains: ['by ' + book.author] };
}
export function view(s, lib) { return bookPage(lib.findBook({ id: s.props.params.id })); }
export function wrongView(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  return { h1: book.title, contains: [book.author] };
}
