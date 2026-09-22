import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateApiMarkdown, API_PACKAGES, withPropsTable } from '../../packages/docs-site/lib/apiDocs.mjs';
import { makeTempDir } from '../../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_URL = 'https://github.com/o/r';

test('withPropsTable: a real prop table replaces TypeDoc\'s opaque __namedParameters for a single-export .jsx/.tsx module', () => {
  const md = ['# X', '', '### Input()', '', '> **Input**(`__namedParameters`): `Element`', '', '#### Parameters', '', '##### \\_\\_namedParameters', '', '###### type', '', '`any`', '', '#### Returns', '', '`Element`'].join('\n');
  const out = withPropsTable(md, path.join(REPO_ROOT, 'ui/client/components/ui/Input.jsx'), 'ui/client/components/ui/Input.jsx', 1);
  // TypeDoc's opaque "#### Parameters / ##### __namedParameters" breakdown is gone (the one-line call
  // signature above it, "**Input**(`__namedParameters`)", is TypeDoc's own and is left alone).
  assert.doesNotMatch(out, /#### Parameters/);
  assert.match(out, /#### Props/);
  assert.match(out, /\| Prop \| Type \| Required \| Default \| Description \|/);
  assert.match(out, /`className`/);
  assert.match(out, /#### Returns/, 'the Returns section survives the replacement');

  // A hook (.ts, no component) is left exactly as TypeDoc rendered it.
  assert.equal(withPropsTable(md, path.join(REPO_ROOT, 'packages/core/cli.mjs'), 'packages/core/cli.mjs', 1), md);
  // More than one export in the file: left alone (ambiguous which export the props belong to).
  assert.equal(withPropsTable(md, path.join(REPO_ROOT, 'ui/client/components/ui/Input.jsx'), 'ui/client/components/ui/Input.jsx', 2), md);
});

test('generateApiMarkdown: a real Cockpit client component gets a real prop table end to end', () => {
  const out = makeTempDir('apidocs-test-');
  const pkg = API_PACKAGES.find((p) => p.id === 'cockpit-client-shared');
  const [results] = generateApiMarkdown({ repoRoot: REPO_ROOT, repoUrl: REPO_URL, outDir: out, packages: [pkg] });
  const input = results.modules.find((m) => m.name.endsWith('/Input'));
  assert.ok(input, 'Input.jsx is documented');
  assert.doesNotMatch(input.md, /#### Parameters/);
  assert.match(input.md, /#### Props/);
  assert.match(input.md, /`className`/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('headerSummary (via generateApiMarkdown module summaries): no internal ticket number leaks', () => {
  const out = makeTempDir('apidocs-test-');
  const pkg = API_PACKAGES.find((p) => p.id === 'cockpit-server');
  const [results] = generateApiMarkdown({ repoRoot: REPO_ROOT, repoUrl: REPO_URL, outDir: out, packages: [pkg] });
  const processesApi = results.modules.find((m) => m.name.endsWith('/processesApi'));
  assert.ok(processesApi, 'processesApi.mjs is documented');
  assert.doesNotMatch(processesApi.summary, /#\d+/, processesApi.summary);
  fs.rmSync(out, { recursive: true, force: true });
});
