// #926: the Construct-aware default fallow config (packages/core/fallow.mjs constructFallowConfig). A fresh
// `construct init` scaffold used to show ~20 FALLOW-* false positives (layer units not routed yet, feature
// barrels, types.ts, .dependency-cruiser.cjs, generated tests). The default is derived from architecture.yml,
// a real dead file still reports, and a fallow config the project ships wins. Same temp-dir and CLI helpers
// as test/fallow.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import {
  constructFallowConfig, findUserFallowConfig, prepareFallowConfig, runFallow, resolveFallowBin, FALLOW_CONFIG_FILES,
} from '../packages/core/fallow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

/** A throwaway project: package.json (so fallow is on by default) and an optional architecture.yml. */
function project({ yml } = {}) {
  const dir = makeTempDir('construct-fallow-cfg-');
  fs.mkdirSync(path.join(dir, '.git')); // stop findUserFallowConfig's walk-up at the project, like a real repo
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","private":true}\n');
  if (yml !== undefined) fs.writeFileSync(path.join(dir, 'architecture.yml'), yml);
  return dir;
}

const construct = (dir, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, ...(args[0] === 'init' ? [dir] : ['--dir', dir])], { encoding: 'utf8' });
  assert.equal(r.status, 0, `construct ${args.join(' ')}: ${r.stderr}${r.stdout}`);
  return r;
};
const fallowFindings = (dir) => {
  const r = spawnSync(process.execPath, [CLI, 'validate', '--format', 'json', '--dir', dir], { encoding: 'utf8' });
  return JSON.parse(r.stdout).violations.filter((v) => v.rule.startsWith('FALLOW-'));
};
const show = (vs) => vs.map((v) => `${v.rule} ${v.file}: ${v.message}`).join('\n');

/** A function over fallow's cognitive threshold (15): nested branches only a reader has to carry. */
const COMPLEX = `export function tangled(a: number, b: number, c: number): number {
  let n = 0;
  for (let i = 0; i < a; i++) {
    if (i % 2) { if (b > i) { if (c > b) { n += 1; } else if (c < 0) { n -= 1; } else { n *= 2; } } }
    else if (i % 3) { while (n < b) { if (n % 5) { n += 3; } else { break; } } }
    else { switch (c) { case 1: n++; break; case 2: n--; break; default: if (a && b || c) n = 0; } }
  }
  return n;
}
`;

test('constructFallowConfig is derived from architecture.yml: layers, features root, frozen, Construct deps', () => {
  assert.equal(constructFallowConfig(project()), null, 'no architecture.yml: fallow runs on its own defaults');
  const dir = project({
    yml: [
      'version: 1',
      'features:',
      '  root: modules',
      'layers:',
      '  gateway:',
      "    pattern: 'modules/*/gateways/**'",
      '    canImport: [types]',
      'frozen:',
      "  - 'modules/*/gen/**'",
      "  - '../shared/design/**'",
      '',
    ].join('\n'),
  });
  const cfg = constructFallowConfig(dir);
  for (const g of ['app/**/page.tsx', 'features/*/domain/**', 'modules/*/gateways/**', 'modules/*/index.{ts,tsx,js,jsx,mts,mjs}', 'modules/*/gen/**', 'modules/*/tests/generated/**']) {
    assert.ok(cfg.entry.includes(g), `entry has ${g}: ${JSON.stringify(cfg.entry)}`);
  }
  assert.ok(!cfg.entry.some((g) => g.includes('..')), 'a frozen glob outside the project is not an entry');
  assert.deepEqual(cfg.health.ignore, ['modules/*/gen/**', 'modules/*/tests/generated/**']);
  assert.deepEqual(cfg.ignorePatterns, ['.dependency-cruiser.cjs']);
  for (const d of ['xstate', '@xstate/graph']) assert.ok(cfg.ignoreDependencies.includes(d));
  assert.equal(constructFallowConfig(project({ yml: ': not yaml [' })), null, 'a broken architecture.yml is loadConfig\'s to report');
});

