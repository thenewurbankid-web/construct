// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  if (t.readsFixture()) fail('the page imports a fixture; it must read data through its feature service');
  const Page = t.component();
  const c = await t.render(t.h(Page, { params: { id: 'salt-and-lanterns' } }));
  if (!t.text(c).includes('312 pages')) fail('missing text "312 pages"');
  const d = await t.render(t.h(Page, { params: { id: 'orchard-at-night' } }));
  if (!t.text(d).includes('248 pages')) fail('missing text "248 pages" (orchard-at-night)');
  if (t.norm(d.querySelector('h1')?.textContent) !== 'Orchard at Night') fail('h1 is not the book title');
}
