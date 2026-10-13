// #919 -- line.useAtom: the atom-wiring op. Copies one shipped logic atom (@line/atoms, packages/line-atoms/atoms/<id>)
// into the project's own atoms kind (<library>/atoms/<id>.ts), so a usecase or service of a project that does not
// install @line/atoms imports it by a relative path. Deterministic: the atom's index.ts as it ships, its one type import
// (../types.ts, AtomMachine) inlined; nothing is generated. Pure: it plans a StagedChange the plan writes.
//
//   planUseAtom(root, {atom})  -> StagedChange   the plan tool's planner (planTools CHANGE_TOOLS 'line.useAtom')
//   atomSource(id)             -> string|null    the code the project gets for that atom
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { ATOMS_DIR, getAtom, listAtoms } from '@line/atoms';
import { LineOpError } from '../contract.mjs';

const TYPE_IMPORT = /^import type \{[^}]*\} from '\.\.\/types\.ts';\n/m;

/**
 * The code a project gets for a shipped atom: its index.ts with the shared AtomMachine types inlined, under a header
 * naming where it came from. Null when there is no such atom.
 * @param {string} id The atom id, e.g. "filter-sort".
 * @returns {string|null}
 */
export function atomSource(id) {
  const atom = getAtom(String(id));
  if (!atom) return null;
  const src = fs.readFileSync(path.join(ATOMS_DIR, atom.id, 'index.ts'), 'utf8');
  const types = fs.readFileSync(path.join(ATOMS_DIR, 'types.ts'), 'utf8').split('\n').filter((l) => !/^\/\//.test(l)).join('\n').trim();
  const body = TYPE_IMPORT.test(src) ? src.replace(TYPE_IMPORT, `${types}\n`) : src;
  return `// @line-atom ${atom.id}: copied from @line/atoms/${atom.id} by line.useAtom; change the atom there, not here.\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

/**
 * Plan copying one shipped atom into the project's library atoms. Pure.
 * @param {string} root Project root.
 * @param {{atom?: string}} req
 * @returns {{summary: string, files: {path: string, content: string}[]}}
 * @throws {LineOpError} UNKNOWN_ITEM (no such atom), NO_CHANGE (already there) or STALE (a different file is there).
 */
export function planUseAtom(root, { atom } = {}) {
  const content = atomSource(String(atom ?? ''));
  if (content === null) {
    const ids = listAtoms().map((a) => a.id);
    throw new LineOpError(`There is no atom "${atom}"; the atoms are ${ids.join(', ')}.`, 'UNKNOWN_ITEM', undefined,
      ids.filter((x) => String(atom ?? '').split('-').some((w) => w && x.includes(w))).slice(0, 3).map((x) => ({ id: `UNKNOWN_ITEM/atom:${x}`, sentence: `Use the atom ${x}.`, step: { tool: 'line.useAtom', args: { atom: x } } })));
  }
  const { library } = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const rel = `${library}/atoms/${atom}.ts`;
  let before = null;
  try { before = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { before = null; }
  if (before === content) throw new LineOpError(`${rel} is already this atom as it ships.`, 'NO_CHANGE');
  if (before !== null) throw new LineOpError(`${rel} exists and differs from the shipped atom; keep it, or replace it with line.setCode.`, 'STALE');
  return { summary: `Copies the ${atom} atom into ${rel}, so the project's usecases and services can use it.`, files: [{ path: rel, content }] };
}
