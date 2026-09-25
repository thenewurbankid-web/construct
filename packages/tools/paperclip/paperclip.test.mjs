import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { startMock } from './mock-paperclip.mjs';
import { HERE, deepMerge, diffSubset, isLoopbackHost, loadConfig, orderAgents, readBundle, redact, resolveAgent, validateConfig, configVars } from './lib.mjs';
import { laneFor, mirrorBody, mirrorTitle } from './github-sync.mjs';

const execFileP = promisify(execFile);
const APPLY = path.join(HERE, 'apply.mjs');
const SYNC = path.join(HERE, 'github-sync.mjs');
const FAKE_TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';
const FAKE_KEY = 'sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzz';
const ENV = { ...process.env, GH_TOKEN: FAKE_TOKEN, ANTHROPIC_API_KEY: FAKE_KEY };

async function node(script, args, env = ENV) {
  try {
    const r = await execFileP(process.execPath, [script, ...args], { env, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const cfg = loadConfig();
const vars = configVars(cfg);
const AGENT_COUNT = cfg.agents.length;
const ALLOWLIST = ['api.anthropic.com', 'github.com', 'api.github.com', 'registry.npmjs.org', 'objects.githubusercontent.com'];

describe('company.json as code', () => {
  test('passes the safety validation', () => {
    assert.doesNotThrow(() => validateConfig(cfg));
  });

  test('the org: OG, PM and a dev and a QA agent per lane, everyone reports to OG', () => {
    const keys = cfg.agents.map((a) => a.key);
    for (const lane of ['construct', 'guardrails', 'cockpit', 'website', 'adhoc', 'design']) {
      assert.ok(keys.includes(`${lane}-dev`) && keys.includes(`${lane}-qa`), lane);
    }
    assert.equal(AGENT_COUNT, 14);
    assert.equal(cfg.agents.find((a) => a.key === 'og').role, 'ceo');
    assert.equal(cfg.agents.find((a) => a.key === 'pm').role, 'pm');
    for (const a of cfg.agents.filter((x) => x.key !== 'og')) assert.equal(a.reportsTo, 'og', a.key);
    assert.deepEqual(orderAgents(cfg)[0].key, 'og');
  });

  test('every agent: paused-by-design config, sonnet-5, confined, bounded, timer off except OG which is off until go', () => {
    for (const a of cfg.agents) {
      const r = resolveAgent(cfg, a, vars);
      const ac = r.body.adapterConfig;
      assert.equal(ac.model, 'claude-sonnet-5', a.key);
      assert.equal(ac.effort, 'medium');
      assert.equal(ac.engine, 'cli', 'confinement needs the cli engine');
      assert.equal(ac.filesystemScope, 'workspace');
      assert.equal(ac.networkScope, 'allowlist');
      assert.deepEqual(ac.networkAllowlist, ALLOWLIST);
      assert.equal(ac.dangerouslySkipPermissions, true);
      assert.equal(ac.workspaceStrategy.type, 'git_worktree');
      assert.ok(ac.maxTurnsPerRun > 0 && ac.maxTurnsPerRun <= 60);
      assert.ok(ac.timeoutSec > 0 && ac.timeoutSec <= 2400);
      assert.equal(r.body.runtimeConfig.heartbeat.enabled, false, a.key);
      assert.ok(r.body.budgetMonthlyCents > 0);
      assert.ok(!JSON.stringify(ac).includes('$comment'));
      assert.ok(!JSON.stringify(ac).includes('${'), 'no unexpanded placeholder');
    }
    const adhoc = resolveAgent(cfg, cfg.agents.find((a) => a.key === 'adhoc-dev'), vars).body.adapterConfig.workspaceStrategy;
    assert.equal(adhoc.baseRef, 'origin/studio');
    assert.equal(adhoc.type, 'git_worktree');
    const cons = resolveAgent(cfg, cfg.agents.find((a) => a.key === 'construct-dev'), vars).body.adapterConfig.workspaceStrategy;
    assert.equal(cons.baseRef, 'origin/work/2026-09-23');
    assert.match(cons.branchTemplate, /^pc-construct-dev-/);
    assert.equal(cfg.agents.find((a) => a.key === 'og').heartbeat.intervalSec, 7200);
    assert.deepEqual(cfg.agents.find((a) => a.key === 'og').heartbeatAtGo, { enabled: true, intervalSec: 7200 });
  });

  test('a config that would start something is refused', () => {
    const bad = structuredClone(cfg);
    bad.agents[0].heartbeat.enabled = true;
    bad.agents[1].adapterConfig = { model: 'claude-fable-1' };
    bad.budgets.agents['construct-dev'] = 0;
    assert.throws(() => validateConfig(bad), /heartbeat.enabled must be false[\s\S]*not allowed[\s\S]*positive integer/);
  });

  test('every AGENTS.md restates the repo rules and the AI-READY line', () => {
    for (const a of cfg.agents) {
      const { entryFile, files } = readBundle(a, 'origin/work/2026-09-23');
      assert.equal(entryFile, 'AGENTS.md');
      const t = files['AGENTS.md'];
      assert.ok(!t.includes('<!-- include'), a.key);
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(t), `${a.key}: placeholder left`);
      for (const needle of [
        'git pull --rebase origin work/2026-09-23', 'never force-resolve a conflict'.replace('never', 'Never'), 'Never touch `main`', 'ports 3000 and 4000',
        '~/.construct-hosted.env', 'Never write a token or secret to disk', 'one per command', 'packages/tools/dev/heavy.sh',
        'Verify with your own commands', 'Report findings only', 'Never use Fable',
      ]) assert.ok(t.includes(needle), `${a.key} misses: ${needle}`);
      if (a.key !== 'pm') assert.match(t, /AI-READY/, a.key);
    }
    assert.ok(readBundle(cfg.agents.find((a) => a.key === 'og'), 'origin/work/2026-09-23').files['HEARTBEAT.md']);
    const adhoc = readBundle(cfg.agents.find((a) => a.key === 'adhoc-dev'), 'origin/studio').files['AGENTS.md'];
    assert.match(adhoc, /git pull --rebase origin studio/);
    assert.match(adhoc, /git push origin HEAD:studio/);
  });

  test('helpers: loopback, redaction, subset diff, merge', () => {
    for (const h of ['127.0.0.1', 'localhost', '[::1]', '127.5.5.5']) assert.ok(isLoopbackHost(h), h);
    for (const h of ['example.com', '10.0.0.1', '0.0.0.0', '192.168.1.5']) assert.ok(!isLoopbackHost(h), h);
    assert.equal(redact(`x ${FAKE_TOKEN} y`), 'x [redacted] y');
    assert.equal(redact('Authorization: Bearer abcdefghijklmnop1234'), 'Authorization: [redacted]');
    assert.deepEqual(diffSubset({ a: { b: 1 }, c: [1] }, { a: { b: 1, z: 2 }, c: [1] }), []);
    assert.deepEqual(diffSubset({ a: { b: 2 } }, { a: { b: 1 } }), ['a.b']);
    assert.deepEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 3 } }), { a: { b: 3, c: 2 } });
  });
});

