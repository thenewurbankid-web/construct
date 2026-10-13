// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  if (t.readsFixture()) fail('the page imports a fixture; it must read data through its feature service');
  const Page = t.component();
  const c = await t.render(t.h(Page));
  if (t.norm(c.querySelector('h1')?.textContent) !== 'Library catalogue') fail('h1 is not "Library catalogue"');
  const txt = t.text(c);
  const avail = (txt.match(/Available/g) || []).length, loan = (txt.match(/On loan/g) || []).length;
  if (avail !== 13) fail('expected "Available" 13 times, got ' + avail);
  if (loan !== 2) fail('expected "On loan" 2 times, got ' + loan);
  if (/\b(true|false)\b/.test(txt)) fail('raw true/false still visible');
  if (t.links(c).filter((l) => l.getAttribute('href').startsWith('/books/')).length !== 15) fail('expected 15 title links to /books/<id>');
}
