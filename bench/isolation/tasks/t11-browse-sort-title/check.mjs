// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  if (t.readsFixture()) fail('the page imports a fixture; it must read data through its feature service');
  const Page = t.component();
  const c = await t.render(t.h(Page));
  const got = t.links(c).filter((l) => l.getAttribute('href').startsWith('/books/')).map((l) => t.norm(l.textContent));
  const want = t.books.map((b) => b.title).sort((a, b) => a.localeCompare(b));
  if (got.length !== 15) fail('expected 15 book links, got ' + got.length);
  if (JSON.stringify(got) !== JSON.stringify(want)) fail('order is not title A-Z: first titles ' + JSON.stringify(got.slice(0, 4)));
}
