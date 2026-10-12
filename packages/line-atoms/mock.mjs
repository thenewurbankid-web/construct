// Line logic atoms, the mock: the catalog's contract with a fixed list of descriptors, for callers (the drafter, the
// Line check) that test against it without reading atoms/ from disk.
import { assertAtom } from './contract.mjs';

/**
 * A catalog over the given descriptors (each checked), recording every request matchAtoms was asked.
 * @param {import('./contract.mjs').AtomDescriptor[]} [atoms]
 * @returns {{calls: string[], listAtoms: () => import('./contract.mjs').AtomDescriptor[], getAtom: (id: string) => import('./contract.mjs').AtomDescriptor|null, matchAtoms: (request: string) => import('./contract.mjs').AtomMatch[]}}
 */
export function createMockAtoms(atoms = []) {
  const list = atoms.map((a) => assertAtom(a));
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    listAtoms: () => list,
    getAtom: (id) => list.find((a) => a.id === id) ?? null,
    matchAtoms(request) {
      calls.push(request);
      const text = String(request).toLowerCase();
      return list
        .filter((a) => a.phrases.some((p) => text.includes(p.toLowerCase())))
        .map((a) => ({ id: a.id, role: a.role, title: a.title, sentence: a.english, confidence: 1, import: `@line/atoms/${a.id}` }));
    },
  };
}
