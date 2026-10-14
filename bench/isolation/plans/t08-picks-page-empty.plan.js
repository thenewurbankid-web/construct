// Plan sketch, t08 (PCK-2, PCK-5): the heading is "My picks"; with no picks the page says
// "You have not picked any books yet" and offers no "Request these books"; with picks it does not say it.
const EMPTY = 'You have not picked any books yet';
export function view(s) {
  const ids = s.picks ?? [];
  if (!ids.length) return { h1: 'My picks', contains: [EMPTY], absent: ['Request these books'] };
  return { h1: 'My picks', absent: [EMPTY] };
}
// Wrong on purpose: a different empty text.
export function wrongView(s) {
  const v = view(s);
  return v.contains ? { ...v, contains: ['No picks yet'] } : v;
}
