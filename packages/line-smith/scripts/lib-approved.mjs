// Approved atoms (src/atoms/approved.json): hand-kept source entries the owner approved from the fluent
// generator (packages/line-fluent/generator). gen-atoms turns each into a typed-`any` wrapper in
// src/atoms/generated/approved.ts and a catalog entry, so approved atoms survive every regeneration.
//
//   { "atom": "flatMapped", "entry": "Array.prototype.flatMap", "fluent": "clones().list(xs).and().flattens()",
//     "js": "xs.flatMap(f)", "params": [["xs", "list"], ["f", "fn"]], "kind": "copy", "approvedAt": "..." }
import { reading, parse } from './lib-sentence.mjs';

export const APPROVED_MODULE = 'approved';
const ATOM_ID = /^[a-z][A-Za-z0-9]*$/;
const PARAM = /^[A-Za-z_$][\w$]*$/;
const KINDS = ['question', 'copy', 'in-place', 'value', 'effect'];
/** Entries the hand-written facade (src/fluent) owns; an approved sentence starts a new one. */
export const HAND_WRITTEN_ENTRIES = ['checks', 'clones', 'text', 'list', 'when', 'chooses', 'matches', 'attempts', 'choose', 'match', 'attempt', 'every', 'the', 'folds', 'does'];

/** Throws on the first approved entry gen-atoms cannot emit. `taken` maps atom names already owned. */
export function checkApproved(atoms, taken = new Map()) {
  const seen = new Map(taken);
  for (const a of atoms) {
    const where = `approved ${a.atom ?? JSON.stringify(a)}`;
    if (typeof a.atom !== 'string' || !ATOM_ID.test(a.atom)) throw new Error(`${where}: atom must be a camelCase id`);
    if (seen.has(a.atom)) throw new Error(`${where}: name collision with ${seen.get(a.atom)}`);
    seen.set(a.atom, `approved (${a.entry})`);
    if (typeof a.fluent !== 'string' || !a.fluent.trim()) throw new Error(`${where}: fluent sentence is missing`);
    if (typeof a.js !== 'string' || !a.js.trim() || a.js.includes('\n')) throw new Error(`${where}: js must be one expression on one line`);
    if (!Array.isArray(a.params) || a.params.some((p) => !Array.isArray(p) || !PARAM.test(p[0]))) {
      throw new Error(`${where}: params must be [name, type] pairs with identifier names`);
    }
    if (!KINDS.includes(a.kind)) throw new Error(`${where}: kind must be one of ${KINDS.join(', ')}`);
  }
}

/** The word a sentence starts with: its fluent entry. */
export const entryWord = (fluent) => fluent.split('(')[0].trim();

/** Approved source entries -> { code (generated/approved.ts body, or null), entries (catalog entries) }. */
export function emitApproved(atoms) {
  const blocks = [];
  const entries = [];
  for (const a of atoms) {
    const names = a.params.map(([n]) => n);
    const reads = reading(a.fluent);
    const mutates = a.kind === 'in-place';
    const doc = [
      '/**',
      ` * ${a.atom}(${names.join(', ')}) reads "${reads}".`,
      ` * Approved atom (fluent generator, ${a.entry}): exactly \`${a.js}\`.`,
      ...(mutates ? [' * MUTATES its argument.'] : []),
      ' */',
    ];
    blocks.push(`${doc.join('\n')}\nexport function ${a.atom}(${names.map((n) => `${n}: any`).join(', ')}): any {\n  return (${a.js});\n}\n`);
    const entry = {
      atom: a.atom,
      module: `generated/${APPROVED_MODULE}`,
      reads,
      js: [a.js],
      pure: !mutates && a.kind !== 'effect',
      mutates,
      generated: true,
      params: a.params,
    };
    // A sentence that starts a hand-written fluent class cannot be spoken until that class takes generated steps; the
    // atom is registered, and its sentence waits as fluentPending.
    if (HAND_WRITTEN_ENTRIES.includes(entryWord(a.fluent))) entry.fluentPending = a.fluent;
    else entry.fluent = a.fluent;
    if (a.kind === 'effect') entry.impureReason = 'approved as an effect';
    if (Array.isArray(a.parts) && a.parts.length) entry.parts = a.parts;
    // The gate tested the atom with exactly these generators, so they are its check set.
    entry.check = [{ params: a.params }];
    entry.verified = true;
    entry.verifiedBy = 'approved: the C3 gate (equivalence to the JS reference) and the read-back';
    entry.approved = { entry: a.entry, approvedAt: a.approvedAt };
    entries.push(entry);
  }
  return { code: blocks.length ? blocks.join('\n') : null, entries };
}

