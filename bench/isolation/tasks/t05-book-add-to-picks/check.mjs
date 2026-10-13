// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const Page = t.component();
  localStorage.clear();
  const a = await t.render(t.h(Page, { params: { id: 'salt-and-lanterns' } }));
  const [btn] = t.buttons(a, 'Add to my picks');
  if (!btn) { fail('available book: no "Add to my picks" button'); }
  else {
    await t.click(btn);
    const picks = t.mod.store.listPicks();
    if (!picks.includes('salt-and-lanterns')) fail('click did not add the book to the picks store (got ' + JSON.stringify(picks) + ')');
    if (!t.text(a).includes('Added to your picks')) fail('no "Added to your picks" message after the click');
  }
  const b = await t.render(t.h(Page, { params: { id: 'winter-ferry' } }));
  if (t.buttons(b, 'Add to my picks').some((x) => !x.disabled)) fail('on-loan book (winter-ferry) has an enabled "Add to my picks" button');
}
