// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const Page = t.component();
  const c = await t.render(t.h(Page, { params: { id: 'salt-and-lanterns' } }));
  if (t.norm(c.querySelector('h1')?.textContent) !== 'Salt and Lanterns') fail('h1 is not the book title');
  if (!t.text(c).includes('by Ines Okafor')) fail('missing text "by Ines Okafor"');
  const d = await t.render(t.h(Page, { params: { id: 'copper-roads' } }));
  if (!t.text(d).includes('by Mara Quill')) fail('missing text "by Mara Quill" (copper-roads)');
}
