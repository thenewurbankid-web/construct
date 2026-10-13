// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  if (t.readsFixture()) fail('the page imports a fixture; it must read data through its feature service');
  const Page = t.component();
  localStorage.clear();
  localStorage.setItem('picks', JSON.stringify(['salt-and-lanterns', 'copper-roads']));
  const c = await t.render(t.h(Page));
  if (t.norm(c.querySelector('h1')?.textContent) !== 'My picks') fail('h1 is not "My picks"');
  for (const s of ['Salt and Lanterns', 'Ines Okafor', 'Copper Roads', 'Mara Quill']) if (!t.text(c).includes(s)) fail('missing text "' + s + '"');
  const [rm] = t.buttons(c, 'Remove Salt and Lanterns');
  if (!rm) { fail('no button "Remove Salt and Lanterns"'); return; }
  if (!t.buttons(c, 'Remove Copper Roads').length) fail('no button "Remove Copper Roads"');
  await t.click(rm);
  if (t.text(c).includes('Salt and Lanterns')) fail('removed book still listed after the click');
  const left = t.mod.store.listPicks();
  if (JSON.stringify(left) !== JSON.stringify(['copper-roads'])) fail('store after remove is ' + JSON.stringify(left));
}
