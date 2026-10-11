// cm1 -- no single point of failure: with the Cockpit server down (nothing listening where it would be) and every
// network connection refused, `construct validate` and the CLI blocks still work, because the CLI runs the same blocks
// in-process and never needs the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const FIXTURES = path.join(here, '..', 'packages', 'core', 'profiles', 'line', 'fixtures');

// Loaded before the CLI: any socket or fetch the run tries fails loudly, so a hidden dependency on a server shows up.
const NO_NETWORK = `data:text/javascript,${encodeURIComponent(`
import net from 'node:net';
const refuse = () => { throw new Error('cm1: this run tried to use the network'); };
net.Socket.prototype.connect = refuse;
globalThis.fetch = refuse;
`)}`;

/** A port nothing listens on: bound once, then closed. */
async function closedPort() {
  const s = http.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (s.address());
  await new Promise((resolve) => s.close(resolve));
  return port;
}

async function cli(args) {
  const port = await closedPort();
  const env = { ...process.env, PORT: String(port), NO_COLOR: '1' }; // PORT is where ui/server would listen
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, ['--import', NO_NETWORK, bin, ...args], { encoding: 'utf8', env, timeout: 120_000 });
}

test('cm1: Cockpit server down: construct validate --profile line still passes a clean project and reports a broken one', async () => {
  const ok = await cli(['validate', '--profile', 'line', '--dir', path.join(FIXTURES, 'passing')]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.doesNotMatch(ok.stderr, /tried to use the network/);
  const bad = await cli(['validate', '--profile', 'line', '--format', 'json', '--dir', path.join(FIXTURES, 'LINE-DIR')]);
  assert.equal(bad.status, 1, bad.stderr);
  const rules = JSON.parse(bad.stdout).violations.map((v) => v.rule);
  assert.ok(rules.length > 0 && rules.every((r) => r === 'LINE-DIR'), rules.join(', '));
});

test('cm1: Cockpit server down: a CLI block (create feature) still writes through the writer and the result validates', async () => {
  const dir = makeTempDir('construct-cockpit-down-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  const made = await cli(['create', 'feature', 'orders', '--dir', dir]);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.doesNotMatch(made.stderr, /tried to use the network/);
  assert.ok(fs.existsSync(path.join(dir, 'features', 'orders')), 'the feature folder was created');
  const checked = await cli(['validate', '--dir', dir]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});