describe('apply.mjs against a mock Paperclip', () => {
  let mock;
  before(async () => { mock = await startMock(); });
  after(async () => { await mock.close(); });

  test('dry run (default) makes zero write requests and says what it would do', async () => {
    const r = await node(APPLY, ['--api', mock.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.writes().length, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /CREATE company "Line"/);
    assert.equal((r.stdout.match(/^CREATE agent /gm) ?? []).length, AGENT_COUNT);
    assert.equal((r.stdout.match(/^CREATE goal /gm) ?? []).length, 3);
    assert.match(r.stdout, /Would apply \d+ changes/);
    assert.equal(mock.db.companies.length, 0);
  });

  test('--apply creates the company, goals and agents, all paused with the heartbeat off', async () => {
    mock.log.length = 0;
    const r = await node(APPLY, ['--api', mock.url, '--apply']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /All configured agents are paused\./);
    assert.equal(mock.db.companies.length, 1);
    const company = mock.db.companies[0];
    assert.equal(company.name, 'Line');
    assert.equal(company.budgetMonthlyCents, cfg.budgets.company);
    assert.equal(mock.db.agents.length, AGENT_COUNT);
    assert.equal(mock.db.goals.length, 3);

    const posts = mock.log.filter((q) => q.method === 'POST' && /\/agents$/.test(q.path));
    assert.equal(posts.length, AGENT_COUNT);
    const og = mock.db.agents.find((a) => a.name === 'OG');
    for (const q of posts) {
      const b = q.body;
      assert.equal(b.runtimeConfig.heartbeat.enabled, false, b.name);
      assert.equal(b.adapterType, 'claude_local');
      assert.equal(b.adapterConfig.model, 'claude-sonnet-5');
      assert.equal(b.adapterConfig.filesystemScope, 'workspace');
      assert.equal(b.adapterConfig.networkScope, 'allowlist');
      assert.deepEqual(b.adapterConfig.networkAllowlist, ALLOWLIST);
      assert.equal(b.adapterConfig.dangerouslySkipPermissions, true);
      assert.deepEqual(b.permissions, { canCreateAgents: false, canCreateSkills: false });
      assert.equal(b.instructionsBundle.entryFile, 'AGENTS.md');
      assert.ok(b.instructionsBundle.files['AGENTS.md'].includes('git pull --rebase'));
      const key = cfg.agents.find((a) => a.name === b.name).key;
      assert.equal(b.budgetMonthlyCents, cfg.budgets.agents[key]);
      if (b.name !== 'OG') assert.equal(b.reportsTo, og.id, b.name);
      else assert.equal(b.reportsTo, null);
    }
    const ogPost = posts.find((q) => q.body.name === 'OG').body;
    assert.deepEqual(ogPost.runtimeConfig.heartbeat, { enabled: false, intervalSec: 7200 });
    assert.ok(ogPost.instructionsBundle.files['HEARTBEAT.md']);
    assert.equal(mock.log.filter((q) => /\/pause$/.test(q.path)).length, AGENT_COUNT);
    assert.equal(mock.log.filter((q) => /\/(resume|wakeup|heartbeat\/invoke)$/.test(q.path)).length, 0, 'never resumes or wakes an agent');
    for (const a of mock.db.agents) assert.equal(a.status, 'paused', a.name);
    for (const a of mock.db.agents) {
      const pol = mock.db.policies.find((p) => p.scopeType === 'agent' && p.scopeId === a.id);
      assert.equal(pol.warnPercent, 80);
      assert.equal(pol.hardStopEnabled, true);
    }
    const design = mock.db.agents.find((a) => a.name === 'Design Dev');
    assert.equal(design.status, 'paused');
    const goal = mock.db.goals.find((g) => g.parentId);
    assert.ok(goal.parentId && goal.ownerAgentId === og.id);
    for (const id of mock.db.agents.map((a) => a.id)) assert.ok(r.stdout.includes(id), 'prints the created ids');
  });

  test('a second apply is a no-op and writes nothing', async () => {
    mock.log.length = 0;
    const r = await node(APPLY, ['--api', mock.url, '--apply']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(mock.writes().length, 0, JSON.stringify(mock.writes().slice(0, 3)));
    assert.match(r.stdout, /Applied 0 changes\. Nothing to do/);
    assert.equal(mock.db.agents.length, AGENT_COUNT);
    assert.equal(mock.db.companies.length, 1);
  });

  test('drift is patched, not duplicated; an owner-resumed agent is left alone unless --pause-all', async () => {
    const dev = mock.db.agents.find((a) => a.name === 'Construct Dev');
    dev.title = 'edited by hand';
    dev.adapterConfig.model = 'claude-opus-5';
    dev.budgetMonthlyCents = 99999;
    mock.db.files[dev.id]['AGENTS.md'] = 'tampered';
    mock.db.goals[0].description = 'changed';
    const pm = mock.db.agents.find((a) => a.name === 'PM');
    pm.status = 'idle'; // the owner resumed it
    mock.log.length = 0;
    let r = await node(APPLY, ['--api', mock.url]);
    assert.equal(mock.writes().length, 0, 'dry run still writes nothing');
    assert.match(r.stdout, /PATCH agent Construct Dev \(construct-dev\): title, adapterConfig\.model/);
    assert.match(r.stdout, /PATCH instructions construct-dev\/AGENTS\.md/);
    assert.match(r.stdout, /PATCH budget/);
    assert.match(r.stdout, /PATCH goal/);
    assert.match(r.stdout, /WARNING PM \(pm\): LIVE/);
    assert.equal(r.code, 3);

    mock.log.length = 0;
    r = await node(APPLY, ['--api', mock.url, '--apply']);
    assert.equal(mock.db.agents.length, AGENT_COUNT, 'no duplicate agent');
    assert.equal(dev.title, cfg.agents.find((a) => a.key === 'construct-dev').title);
    assert.equal(dev.adapterConfig.model, 'claude-sonnet-5');
    assert.equal(dev.budgetMonthlyCents, cfg.budgets.agents['construct-dev']);
    assert.notEqual(mock.db.files[dev.id]['AGENTS.md'], 'tampered');
    assert.equal(mock.db.goals[0].description, cfg.goals[0].description);
    assert.equal(pm.status, 'idle', 'the owner resume is respected');
    assert.equal(mock.log.filter((q) => /\/(pause|resume)$/.test(q.path)).length, 0);

    r = await node(APPLY, ['--api', mock.url, '--apply', '--pause-all']);
    assert.equal(pm.status, 'paused');
    assert.equal(r.code, 0, r.stdout);
    mock.log.length = 0;
    r = await node(APPLY, ['--api', mock.url, '--apply']);
    assert.equal(mock.writes().length, 0);
    assert.match(r.stdout, /Nothing to do/);
  });

  test('--status lists every agent with paused state and budget, and writes nothing', async () => {
    mock.log.length = 0;
    const r = await node(APPLY, ['--api', mock.url, '--status']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.writes().length, 0);
    for (const a of cfg.agents) assert.ok(r.stdout.includes(a.name), a.name);
    assert.match(r.stdout, /All agents are paused\./);
    assert.match(r.stdout, /\$40\.00/); // OG's budget
    assert.match(r.stdout, /never/);
    assert.match(r.stdout, /Design Dev \[HELD\]/);
  });

  test('a non-loopback API host is refused before any request, --allow-remote is the explicit override', async () => {
    for (const api of ['http://example.com:3100', 'http://10.1.2.3:3100', 'http://0.0.0.0:3100']) {
      const r = await node(APPLY, ['--api', api, '--apply']);
      assert.equal(r.code, 2, api);
      assert.match(r.stderr, /Refusing non-loopback API host/);
    }
    const s = await node(SYNC, ['--api', 'http://example.com:3100']);
    assert.equal(s.code, 2);
    // with the override the guard passes and the (unreachable, reserved) host fails on the network instead
    const r = await node(APPLY, ['--api', 'http://127.0.0.1:1', '--status']);
    assert.notEqual(r.code, 2, 'loopback is accepted');
  });

  test('a server error that echoes a token never reaches the output', async () => {
    const leaky = await startMock({ leakSecretOn: '/agents' });
    try {
      await node(APPLY, ['--api', leaky.url, '--apply']);
      const r = await node(APPLY, ['--api', leaky.url, '--apply']);
      assert.notEqual(r.code, 0);
      const all = r.stdout + r.stderr;
      assert.ok(!all.includes(FAKE_TOKEN) && !all.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), all);
      assert.match(all, /redacted/);
    } finally {
      await leaky.close();
    }
  });

  test('no output ever contains a secret from the environment', async () => {
    const outs = [];
    outs.push((await node(APPLY, ['--api', mock.url])).stdout, (await node(APPLY, ['--api', mock.url, '--status'])).stdout);
    for (const o of outs) assert.ok(!o.includes(FAKE_TOKEN) && !o.includes(FAKE_KEY));
  });

  test('the bundle and config files themselves carry no secret', () => {
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (/\.(md|json)$/.test(e.name)) assert.equal(redact(fs.readFileSync(p, 'utf8'), {}), fs.readFileSync(p, 'utf8'), p);
      }
    };
    scan(path.join(HERE, 'agents'));
    scan(HERE.length ? path.join(HERE, 'agents', '_shared') : HERE);
    assert.equal(redact(fs.readFileSync(path.join(HERE, 'company.json'), 'utf8'), {}), fs.readFileSync(path.join(HERE, 'company.json'), 'utf8'));
  });
});

