import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { rulesIndex } from './rulesApi.mjs';

test('GET /api/rules lists every rule at its built-in default severity with no architecture.yml', () => {
  const dir = makeTempDir('rules-api-');
  const { status, body } = rulesIndex(dir);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.rules.length > 0);
  const page001 = body.rules.find((r) => r.id === 'PAGE-001');
  assert.equal(page001.severity, page001.defaultSeverity);
});

test('GET /api/rules reflects the open project\'s architecture.yml severity override', () => {
  const dir = makeTempDir('rules-api-override-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\nrules:\n  PAGE-001: off\n');
  const { body } = rulesIndex(dir);
  assert.equal(body.rules.find((r) => r.id === 'PAGE-001').severity, 'off');
});