/**
 * The fluent facade for approved sentences: src/fluent/approved.ts. Approved sentences are grouped by their entry
 * word into a tree of steps; each step is a method taking that call's arguments, and a sentence's last step calls its
 * atom with the arguments in its parameter order. `map(m).creates().at(key).to(value)` ->
 *
 *   export function map(a0: any): any {
 *     return { creates: () => ({ at: (a1: any) => ({ to: (a2: any) => createsAtTo(a0, a1, a2) }) }) };
 *   }
 *
 * Returns { code, entries } where entries are the new entry words (the facade's exports).
 */
export function emitApprovedFluent(atoms) {
  const roots = new Map();
  for (const a of atoms.filter((x) => !HAND_WRITTEN_ENTRIES.includes(entryWord(x.fluent)))) {
    const calls = parse(a.fluent);
    const [first, ...steps] = calls;
    if (!roots.has(first.word)) roots.set(first.word, { args: first.args, children: new Map(), end: null });
    let node = roots.get(first.word);
    for (const c of steps) {
      if (!node.children.has(c.word)) node.children.set(c.word, { args: c.args, children: new Map(), end: null });
      node = node.children.get(c.word);
    }
    if (node.children.size || node.end) throw new Error(`approved ${a.atom}: its sentence ends where another approved sentence goes on or ends (${a.fluent})`);
    node.end = a;
  }
  const lines = [];
  const used = new Set();
  // Each call's arguments become the next numbered variables; the end node passes them to the atom by name.
  const emit = (node, bound, indent) => {
    if (node.end) {
      used.add(node.end.atom);
      const order = node.end.params.map(([name]) => {
        const v = bound.get(name);
        if (!v) throw new Error(`approved ${node.end.atom}: the sentence never names the parameter ${name}`);
        return v;
      });
      return `${node.end.atom}(${order.join(', ')})`;
    }
    const methods = [...node.children].map(([word, child]) => {
      const next = new Map(bound);
      const vars = child.args.map((name) => {
        const v = `a${next.size}`;
        next.set(name, v);
        return v;
      });
      return `${word}: (${vars.map((v) => `${v}: any`).join(', ')}) => ${wrap(emit(child, next, indent + 1))}`;
    });
    return `{ ${methods.join(', ')} }`;
  };
  const wrap = (expr) => (expr.startsWith('{') ? `(${expr})` : expr);
  for (const [word, root] of roots) {
    const bound = new Map();
    const vars = root.args.map((name) => {
      const v = `a${bound.size}`;
      bound.set(name, v);
      return v;
    });
    lines.push(`/** Approved sentences starting with ${word}(). */\nexport function ${word}(${vars.map((v) => `${v}: any`).join(', ')}): any {\n  return ${emit(root, bound, 1)};\n}\n`);
  }
  const imports = used.size ? `import { ${[...used].sort().join(', ')} } from '../atoms/generated/approved';\n\n` : '';
  return { code: lines.length ? `${imports}${lines.join('\n')}` : 'export {};\n', entries: [...roots.keys()] };
}

/** The words of an approved sentence no grammar class has yet that read as verbs (R1): they join grammar.verbs. */
export function newVerbs(fluent, grammar) {
  const known = new Set(['verbs', 'questionWords', 'subjects', 'connectors', 'roleWords', 'words'].flatMap((k) => grammar[k] ?? []));
  return parse(fluent).map((c) => c.word).filter((w) => !known.has(w) && /^[a-z]{3,}s$/.test(w) && !/ss$/.test(w));
}
