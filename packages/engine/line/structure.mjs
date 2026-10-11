// Expressions (System 1 groundwork) -- delexicalized structure hashes: steps are transitions between structure states.
// A hash covers what the project IS, never what things are CALLED: item kinds (the layers), roles (a component's
// level), base links and import edges (as the kind and level of the library item they point at), and whether a feature
// has a spec. Two projects that differ only in names hash the same; adding, removing or re-basing an item changes the
// hash of its layer, its feature and the project.
//
// Mirrors the shape the System 1 drafter's canonical hash describes (kinds, roles, layers, base links, import edges,
// names as slots). Known gaps until the drafter's canonical function lands here: flow states/transitions are not read
// yet (readLineProject has no flow model), and edges are typed by their target's kind and level, not by a canonical
// labelling of the graph. `structureDelta` names items by typed slots, never by their names.
import crypto from 'node:crypto';

/** "sha256:<16 hex>" of a canonical JSON value. */
export const hash16 = (v) => `sha256:${crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)}`;

const libraryIndex = (project) => new Map((project.library ?? []).map((l) => [l.id, l]));
/** What a link points at, in logic terms: the library item's kind and level, or "none". */
const target = (lib, id) => { const l = id ? lib.get(id) : null; return l ? `${l.kind}:${l.level ?? '-'}` : id ? 'missing' : 'none'; };

/** One feature item as a structure tuple (no names). */
function itemShape(lib, item, usesOf) {
  const base = item.base?.libraryId ?? null;
  const role = lib.get(base)?.level ?? '-';
  return [item.kind, role, target(lib, base), [...(usesOf.get(item.file) ?? [])].sort()];
}

const sorted = (xs) => xs.map((x) => JSON.stringify(x)).sort();

/**
 * The structure hashes of a project (readLineProject's view).
 * @param {any} project
 * @returns {import('./contract.mjs').StructureHashes}
 */
export function structureOf(project) {
  const lib = libraryIndex(project);
  /** feature file -> the kinds/levels of the library items it uses (import edges) */
  const usesOf = new Map();
  for (const l of project.library ?? []) for (const u of l.usedBy ?? []) {
    if (!usesOf.has(u.file)) usesOf.set(u.file, new Set());
    usesOf.get(u.file).add(`${l.kind}:${l.level ?? '-'}`);
  }
  const library = hash16(sorted((project.library ?? []).map((l) => [l.kind, l.level ?? '-', (l.usedBy ?? []).length > 0])));
  const features = {};
  for (const f of project.features ?? []) {
    const shapes = (f.items ?? []).map((i) => itemShape(lib, i, usesOf));
    const kinds = [...new Set((f.items ?? []).map((i) => i.kind))].sort();
    const layers = Object.fromEntries(kinds.map((k) => [k, hash16(sorted(shapes.filter((s) => s[0] === k)))]));
    features[f.name] = { hash: hash16({ spec: Boolean(f.spec), items: sorted(shapes) }), layers };
  }
  const project_ = hash16({ library, features: Object.values(features).map((x) => x.hash).sort() });
  return { project: project_, library, features };
}

/**
 * The structural delta between two project views, as item lines built from typed slots (`slot` names each feature,
 * item and library item, e.g. "<feature:F1>"). Never contains a name unless `slot` returns one.
 * @param {any} before @param {any} after
 * @param {(kind: 'feature'|'item'|'lib', name: string, attrs?: Record<string, string>) => string} slot
 * @returns {{added: string[], removed: string[], changed: string[]}}
 */
export function structureDelta(before, after, slot) {
  // Slots are handed out only for what changed, so a record names nothing it does not need.
  const lines = (project) => {
    const m = new Map();
    for (const l of project.library ?? []) m.set(`lib|${l.id}`, { line: () => `library/${l.kind}/${slot('lib', l.id, { kind: l.kind })}`, shape: [l.kind, l.level ?? '-'], base: null });
    for (const f of project.features ?? []) for (const i of f.items ?? []) {
      const base = i.base?.libraryId ?? null;
      m.set(`item|${i.id}`, { line: () => `${slot('feature', f.name)}/${i.kind}/${slot('item', i.id, { kind: i.kind })}`, shape: [i.kind, base ?? 'none'], base });
    }
    return m;
  };
  const a = lines(before); const b = lines(after);
  const out = { added: [], removed: [], changed: [] };
  const show = (x) => { const line = x.line(); return x.base ? `${line} base=${slot('lib', x.base, { kind: x.base.split('/')[0] })}` : line; };
  for (const [k, x] of b) if (!a.has(k)) out.added.push(show(x));
  for (const [k, x] of a) if (!b.has(k)) out.removed.push(show(x));
  for (const [k, x] of b) if (a.has(k) && JSON.stringify(a.get(k).shape) !== JSON.stringify(x.shape)) out.changed.push(show(x));
  for (const v of Object.values(out)) v.sort();
  return out;
}