test('a fallow config the project ships wins: no default is prepared; otherwise a temp file outside the project, cleaned up', () => {
  const dir = project({ yml: 'version: 1\n' });
  const prepared = prepareFallowConfig(dir);
  assert.ok(prepared.file && !prepared.file.startsWith(dir), 'the default lives outside the project (validate stays read-only)');
  assert.deepEqual(JSON.parse(fs.readFileSync(prepared.file, 'utf8')), constructFallowConfig(dir));
  prepared.cleanup();
  assert.ok(!fs.existsSync(prepared.file));
  for (const name of FALLOW_CONFIG_FILES) {
    const own = project({ yml: 'version: 1\n' });
    fs.writeFileSync(path.join(own, name), name.endsWith('.toml') ? '' : '{}\n');
    assert.equal(findUserFallowConfig(own), path.join(own, name));
    assert.equal(prepareFallowConfig(own).file, null, `${name} wins`);
  }
  // found the way fallow finds it: walking up from a nested project root to the repository root
  const repo = project();
  fs.writeFileSync(path.join(repo, '.fallowrc.json'), '{}\n');
  const nested = path.join(repo, 'apps', 'web');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findUserFallowConfig(nested), path.join(repo, '.fallowrc.json'));
});

test('runFallow passes --config with the default to both analyses and removes it after', async () => {
  const dir = project({ yml: 'version: 1\n' });
  const seen = [];
  const exec = (cmd, args, opts, cb) => {
    const file = args[args.indexOf('--config') + 1];
    seen.push({ args, file, existed: fs.existsSync(file) });
    setImmediate(() => cb(null, '{}', ''));
  };
  await runFallow(dir, { bin: { command: 'fallow', args: [] }, execFileImpl: exec, env: {} });
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.deepEqual(s.args.slice(1, 7), ['--root', dir, '--format', 'json', '--quiet', '--no-cache']);
    assert.equal(s.args[7], '--config');
    assert.ok(s.existed, 'the config exists while fallow runs');
    assert.ok(!fs.existsSync(s.file), 'and is gone after');
  }
  fs.writeFileSync(path.join(dir, '.fallowrc.json'), '{}\n');
  seen.length = 0;
  await runFallow(dir, { bin: { command: 'fallow', args: [] }, execFileImpl: exec, env: {} });
  assert.ok(seen.every((s) => !s.args.includes('--config')), 'the project\'s own config: fallow finds it itself');
});

const noFallow = !resolveFallowBin(makeTempDir('construct-fallow-probe-'), { env: {} }) && 'fallow is not installed';

test('real fallow: a fresh scaffold validates with 0 FALLOW-* warnings; a planted dead file still reports; a user config wins', { skip: noFallow, timeout: 180_000 }, () => {
  const dir = makeTempDir('construct-fallow-scaffold-');
  construct(dir, 'init');
  construct(dir, 'generate', 'layer', 'core', '--feature', 'core', '--layers', 'domain,service,workflow,hook,component,page,controller');
  construct(dir, 'sync'); // writes .dependency-cruiser.cjs and the feature barrel
  fs.appendFileSync(path.join(dir, 'architecture.yml'), 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n');
  construct(dir, 'generate', 'tests', '--unit', 'core');
  construct(dir, 'generate', 'tests', 'core');
  for (const f of ['.dependency-cruiser.cjs', 'features/core/index.ts', 'features/core/types.ts', 'features/core/domain/Core.ts', 'features/core/tests/generated/core--ends-idle.spec.ts']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `scaffold has ${f}`);
  }
  assert.deepEqual(fallowFindings(dir), [], 'fresh scaffold');

  // complexity in a generated (frozen) test is not reported; the same function in a user file is
  fs.writeFileSync(path.join(dir, 'features/core/tests/generated/tangled.proof.test.ts'), COMPLEX);
  // a real dead file: nothing imports it and it is in no Construct region
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/legacy.ts'), COMPLEX);
  const planted = fallowFindings(dir);
  assert.ok(planted.some((v) => v.rule === 'FALLOW-UNUSED-FILE' && v.file === 'lib/legacy.ts'), show(planted));
  assert.ok(planted.some((v) => v.rule.startsWith('FALLOW-COMPLEXITY') && v.file === 'lib/legacy.ts'), show(planted));
  assert.ok(!planted.some((v) => v.file.includes('tests/generated/')), show(planted));
  assert.ok(planted.every((v) => v.file === 'lib/legacy.ts'), `only the planted file reports:\n${show(planted)}`);

  // the project's own fallow config replaces the default entirely
  fs.writeFileSync(path.join(dir, '.fallowrc.json'), '{ "rules": { "unused-files": "off" } }\n');
  const own = fallowFindings(dir);
  assert.ok(!own.some((v) => v.rule === 'FALLOW-UNUSED-FILE'), show(own));
  assert.ok(own.some((v) => v.file.includes('tests/generated/')), `without the default, generated tests are analyzed again:\n${show(own)}`);
});
