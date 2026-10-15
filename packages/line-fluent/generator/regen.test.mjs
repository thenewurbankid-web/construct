// Approved atoms survive a catalog regeneration: approve writes line-smith's hand-kept approved.json, and
// gen-atoms (run for real, in a scratch copy of line-smith) merges it into catalog.json and generated/approved.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockModel } from '../pilot/runner/mock-model.mjs';
import { approveProposal, generate, writeProposal } from './generator.mjs';

const SMITH = fileURLToPath(new URL('../../line-smith/', import.meta.url));
const FLAT_MAP = 'Array.prototype.flatMap';

// gen-atoms needs TypeScript 7 (typescript/unstable/sync) from line-smith's own node_modules.
const ts7 = (() => {
  try {
    createRequire(join(SMITH, 'package.json')).resolve('typescript/unstable/sync');
    return true;
  } catch {
    return false;
  }
})();

// A scratch line-smith: the generator's inputs and scripts, and line-smith's node_modules linked in.
function scratchSmith() {
  const root = mkdtempSync(join(tmpdir(), 't5-1-regen-'));
  for (const f of ['package.json', 'tsconfig.json', 'scripts']) cpSync(join(SMITH, f), join(root, f), { recursive: true });
  mkdirSync(join(root, 'src/atoms'), { recursive: true });
  for (const f of ['naming.json', 'curated.json', 'catalog.json']) cpSync(join(SMITH, 'src/atoms', f), join(root, 'src/atoms', f));
  writeFileSync(join(root, 'src/atoms/approved.json'), JSON.stringify({ atoms: [] }));
  symlinkSync(join(SMITH, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

const regenerate = (root, ...args) => execFileSync(process.execPath, [join(root, 'scripts/gen-atoms.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });
const atomsOf = (root) => JSON.parse(readFileSync(join(root, 'src/atoms/catalog.json'), 'utf8')).atoms;

const answer = 'new-atom", "atom": "flatMapped", "existing": null, "kind": "copy", '
  + '"sentence": "clones().list(xs).and().flattens()", "js": "xs.flatMap(f)", '
  + '"params": [["xs", "list"], ["f", "fn"]], "parts": null, "reason": null}';

test('an approved atom is in the catalog after a regeneration, and after the next one', { skip: !ts7 && 'TypeScript 7 is not installed in packages/line-smith (npm install there)' }, async () => {
  const root = scratchSmith();
  try {
    const catalogFile = join(root, 'src/atoms/catalog.json');
    const approvedFile = join(root, 'src/atoms/approved.json');
    const before = atomsOf(root).length;

    const { proposal } = await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: answer }), approved: [] });
    assert.equal(proposal.adds, true);
    const file = writeProposal(proposal, join(root, 'proposals'));
    approveProposal(file, { approved: approvedFile, catalog: catalogFile, now: () => '2026-10-15T00:00:00.000Z' });
    assert.equal(atomsOf(root).length, before, 'approve itself never writes catalog.json');

    const out = regenerate(root);
    assert.match(out, /1 approved/);
    let atoms = atomsOf(root);
    assert.equal(atoms.length, before + 1);
    const atom = atoms.find((a) => a.atom === 'flatMapped');
    assert.deepEqual(atom, { ...proposal.catalogEntry, approved: { entry: FLAT_MAP, approvedAt: '2026-10-15T00:00:00.000Z' } });

    const ts = readFileSync(join(root, 'src/atoms/generated/approved.ts'), 'utf8');
    assert.match(ts, /flatMapped\(xs, f\) reads "clones list xs and flattens"/);
    assert.match(ts, /export function flatMapped\(xs: any, f: any\): any \{\n {2}return \(xs\.flatMap\(f\)\);\n\}/);
    assert.match(readFileSync(join(root, 'src/atoms/generated/index.ts'), 'utf8'), /export \* from '\.\/approved';/);

    // A second regeneration starts from the generator's inputs again; the approved atom is still there.
    regenerate(root);
    atoms = atomsOf(root);
    assert.equal(atoms.filter((a) => a.atom === 'flatMapped').length, 1);
    assert.equal(atoms.length, before + 1);
    assert.match(regenerate(root, '--check'), /up to date/);
    assert.ok(existsSync(approvedFile));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
