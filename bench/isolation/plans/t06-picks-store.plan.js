// Plan sketch, t06: the picks are a JSON array of ids under localStorage "picks", in the order added; adding an id
// that is already there does nothing; removing takes it off. Run over a scenario's store ops.
export function addPick(picks, id) { return picks.includes(id) ? picks : [...picks, id]; }
export function removePick(picks, id) { return picks.filter((p) => p !== id); }
export function simulate(s, add) {
  let raw = null;
  const read = () => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
  const lists = [];
  const stored = [];
  for (const [op, arg] of s.ops) {
    if (op === 'list') lists.push(read());
    else if (op === 'add') raw = JSON.stringify(add(read(), arg));
    else if (op === 'remove') raw = JSON.stringify(removePick(read(), arg));
    else if (op === 'set') raw = arg;
    else if (op === 'raw') stored.push(JSON.parse(raw));
  }
  return { lists, stored };
}
export function view(s) { return simulate(s, addPick); }
// Wrong on purpose: adding an id that is already there adds it again.
export function wrongView(s) { return simulate(s, (picks, id) => [...picks, id]); }
