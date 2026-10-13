// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const Page = t.component();
  const c = await t.render(t.h(Page));
  const ids = () => t.links(c).map((l) => l.getAttribute('href')).filter((h) => h.startsWith('/books/'));
  const btn = (n) => t.buttons(c, n)[0];
  if (ids().length !== 6) fail('page 1: expected 6 book links, got ' + ids().length);
  if (!t.text(c).includes('Page 1 of 3')) fail('missing "Page 1 of 3"');
  if (!btn('Previous page')) { fail('no "Previous page" button'); }
  else if (!btn('Previous page').disabled) fail('"Previous page" not disabled on page 1');
  if (!btn('Next page')) { fail('no "Next page" button'); return; }
  if (btn('Next page').disabled) { fail('"Next page" disabled on page 1'); return; }
  const first = ids().join();
  await t.click(btn('Next page'));
  if (!t.text(c).includes('Page 2 of 3')) fail('after Next: missing "Page 2 of 3"');
  if (ids().join() === first) fail('after Next: same books shown');
  await t.click(btn('Next page'));
  if (!t.text(c).includes('Page 3 of 3')) fail('after Next twice: missing "Page 3 of 3"');
  if (ids().length !== 3) fail('page 3: expected 3 book links, got ' + ids().length);
  if (!btn('Next page')?.disabled) fail('"Next page" not disabled on the last page');
}
