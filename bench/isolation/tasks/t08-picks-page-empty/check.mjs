// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const Page = t.component();
  localStorage.clear();
  const c = await t.render(t.h(Page));
  if (t.norm(c.querySelector('h1')?.textContent) !== 'My picks') fail('h1 is not "My picks"');
  if (!t.text(c).includes('You have not picked any books yet')) fail('missing "You have not picked any books yet"');
  if (/Request these books/.test(t.text(c))) fail('empty page still offers "Request these books"');
}
