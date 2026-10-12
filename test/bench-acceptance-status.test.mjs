// Bench reporting: acceptance that did not run (the webServer's `next build` failed, so Playwright ran no test) is
// "did not run: build failed", never 0 of the total (pilot-qwen-7b-r2: acceptance.log "passed 0 total 0", RESULTS 0/22).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptanceOf, acceptanceText, acceptanceTotal } from '../bench/ecommerce/metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'bench-acceptance');
const METRICS = path.join(here, '..', 'bench', 'ecommerce', 'metrics.mjs');
const json = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
const log = fs.readFileSync(path.join(FX, 'build-failed.console.txt'), 'utf8');

test('a report with no test run (webServer never started) is "did not run: build failed", passed null, not 0/22', () => {
  const a = acceptanceOf(json('build-failed.json'), 22, log);
  assert.deepEqual(a, { passed: null, total: 22, ran: false, status: 'did not run: build failed', passedIds: [] });
  assert.equal(acceptanceText(a), 'did not run: build failed');
  // Without the console log the webServer failure is still the build (its command is next build && next start).
  assert.equal(acceptanceOf(json('build-failed.json'), 22).status, 'did not run: build failed');
  // A log with no build error: the server, not the build, failed.
  assert.equal(acceptanceOf(json('build-failed.json'), 22, 'Error: listen EADDRINUSE :::3395\n').status, 'did not run: the web server did not start');
  assert.equal(acceptanceOf(null, 22).status, 'did not run: no report');
});

test('a report whose tests ran counts passed/total as before', () => {
  const a = acceptanceOf(json('ran.json'), 22);
  assert.deepEqual(a, { passed: 1, total: 22, ran: true, status: '1/22', passedIds: ['CHK-1'] });
  assert.equal(acceptanceText(a), '1/22');
  // An older results JSON that only carries ran: false still reads as not run.
  assert.equal(acceptanceText({ passed: 0, total: 22, ran: false, passedIds: [] }), 'did not run');
});

test('metrics.mjs acceptance (run-acceptance.sh\'s summary line) says why it did not run', () => {
  const r = spawnSync(process.execPath, [METRICS, 'acceptance', path.join(FX, 'build-failed.json'), path.join(FX, 'build-failed.console.txt')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ran: false, status: 'did not run: build failed', passed: null, total: acceptanceTotal() });
  const ok = spawnSync(process.execPath, [METRICS, 'acceptance', path.join(FX, 'ran.json')], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(ok.stdout), { ran: true, status: `1/${acceptanceTotal()}`, passed: 1, total: acceptanceTotal() });
});
