// #649 -- the real executable over stdio: it starts fast and small (budget: under 1 s and 150 MB to answer initialize and list the
// tools), speaks only the protocol on stdout, refuses a bad command line, and answers a tool call end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { makeProject, connectStdio, callTool, BIN } from '../test-utils/harness.mjs';

const BUDGET_MS = 1000;
const BUDGET_RSS_MB = 150;

/** The peak resident memory of a process in megabytes (Linux: VmHWM), or null where /proc is not there. */
const peakRssMb = (pid) => {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
};

test('startup: initialize and list the tools in under 1 s and under 150 MB peak memory', async () => {
  const root = makeProject();
  const t0 = performance.now();
  const s = await connectStdio(['--root', root]);
  const { tools } = await s.client.listTools();
  const ms = performance.now() - t0;
  const mb = peakRssMb(s.transport.pid);
  process.stderr.write(`# construct-mcp startup: ${ms.toFixed(0)} ms to initialize and list ${tools.length} tools, peak RSS ${mb === null ? 'n/a' : `${mb.toFixed(0)} MB`}\n`);
  await s.close();
  assert.equal(tools.length, 8);
  assert.ok(ms < BUDGET_MS, `${ms.toFixed(0)} ms is over the ${BUDGET_MS} ms budget`);
  if (mb !== null) assert.ok(mb < BUDGET_RSS_MB, `${mb.toFixed(0)} MB is over the ${BUDGET_RSS_MB} MB budget`);
});

test('stdio: a tool call end to end, and stdout carries nothing but the protocol', async () => {
  const root = makeProject();
  const s = await connectStdio(['--root', root, '--rate-limit', '5']);
  const parsed = await callTool(s.client, 'requirement_parse', { text: 'A user wants to see a list of products' });
  assert.equal(parsed.body.complete, true);
  const placed = await callTool(s.client, 'placement_place', { text: 'A user wants to see a list of products', answers: [{ id: 'q-shape', option: 'list' }] });
  assert.equal(placed.body.stage, 'planned');
  assert.equal((await callTool(s.client, 'validate', { limit: 1 })).body.findings.length, 1);
  for (let i = 0; i < 3; i += 1) await callTool(s.client, 'machine_capabilities');
  assert.equal((await callTool(s.client, 'machine_capabilities')).body.error.code, 'RATE_LIMITED', '--rate-limit 5 is the startup configuration');
  await s.close();
  assert.match(s.stderr(), /ready on stdio/);
  assert.doesNotMatch(s.stderr(), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'diagnostics never print the project path');
});

test('the command line: --help and --version answer, a bad argument or root exits 2 with a reason on stderr', () => {
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input: '' });
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /claude mcp add construct/);
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+\n$/);
  for (const [args, reason] of [[['--nope'], /Unknown argument/], [['--root'], /needs a directory/], [['--rate-limit', '0'], /whole number/], [['--rate-limit', '99999'], /whole number/], [['--max-output', 'big'], /whole number/], [['--root', '/no/such/dir/at/all'], /does not exist/], [['--root', '/'], /too wide/]]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, reason);
    assert.equal(r.stdout, '', 'nothing but the protocol ever goes to stdout');
  }
});
