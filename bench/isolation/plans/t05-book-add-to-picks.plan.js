// Plan sketch, t05 (BK-2, BK-3): an available book has an enabled "Add to my picks" button; pressing it adds the
// book's id to the picks and shows "Added to your picks". An on-loan book has no enabled button.
export function view(s, lib) {
  const book = lib.findBook({ id: s.props.params.id });
  if (!book.available) return { noEnabledButton: ['Add to my picks'], picks: [] };
  const pressed = (s.actions ?? []).some((a) => a.click === 'Add to my picks');
  if (!pressed) return { buttons: [{ text: 'Add to my picks', disabled: false }], picks: [] };
  return { contains: ['Added to your picks'], picks: [book.id] };
}
// Wrong on purpose: the status text off by one word.
export function wrongView(s, lib) {
  const v = view(s, lib);
  return v.contains ? { ...v, contains: ['Added to my picks'] } : v;
}
