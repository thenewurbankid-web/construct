// Approved atoms (src/atoms/approved.json): hand-kept source entries the owner approved from the fluent
// generator (packages/line-fluent/generator). gen-atoms turns each into a typed-`any` wrapper in
// src/atoms/generated/approved.ts and a catalog entry, so approved atoms survive every regeneration.
//
//   { "atom": "flatMapped", "entry": "Array.prototype.flatMap", "fluent": "clones().list(xs).and().flattens()",
//     "js": "xs.flatMap(f)", "params": [["xs", "list"], ["f", "fn"]], "kind": "copy", "approvedAt": "..." }
import { reading } from './lib-sentence.mjs';

export const APPROVED_MODULE = 'approved';
const ATOM_ID = /^[a-z][A-Za-z0-9]*$/;
const PARAM = /^[A-Za-z_$][\w$]*$/;
const KINDS = ['question', 'copy', 'in-place', 'value', 'effect'];

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
      fluent: a.fluent,
      params: a.params,
    };
    if (a.kind === 'effect') entry.impureReason = 'approved as an effect';
    if (Array.isArray(a.parts) && a.parts.length) entry.parts = a.parts;
    entry.verified = false;
    entry.unverifiedReason = 'approved from the fluent generator; no check set yet';
    entry.approved = { entry: a.entry, approvedAt: a.approvedAt };
    entries.push(entry);
  }
  return { code: blocks.length ? blocks.join('\n') : null, entries };
}
