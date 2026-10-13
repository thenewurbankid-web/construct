// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  if (t.readsFixture()) fail('the page imports a fixture; it must read data through its feature service');
  const Page = t.component();
  const backOk = (c) => t.links(c).some((l) => t.norm(l.textContent) === 'Back to the catalogue' && l.getAttribute('href') === '/');
  const a = await t.render(t.h(Page, { params: { id: 'glass-harbour' } }));
  if (!backOk(a)) fail('known book: no link "Back to the catalogue" to /');
  if (t.norm(a.querySelector('h1')?.textContent) !== 'Glass Harbour') fail('known book: h1 is not the title');
  const b = await t.render(t.h(Page, { params: { id: 'no-such-book' } }));
  if (!t.text(b).includes('We could not find that book')) fail('unknown id: missing "We could not find that book"');
  if (!backOk(b)) fail('unknown id: no link "Back to the catalogue" to /');
}
