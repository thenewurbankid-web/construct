// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const Page = t.component();
  const c = await t.render(t.h(Page));
  const titles = () => t.links(c).filter((l) => l.getAttribute('href').startsWith('/books/')).map((l) => t.norm(l.textContent));
  const sel = t.byLabel(c, 'Genre');
  if (!sel || sel.tagName !== 'SELECT') { fail('no <select> labelled "Genre"'); return; }
  const opts = [...sel.options].map((o) => t.norm(o.textContent));
  if (JSON.stringify(opts) !== JSON.stringify(['All genres', 'Fiction', 'History', 'Science'])) fail('options are ' + JSON.stringify(opts));
  if (titles().length !== 15) fail('default: expected 15 books, got ' + titles().length);
  const hist = [...sel.options].find((o) => t.norm(o.textContent) === 'History');
  if (!hist) return;
  await t.change(sel, hist.value);
  const want = t.books.filter((b) => b.genre === 'History').map((b) => b.title).sort();
  if (JSON.stringify(titles().slice().sort()) !== JSON.stringify(want)) fail('History: got ' + JSON.stringify(titles()));
  const all = [...sel.options].find((o) => t.norm(o.textContent) === 'All genres');
  if (all) { await t.change(sel, all.value); if (titles().length !== 15) fail('back to All genres: expected 15, got ' + titles().length); }
}
