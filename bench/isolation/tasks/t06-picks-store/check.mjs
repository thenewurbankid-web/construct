// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const s = t.mod.store;
  for (const fn of ['listPicks', 'addPick', 'removePick']) if (typeof s[fn] !== 'function') { fail('missing export ' + fn); return; }
  localStorage.clear();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!eq(s.listPicks(), [])) fail('empty store: listPicks() is not []');
  s.addPick('a'); s.addPick('b'); s.addPick('a');
  if (!eq(s.listPicks(), ['a', 'b'])) fail('after add a, b, a: expected ["a","b"], got ' + JSON.stringify(s.listPicks()));
  s.removePick('a');
  if (!eq(s.listPicks(), ['b'])) fail('after remove a: expected ["b"], got ' + JSON.stringify(s.listPicks()));
  let stored; try { stored = JSON.parse(localStorage.getItem('picks')); } catch { stored = undefined; }
  if (!eq(stored, ['b'])) fail('localStorage "picks" is not the JSON array ["b"] (got ' + localStorage.getItem('picks') + ')');
  localStorage.setItem('picks', JSON.stringify(['x', 'y']));
  if (!eq(s.listPicks(), ['x', 'y'])) fail('listPicks() does not read localStorage (reload case)');
}
