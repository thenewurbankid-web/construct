// #335: the ESLint rule that stops new call sites bypassing test-utils/tmpdir.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: ROOT });

async function lint(code, relPath) {
  const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, relPath) });
  return res.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

const BAD = [
  "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';\nfs.mkdtempSync(path.join(os.tmpdir(), 'x-'));",
  "import fs from 'node:fs'; import os from 'node:os';\nfs.mkdtempSync(os.tmpdir() + '/x-');",
  "import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';\nmkdtempSync(join(tmpdir(), 'x-'));",
  "import { mkdtemp } from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';\nawait mkdtemp(path.join(os.tmpdir(), 'x-'));",
  "import fs from 'node:fs'; import os from 'node:os';\nawait fs.promises.mkdtemp(`${os.tmpdir()}/x-`);",
];

for (const [i, code] of BAD.entries()) {
  test(`bare mkdtemp(os.tmpdir()) form #${i + 1} is rejected and the message points at makeTempDir`, async () => {
    const msgs = await lint(code, 'test/fixture-og335.test.mjs');
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0].message, /makeTempDir/);
    assert.match(msgs[0].message, /leak/);
  });
}

test('the rule also covers site/test and ui/server test files', async () => {
  assert.equal((await lint(BAD[0], 'site/test/x.test.mjs')).length, 1);
  assert.equal((await lint(BAD[0], 'ui/server/src/x.test.mjs')).length, 1);
});

test('test-utils/ is exempt: it is where the sanctioned implementation lives', async () => {
  assert.equal((await lint(BAD[0], 'test-utils/tmpdir.mjs')).length, 0);
});

test('mkdtemp against a non-tmpdir path is not flagged, and makeTempDir is fine', async () => {
  assert.equal((await lint("import fs from 'node:fs'; fs.mkdtempSync('/var/data/x-');", 'test/f.test.mjs')).length, 0);
  assert.equal((await lint("import { makeTempDir } from '../test-utils/tmpdir.mjs'; makeTempDir('x-');", 'test/f.test.mjs')).length, 0);
});

test('deliberate cleanup-managed src/ call sites are out of scope (documented in eslint.config.mjs)', async () => {
  assert.equal((await lint(BAD[0], 'src/engine/gitTrees.mjs')).length, 0);
});