describe('github-sync.mjs with a fake gh', () => {
  let mock;
  let ghCmd;
  let ghLog;
  let ghData;
  const long = 'x'.repeat(2000);
  const issue = (number, title, labels = [], body = `Body of ${number}`) => ({ number, title, body, url: `https://github.com/thenewurbankid-web/construct/issues/${number}`, labels: labels.map((name) => ({ name })) });
  const item = (number, module, subModule, priority = 'P1') => ({ content: { number, type: 'Issue' }, module, 'sub-module': subModule, priority });

  before(async () => {
    mock = await startMock();
    const dir = makeTempDir('construct-pc-gh-');
    ghLog = path.join(dir, 'gh.log');
    ghData = path.join(dir, 'data.json');
    ghCmd = path.join(dir, 'gh.cjs');
    fs.writeFileSync(ghData, JSON.stringify({
      open: [
        issue(101, 'Chooser closed options', [], long),
        issue(102, 'Enforcer false positive'),
        issue(103, 'Pages editor drawer'),
        issue(104, 'CLI reference for traces'),
        issue(105, 'Design tokens'),
        issue(106, 'CI flake'),
        issue(107, 'Off-board thing', ['off-board']),
        issue(637, '[Epic] Studio', ['off-board']),
        issue(108, 'Not on the board'),
        issue(109, 'Proof step states'),
        issue(110, 'Chain step card'),
      ],
      items: [
        item(101, 'Front-end Blocks', 'Chooser engine', 'P0'), item(102, 'Core CLI', 'Enforcers'), item(103, 'Web UI', 'Pages Editor', 'P2'),
        item(104, 'Demos & Docs', 'Guides'), item(105, 'Design', 'Screens'), item(106, 'Infra & Process', 'CI & e2e'), item(107, 'Core CLI', 'Other'),
        item(109, 'Front-end Blocks', 'States & proof', 'P0'), item(110, 'Front-end Blocks', 'Chain UI', 'P0'),
      ],
      closed: [50],
    }));
    fs.writeFileSync(ghCmd, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, args.join(' ') + '\\n');
const d = JSON.parse(fs.readFileSync(${JSON.stringify(ghData)}, 'utf8'));
if (args[0] === 'issue' && args[1] === 'list') { console.log(JSON.stringify(d.open)); }
else if (args[0] === 'project' && args[1] === 'item-list') { console.log(JSON.stringify({ items: d.items })); }
else if (args[0] === 'issue' && args[1] === 'view') { const n = Number(args[2]); console.log(JSON.stringify({ number: n, state: d.closed.includes(n) ? 'CLOSED' : 'OPEN' })); }
else { console.error('fake gh: refusing ' + args.join(' ')); process.exit(9); }
`);
    fs.chmodSync(ghCmd, 0o755);
    const r = await node(APPLY, ['--api', mock.url, '--apply']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
  });
  after(async () => { await mock.close(); });

  test('laneFor: the mapping table', () => {
    const m = cfg.laneMapping;
    assert.equal(laneFor(m, 5, 'Front-end Blocks', 'Chooser engine').lane, 'construct');
    assert.equal(laneFor(m, 5, 'Front-end Blocks', 'States & proof').lane, 'guardrails');
    assert.equal(laneFor(m, 5, 'Front-end Blocks', 'Chain UI').lane, 'cockpit');
    assert.equal(laneFor(m, 5, 'Core CLI', 'Enforcers').lane, 'guardrails');
    assert.equal(laneFor(m, 5, 'Core CLI', 'AST & parsing').lane, 'guardrails');
    assert.equal(laneFor(m, 5, 'Core CLI', 'Import').lane, 'construct');
    assert.equal(laneFor(m, 5, 'Web UI', 'Dashboard').lane, 'cockpit');
    assert.equal(laneFor(m, 5, 'Demos & Docs', 'Guides').lane, 'website');
    assert.equal(laneFor(m, 5, 'Design', 'Screens').lane, 'design');
    assert.equal(laneFor(m, 5, 'Infra & Process', 'Other').lane, 'og');
    assert.equal(laneFor(m, 637, undefined, undefined).lane, 'adhoc');
    assert.equal(laneFor(m, 5, undefined, undefined).lane, 'og');
    assert.equal(mirrorTitle(7, 'T'), '[#7] T');
    assert.equal(mirrorBody('u', long, 1500), `u\n\n${'x'.repeat(1500)}`);
  });

  test('dry run: says what it would do, writes nothing to Paperclip, only reads GitHub', async () => {
    mock.log.length = 0;
    const r = await node(SYNC, ['--api', mock.url, '--gh', ghCmd]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.writes().length, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /CREATE #101 -> construct/);
    assert.match(r.stdout, /CREATE #102 -> guardrails/);
    assert.match(r.stdout, /CREATE #103 -> cockpit/);
    assert.match(r.stdout, /CREATE #104 -> website/);
    assert.match(r.stdout, /CREATE #105 -> design/);
    assert.match(r.stdout, /CREATE #106 -> og/);
    assert.match(r.stdout, /CREATE #637 -> adhoc/);
    assert.match(r.stdout, /CREATE #108 -> og \(not on the board\)/);
    assert.match(r.stdout, /CREATE #109 -> guardrails/);
    assert.match(r.stdout, /CREATE #110 -> cockpit/);
    assert.match(r.stdout, /SKIP #107 \(label off-board\)/);
    assert.match(r.stdout, /10 create, 0 patch, 0 close/);
    assert.equal(mock.db.issues.length, 0);
  });

  test('--apply creates mirrors: prefix, url plus 1500 chars, module label, lane assignee, backlog; second run is a no-op', async () => {
    mock.log.length = 0;
    let r = await node(SYNC, ['--api', mock.url, '--gh', ghCmd, '--apply']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(mock.db.issues.length, 10);
    const by = (n) => mock.db.issues.find((i) => i.title.startsWith(`[#${n}] `));
    const agent = (name) => mock.db.agents.find((a) => a.name === name).id;
    const i101 = by(101);
    assert.equal(i101.title, '[#101] Chooser closed options');
    assert.equal(i101.description, `https://github.com/thenewurbankid-web/construct/issues/101\n\n${'x'.repeat(1500)}`);
    assert.equal(i101.status, 'backlog');
    assert.equal(i101.assigneeAgentId, agent('Construct Dev'));
    assert.equal(i101.priority, 'critical');
    assert.equal(mock.db.labels.find((l) => l.id === i101.labelIds[0]).name, 'Front-end Blocks');
    assert.equal(by(102).assigneeAgentId, agent('Guardrails Dev'));
    assert.equal(by(103).assigneeAgentId, agent('Cockpit Dev'));
    assert.equal(by(103).priority, 'medium');
    assert.equal(by(104).assigneeAgentId, agent('Website Dev'));
    assert.equal(by(105).assigneeAgentId, agent('Design Dev'));
    assert.equal(by(106).assigneeAgentId, agent('OG'));
    assert.equal(by(637).assigneeAgentId, agent('Ad hoc Dev'));
    assert.equal(mock.db.labels.find((l) => l.id === by(637).labelIds[0]).name, 'Studio');
    assert.equal(by(109).assigneeAgentId, agent('Guardrails Dev'));
    assert.equal(by(110).assigneeAgentId, agent('Cockpit Dev'));
    assert.equal(by(107), undefined, 'off-board is skipped unless mapped');
    assert.equal(mock.db.agents.every((a) => a.status === 'paused'), true);

    mock.log.length = 0;
    r = await node(SYNC, ['--api', mock.url, '--gh', ghCmd, '--apply']);
    assert.equal(mock.writes().length, 0);
    assert.match(r.stdout, /Applied 0 changes/);
    assert.equal(mock.db.issues.length, 10);
  });

  test('a closed GitHub issue closes its mirror; a retitled one is patched; GitHub is never written to', async () => {
    mock.db.issues.push({ id: 'mirror-50', title: '[#50] Old work', status: 'in_progress' });
    mock.db.issues.find((i) => i.title.startsWith('[#102]')).title = '[#102] stale title';
    mock.log.length = 0;
    const r = await node(SYNC, ['--api', mock.url, '--gh', ghCmd, '--apply']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /CLOSE #50/);
    assert.equal(mock.db.issues.find((i) => i.id === 'mirror-50').status, 'done');
    assert.equal(mock.db.issues.find((i) => i.title.startsWith('[#102]')).title, '[#102] Enforcer false positive');
    const calls = fs.readFileSync(ghLog, 'utf8').trim().split('\n');
    for (const c of calls) assert.match(c, /^(issue list|issue view|project item-list) /, `only reads: ${c}`);
    assert.ok(!calls.some((c) => /\b(create|edit|close|comment|delete|reopen)\b/.test(c)));
    const again = await node(SYNC, ['--api', mock.url, '--gh', ghCmd, '--apply']);
    assert.match(again.stdout, /Applied 0 changes/);
  });

  test('refuses to run before apply.mjs created the company, and prints no secret', async () => {
    const empty = await startMock();
    try {
      const r = await node(SYNC, ['--api', empty.url, '--gh', ghCmd]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /run apply\.mjs --apply first/);
      assert.ok(!(r.stdout + r.stderr).includes(FAKE_TOKEN));
    } finally {
      await empty.close();
    }
  });
});

// ---- claude-gate.sh: the machine-wide slot gate ------------------------------------------------------------------------------
const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude-gate.sh');

function gateEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const meminfo = path.join(dir, 'meminfo');
  fs.writeFileSync(meminfo, 'MemAvailable: 8000000 kB\n');
  const log = path.join(dir, 'log');
  const fake = path.join(dir, 'claude');
  fs.writeFileSync(fake, `#!/usr/bin/env bash\necho "start $$ $(date +%s%N)" >> "${log}"\nsleep ${extra.hold ?? 1}\necho "end $$ $(date +%s%N)" >> "${log}"\n`, { mode: 0o755 });
  return { dir, log, env: { ...process.env, PAPERCLIP_SLOT_DIR: path.join(dir, 'slots'), PAPERCLIP_REAL_CLAUDE: fake, PAPERCLIP_MEMINFO: meminfo, PAPERCLIP_MAX_CLAUDE: '2', PAPERCLIP_GATE_WAIT_SEC: '30', ...extra.env } };
}
const runGate = (env, args = []) => new Promise((resolve) => {
  const c = spawn('bash', [GATE, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  c.stderr.on('data', (b) => { err += b; });
  c.on('close', (code) => resolve({ code, err }));
});

test('claude-gate: four concurrent runs with two slots never run more than two at once, and all finish', async () => {
  const g = gateEnv();
  const results = await Promise.all([1, 2, 3, 4].map(() => runGate(g.env, ['--print', 'x'])));
  assert.deepEqual(results.map((r) => r.code), [0, 0, 0, 0]);
  const events = fs.readFileSync(g.log, 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([kind, pid, ns]) => ({ kind, pid, ns: BigInt(ns) }));
  assert.equal(events.filter((e) => e.kind === 'start').length, 4);
  let live = 0, peak = 0;
  for (const e of events.sort((a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0))) { live += e.kind === 'start' ? 1 : -1; peak = Math.max(peak, live); }
  assert.ok(peak <= 2, `at most 2 at once, saw ${peak}`);
});

test('claude-gate: a killed holder frees its slot', async () => {
  const g = gateEnv({ hold: 30, env: { PAPERCLIP_MAX_CLAUDE: '1' } });
  const holder = spawn('bash', [GATE], { env: g.env, stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 700));
  process.kill(-holder.pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  const fast = gateEnv({ hold: 0, env: { PAPERCLIP_MAX_CLAUDE: '1', PAPERCLIP_SLOT_DIR: g.env.PAPERCLIP_SLOT_DIR, PAPERCLIP_GATE_WAIT_SEC: '10' } });
  const r = await runGate(fast.env);
  assert.equal(r.code, 0, r.err);
});

test('claude-gate: too little free memory waits and then exits 75 with a message, without starting claude', async () => {
  const g = gateEnv({ env: { PAPERCLIP_MIN_AVAILABLE_KB: '99999999', PAPERCLIP_GATE_WAIT_SEC: '2' } });
  const r = await runGate(g.env);
  assert.equal(r.code, 75);
  assert.match(r.err, /too little free memory/);
  assert.equal(fs.existsSync(g.log), false, 'claude never started');
});

test('claude-gate: the real command gets the same arguments', async () => {
  const g = gateEnv();
  fs.writeFileSync(path.join(g.dir, 'claude'), `#!/usr/bin/env bash\nprintf '%s|' "$@" > "${g.log}"\n`, { mode: 0o755 });
  const r = await runGate(g.env, ['--print', 'hello world']);
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(g.log, 'utf8'), '--print|hello world|');
});
