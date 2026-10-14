// Plan sketch, t07 (PCK-2): "My picks" lists each picked book's title and author with a button "Remove <title>";
// pressing it takes the book off the list and out of the store.
export function view(s, lib) {
  let ids = s.picks ?? [];
  for (const a of s.actions ?? []) {
    const gone = lib.pickedBooks({ ids }).find((b) => a.click === 'Remove ' + b.title);
    if (gone) ids = ids.filter((id) => id !== gone.id);
  }
  const books = lib.pickedBooks({ ids });
  const removed = lib.pickedBooks({ ids: (s.picks ?? []).filter((id) => !ids.includes(id)) });
  return {
    h1: 'My picks',
    contains: books.flatMap((b) => [b.title, b.author]),
    buttons: books.map((b) => ({ text: 'Remove ' + b.title })),
    absent: removed.map((b) => b.title),
    picks: ids,
  };
}
// Wrong on purpose: the buttons say only "Remove".
export function wrongView(s, lib) {
  const v = view(s, lib);
  return { ...v, buttons: v.buttons.map(() => ({ text: 'Remove' })) };
}
