// UAT walk, row rm-02 (roadmap item 2, packages/line-atoms): 14 logic atoms, each a pure TypeScript state machine with
// a test kit; `construct validate --profile line` flags hand-written copies (LINE-ATOM, typed fix "use atom X").
// 1. List the atoms (no CLI command lists them; @line/atoms' listAtoms is the catalog the check and the drafter read).
// 2. Run one atom's test kit (client-pagination) with node's test runner.
// 3. In a fresh Line project, hand-write pagination in a usecase: validate fires LINE-ATOM with "use atom
//    client-pagination". Rewrite it to call the atom: validate passes with no LINE-ATOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, say, run, construct, show, tempDir, walk } from './walk.mjs';

const HAND_WRITTEN = `export function pageOf<T>(rows: T[], page: number, pageSize: number) {
  const pages = Math.ceil(rows.length / pageSize);
  return { pages, items: rows.slice(page * pageSize, (page + 1) * pageSize) };
}
`;
const USES_ATOM = `import { paginate } from '@line/atoms/client-pagination';

export function pageOf<T>(rows: T[], page: number, pageSize: number) {
  const { items, pageCount } = paginate(rows, page, pageSize);
  return { pages: pageCount, items };
}
`;

/** validate --profile line as JSON: exit code and the LINE-ATOM findings. */
function validateAtoms(dir) {
  const v = construct(['validate', '--profile', 'line', '--dir', dir, '--format', 'json']);
  const body = JSON.parse(v.out);
  const findings = body.findings ?? body.violations ?? [];
  return { code: v.code, all: findings, atom: findings.filter((f) => (f.rule ?? f.ruleId) === 'LINE-ATOM') };
}

const t = tempDir('atoms');
await walk('rm-02 atoms', async () => {
  say('-- 1. the atoms');
  const { listAtoms } = await import(pathToFileURL(path.join(REPO, 'packages/line-atoms/index.mjs')).href);
  const atoms = listAtoms();
  assert.equal(atoms.length, 14, 'the catalog has 14 atoms');
  say(`  > ${atoms.length} atoms: ${atoms.map((a) => a.id).join(', ')}`);

  say('-- 2. run the client-pagination atom\'s test kit');
  const kit = run([process.execPath, '--test', '--test-reporter=tap', 'packages/line-atoms/atoms/client-pagination/client-pagination.test.ts']);
  const pass = Number(/# pass (\d+)/.exec(kit.out)?.[1] ?? 0);
  const fail = Number(/# fail (\d+)/.exec(kit.out)?.[1] ?? 0);
  assert.ok(kit.code === 0 && pass > 0 && fail === 0, `the kit passes (${pass} passed, ${fail} failed) ${kit.all.slice(-1500)}`);
  say(`  > client-pagination kit: ${pass} passed, ${fail} failed`);

  say('-- 3. a hand-written copy of an atom in a fresh Line project');
  const { createLineProject } = await import(pathToFileURL(path.join(REPO, 'packages/engine/line/newProject.mjs')).href);
  const made = createLineProject(t.dir, { name: 'shop', firstFeature: 'orders' });
  assert.ok(made.ok && made.dir, made.sentence);
  say(`  > ${made.sentence}`);
  const before = validateAtoms(made.dir);
  assert.equal(before.atom.length, 0, 'the new project starts with no LINE-ATOM finding');
  const file = path.join(made.dir, 'features/orders/usecases/listOrders.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, HAND_WRITTEN);
  say('  wrote features/orders/usecases/listOrders.ts: pageOf slices rows into pages by hand');
  const copy = validateAtoms(made.dir);
  assert.equal(copy.atom.length, 1, `one LINE-ATOM finding (${copy.all.map((f) => f.rule ?? f.ruleId).join(', ')})`);
  assert.equal(copy.atom[0].file, 'features/orders/usecases/listOrders.ts');
  assert.equal(copy.atom[0].severity ?? 'warning', 'warning', 'LINE-ATOM is a warning (its rule default)');
  assert.match(copy.atom[0].message, /client.pagination/i);
  assert.match(copy.atom[0].message, /@line\/atoms\/client-pagination/);
  say(`  > LINE-ATOM (warning) ${copy.atom[0].file}:${copy.atom[0].line} ${copy.atom[0].message}`);

  fs.writeFileSync(file, USES_ATOM);
  say('  rewrote pageOf to call paginate from @line/atoms/client-pagination');
  const fixed = validateAtoms(made.dir);
  assert.equal(fixed.atom.length, 0, `no LINE-ATOM once it uses the atom (${fixed.atom.map((f) => f.message).join(' | ')})`);
  assert.equal(fixed.code, 0, `validate passes (${fixed.all.filter((f) => (f.severity ?? 'error') === 'error').map((f) => `${f.rule ?? f.ruleId}: ${f.message}`).join(' | ')})`);
  say('  > construct validate --profile line: exit 0, no LINE-ATOM');
}, t.cleanup);
