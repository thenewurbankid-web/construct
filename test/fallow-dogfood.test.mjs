// Dogfood findings of the #926 run, with real fallow: a developer's first validate after `construct init` or a
// generator is clean, without hiding real problems.
//   #927  `create store` emits a reducer fallow's health check passes (one handler per action, no big switch).
//   #928  a FALLOW-UNRESOLVED-IMPORT that IMPORT-001 already reports (same file, same specifier) is dropped;
//         one IMPORT-001 does not see still reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { dedupeFallowFindings, resolveFallowBin } from '../packages/core/fallow.mjs';
import { STORE_SHAPES } from '../packages/core/store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

const construct = (dir, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, ...(args[0] === 'init' ? [dir] : ['--dir', dir])], { encoding: 'utf8' });
  assert.equal(r.status, 0, `construct ${args.join(' ')}: ${r.stderr}${r.stdout}`);
  return r;
};
const violations = (dir) => JSON.parse(spawnSync(process.execPath, [CLI, 'validate', '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout).violations;
const show = (vs) => vs.map((v) => `${v.rule} ${v.file}:${v.line} ${v.message}`).join('\n');
const TEST_REGIONS = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';

const noFallow = !resolveFallowBin(makeTempDir('construct-fallow-probe-'), { env: {} }) && 'fallow is not installed';

test('#928 dedupeFallowFindings: same file + specifier is dropped (any line); other files, specifiers and rules are kept', () => {
  const imp = (file, spec, line = 1) => ({ rule: 'IMPORT-001', file, line, message: `Import "${spec}" does not resolve to an existing file.` });
  const fal = (file, spec, line = 2) => ({ rule: 'FALLOW-UNRESOLVED-IMPORT', file, line, message: `Import "${spec}" resolves to no file or package.` });
  const other = { rule: 'FALLOW-UNUSED-FILE', file: 'app/page.tsx', line: 1, message: 'No entry point reaches this file.' };
  const kept = dedupeFallowFindings(
    [fal('app/page.tsx', '../x'), fal('app/page.tsx', '../y'), fal('lib/a.ts', '../x'), other],
    [imp('app/page.tsx', '../x'), { rule: 'IMPORT-002', file: 'app/page.tsx', message: 'Import "../y" whatever' }],
  );
  assert.deepEqual(kept.map((v) => `${v.rule} ${v.file} ${v.message}`), [
    'FALLOW-UNRESOLVED-IMPORT app/page.tsx Import "../y" resolves to no file or package.',
    'FALLOW-UNRESOLVED-IMPORT lib/a.ts Import "../x" resolves to no file or package.',
    'FALLOW-UNUSED-FILE app/page.tsx No entry point reaches this file.',
  ]);
  assert.equal(dedupeFallowFindings([fal('a.ts', '../x')]).length, 1, 'no Construct findings: nothing dropped');
});

test('#928 real fallow: a bare init reports the missing controller once (IMPORT-001); a unique unresolved import in a nonLayer file still reports', { skip: noFallow, timeout: 180_000 }, () => {
  const dir = makeTempDir('construct-fallow-dedupe-');
  try {
    construct(dir, 'init');
    const bare = violations(dir);
    assert.ok(bare.some((v) => v.rule === 'IMPORT-001' && v.file === 'app/page.tsx' && v.message.includes('CoreController')), show(bare));
    assert.deepEqual(bare.filter((v) => v.rule === 'FALLOW-UNRESOLVED-IMPORT'), [], show(bare));

    fs.appendFileSync(path.join(dir, 'architecture.yml'), TEST_REGIONS);
    fs.mkdirSync(path.join(dir, 'features/core/tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'features/core/tests/helper.test.ts'), "import { gone } from './missing-helper';\nexport const value = gone;\n");
    const planted = violations(dir);
    assert.ok(!planted.some((v) => v.rule === 'IMPORT-001' && v.file.includes('tests/')), `IMPORT-001 does not check nonLayer files:\n${show(planted)}`);
    assert.ok(planted.some((v) => v.rule === 'FALLOW-UNRESOLVED-IMPORT' && v.file === 'features/core/tests/helper.test.ts' && v.message.includes('./missing-helper')), show(planted));
    assert.deepEqual(planted.filter((v) => v.rule === 'FALLOW-UNRESOLVED-IMPORT' && v.file === 'app/page.tsx'), [], show(planted));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#927 real fallow: a fresh `create store` of every shape adds no FALLOW-* finding (health: no critical complexity or CRAP)', { skip: noFallow, timeout: 300_000 }, () => {
  const dir = makeTempDir('construct-fallow-store-');
  try {
    construct(dir, 'init');
    construct(dir, 'generate', 'layer', 'core', '--feature', 'core', '--layers', 'domain,service,workflow,hook,component,page,controller');
    construct(dir, 'sync');
    fs.appendFileSync(path.join(dir, 'architecture.yml'), TEST_REGIONS);
    assert.deepEqual(violations(dir).filter((v) => v.rule.startsWith('FALLOW-')), [], 'the scaffold starts clean');
    const names = { value: 'Draft', list: 'Cart', keyed: 'Catalog' };
    for (const shape of STORE_SHAPES) construct(dir, 'create', 'store', names[shape], '--feature', 'core', '--shape', shape);
    const domain = fs.readFileSync(path.join(dir, 'features/core/domain/CartStore.domain.ts'), 'utf8');
    assert.ok(!domain.includes('switch ('), 'one handler per action, not one switch');
    const found = violations(dir).filter((v) => v.rule.startsWith('FALLOW-'));
    assert.deepEqual(found.filter((v) => /Store\.domain\.ts$|\.state\.ts$/.test(v.file)), [], show(found));
    assert.ok(!found.some((v) => /^FALLOW-(COMPLEXITY|CRAP)/.test(v.rule)), show(found));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
