// UAT walk, row rm-01 (roadmap item 1, packages/line-primitives): the 40 canonical primitives, each with a test kit.
// 1. See the primitives and their coverage (`construct line primitives coverage`, the only primitives CLI command).
// 2. Run one primitive's test kit (Button) on its own.
// 3. Start a fresh Line project on the primitives library and check it with `construct validate --profile line`.
//    No CLI command creates a Line project (Cockpit's New project is the only front door, and its API does not pass
//    `library` yet), so this step calls the engine's createLineProject, the function both would use.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, say, run, construct, show, tempDir, walk } from './walk.mjs';

const t = tempDir('primitives');
await walk('rm-01 primitives', async () => {
  say('-- 1. the primitives and their held-out coverage');
  const cov = construct(['line', 'primitives', 'coverage']);
  assert.equal(cov.code, 0, cov.all);
  show(cov.out, 4);
  const { PRIMITIVES } = await import(pathToFileURL(path.join(REPO, 'packages/line-primitives/contract.mjs')).href);
  assert.equal(PRIMITIVES.length, 40, 'the contract lists 40 primitives');
  say(`  > ${PRIMITIVES.length} primitives: ${PRIMITIVES.map((p) => p.name).join(', ')}`);
  const kits = fs.readdirSync(path.join(REPO, 'packages/line-primitives/test/kits')).filter((f) => f.endsWith('.kit.tsx'));
  assert.deepEqual(kits.map((f) => f.replace('.kit.tsx', '')).sort(), PRIMITIVES.map((p) => p.name).sort(), 'one test kit per primitive');
  say(`  > ${kits.length} test kits, one per primitive`);

  say('-- 2. run the Button primitive\'s test kit on its own');
  const kit = run([process.execPath, '--test', '--test-reporter=tap', '--test-name-pattern=^Button primitive', 'packages/line-primitives/test/primitives.test.mjs']);
  assert.equal(kit.code, 0, kit.all.slice(-2000));
  const pass = Number(/# pass (\d+)/.exec(kit.out)?.[1] ?? 0);
  const fail = Number(/# fail (\d+)/.exec(kit.out)?.[1] ?? 0);
  assert.ok(pass > 0 && fail === 0, `the Button kit ran (${pass} passed, ${fail} failed)`);
  assert.match(kit.out, /Button primitive/);
  say(`  > Button kit: ${pass} passed, ${fail} failed`);

  say('-- 3. a fresh Line project on the primitives library');
  say('  (no CLI command creates a Line project; calling the engine\'s createLineProject with library: "primitives")');
  const { createLineProject } = await import(pathToFileURL(path.join(REPO, 'packages/engine/line/newProject.mjs')).href);
  const made = createLineProject(t.dir, { name: 'shop', firstFeature: 'orders', library: 'primitives' });
  assert.ok(made.ok && made.dir, made.sentence);
  say(`  > ${made.sentence}`);
  const comps = fs.readdirSync(path.join(made.dir, 'library/components')).filter((f) => f.endsWith('.tsx')).map((f) => f.replace('.tsx', ''));
  for (const p of PRIMITIVES) assert.ok(comps.includes(p.name), `library/components/${p.name}.tsx is in the new project`);
  say(`  > library/components holds all ${PRIMITIVES.length} primitives`);
  const v = construct(['validate', '--profile', 'line', '--dir', made.dir, '--format', 'json']);
  const body = JSON.parse(v.out);
  const findings = body.findings ?? body.violations ?? [];
  const errors = findings.filter((f) => (f.severity ?? 'error') === 'error');
  assert.equal(v.code, 0, `validate exits 0 on the new project (${errors.map((f) => `${f.rule ?? f.ruleId}: ${f.message}`).slice(0, 3).join(' | ')})`);
  say(`  > construct validate --profile line: exit 0, ${findings.length} finding(s)`);
}, t.cleanup);
