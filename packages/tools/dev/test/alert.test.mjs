// #655 -- alert.mjs: raise (create once, comment on repeat, severity), resolve, the redactor and the 3000-character tail, status
// merging three sources with a fake `gh` and a fake Paperclip fetch, watch (only new items, persisted state), the once-a-day alert
// for a failed scheduled docs build of main, the CI step's reading of build-on-ready's output, and the workflow YAML.
//
//   node --test packages/tools/dev/test/alert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import { formatResult } from '../build-on-ready.mjs';
import {
  alertForBuild, alertTitle, buildBody, collectStatus, failedRuns, formatStatus, listOpenAlerts, main, paperclipTrouble, parseAlertTitle,
  parseArgs, parseBuildOutput, raiseAlert, redact, resolveAlert, sanitizeKey, statusItems, truncateTail, watch,
} from '../alert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const NOW = new Date('2026-09-25T10:00:00Z');
const tok = (prefix, n = 30) => prefix + 'A1b2C3d4E5f6G7h8I9j0'.repeat(3).slice(0, n);

/** An in-memory `gh`: issues, labels, runs. Records every call (`calls`) and every write (`writes`). */
function fakeGh({ labels = ['bug', 'story'], runs = {}, failOn } = {}) {
  const state = { issues: [], labels: new Set(labels), calls: [], writes: [], nextIssue: 700, runs };
  const gh = async (args, { input } = {}) => {
    state.calls.push({ args, input });
    if (failOn && failOn(args)) throw new Error('gh boom');
    const [a, b] = args;
    const flag = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
    const flagAll = (n) => args.flatMap((x, i) => (x === n ? [args[i + 1]] : []));
    if (a === 'label' && b === 'list') return JSON.stringify([...state.labels].map((name) => ({ name })));
    if (a === 'label' && b === 'create') { state.writes.push(args); state.labels.add(args[2]); return ''; }
    if (a === 'issue' && b === 'list') {
      return JSON.stringify(state.issues.filter((i) => i.state === 'open' && i.labels.includes(flag('--label'))).map((i) => ({ number: i.number, title: i.title, url: i.url, createdAt: i.createdAt, updatedAt: i.updatedAt })));
    }
    if (a === 'issue' && b === 'create') {
      state.writes.push(args);
      const n = state.nextIssue++;
      state.issues.push({ number: n, title: flag('--title'), url: `https://github.com/thenewurbankid-web/construct/issues/${n}`, state: 'open', labels: flagAll('--label'), assignee: flag('--assignee'), body: input, comments: [], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
      return `https://github.com/thenewurbankid-web/construct/issues/${n}\n`;
    }
    if (a === 'issue' && b === 'comment') { state.writes.push(args); state.issues.find((i) => i.number === Number(args[2])).comments.push(input); return ''; }
    if (a === 'issue' && b === 'close') { state.writes.push(args); const i = state.issues.find((x) => x.number === Number(args[2])); i.state = 'closed'; i.closeComment = flag('--comment'); return ''; }
    if (a === 'run' && b === 'list') return JSON.stringify(state.runs[flag('--branch')] || []);
    throw new Error(`fake gh: unexpected ${args.join(' ')}`);
  };
  gh.state = state;
  return gh;
}

const run = (o) => ({ databaseId: 1, workflowName: 'Build on ready', displayTitle: 't', headBranch: 'work/2026-09-23', headSha: 'abcdef0123456789', event: 'push', conclusion: 'failure', createdAt: '2026-09-25T08:00:00Z', url: 'https://github.com/x/actions/runs/1', ...o });

// ---------------------------------------------------------------------------------------------------------- redaction

test('redact strips token-shaped strings and Authorization headers', () => {
  const secrets = [tok('ghp_'), tok('gho_'), tok('ghu_'), tok('ghs_'), tok('github_pat_', 40), tok('sk-'), tok('sk-ant-api03-', 40), 'AKIAIOSFODNN7EXAMPLE', 'Bearer ' + tok('', 30)];
  for (const s of secrets) {
    const out = redact(`before ${s} after`);
    assert.ok(!out.includes(s.slice(4)), `left ${s.slice(0, 8)} in ${out}`);
    assert.match(out, /\[redacted\]/);
  }
  assert.equal(redact('Authorization: token ghp_abc\nnext line'), 'Authorization: [redacted]\nnext line');
  assert.equal(redact('curl -H "Authorization: Bearer abc.def.ghi" https://x'), 'curl -H "Authorization: [redacted]" https://x');
  assert.equal(redact('GH_TOKEN=hunter2hunter2 ok'), 'GH_TOKEN=[redacted] ok');
  assert.equal(redact('plain text, a task-runner and 12345 stay'), 'plain text, a task-runner and 12345 stay');
  assert.equal(redact(undefined), '');
});

test('truncateTail keeps the last 3000 characters, marks the cut and redacts a token cut in half or whole', () => {
  const long = 'x'.repeat(5000) + '\nlast line';
  const t = truncateTail(long);
  assert.equal(t.length, 3000);
  assert.ok(t.startsWith('...'));
  assert.ok(t.endsWith('last line'));
  assert.equal(truncateTail('short\n'), 'short');
  const withToken = 'y'.repeat(4000) + ' ' + tok('ghp_') + ' end';
  assert.ok(!truncateTail(withToken).includes(tok('ghp_').slice(5)));
});

test('buildBody has the fixed fields, redacts every one of them and bounds the tail', () => {
  const body = buildBody({ severity: 'critical', lane: 'cockpit', check: 'client specs', range: 'aaa111..bbb222', runUrl: 'https://github.com/o/r/actions/runs/9', at: NOW, summary: 'oops ' + tok('ghp_'), tail: 'z'.repeat(9000) + '\nAuthorization: Bearer abcdefghijkl' });
  for (const s of ['**Severity:** critical', '**Lane:** cockpit', '**Check:** client specs', '**Commits:** aaa111..bbb222', '**Run:** https://github.com/o/r/actions/runs/9', '**When:** 2026-09-25T10:00:00.000Z']) assert.ok(body.includes(s), s);
  assert.ok(!body.includes('ghp_A1b2'));
  assert.ok(!body.includes('abcdefghijkl'));
  const tail = body.split('````text\n')[1].split('\n````')[0];
  assert.ok(tail.length <= 3000);
  assert.equal(buildBody({ range: '0000000000000000000000000000000000000000..abc', at: NOW }).includes('**Commits:** abc'), true);
});

test('keys and titles: sanitised, parsed back, and a title never carries a token', () => {
  assert.equal(sanitizeKey('build-work/2026-09-23-Cockpit'), 'build-work-2026-09-23-cockpit');
  assert.equal(alertTitle('docs-main', 'the docs failed'), '[alert] docs-main: the docs failed');
  assert.deepEqual(parseAlertTitle('[alert] docs-main: the docs failed'), { key: 'docs-main', title: 'the docs failed' });
  assert.equal(parseAlertTitle('Story: something'), null);
  assert.ok(!alertTitle('k', 'x ' + tok('ghp_')).includes('ghp_A1'));
});

// ------------------------------------------------------------------------------------------------------ raise, resolve

test('raise creates the alert once (labels, assignee, key title) and comments on a repeat, never a second issue', async () => {
  const gh = fakeGh();
  const first = await raiseAlert({ gh, key: 'build-work-2026-09-23-cockpit', title: 'lane cockpit held', severity: 'warn', at: NOW, fields: { lane: 'cockpit', runUrl: 'https://r/1' } });
  assert.equal(first.action, 'created');
  assert.deepEqual(first.labelsCreated, ['alert', 'off-board']);
  assert.equal(first.number, 700);
  const issue = gh.state.issues[0];
  assert.equal(issue.title, '[alert] build-work-2026-09-23-cockpit: lane cockpit held');
  assert.deepEqual(issue.labels, ['alert', 'off-board']);
  assert.equal(issue.assignee, 'thenewurbankid-web');
  assert.ok(issue.body.includes('https://r/1'));

  const again = await raiseAlert({ gh, key: 'build-work-2026-09-23-cockpit', title: 'lane cockpit held', at: new Date('2026-09-25T11:00:00Z'), fields: { runUrl: 'https://r/2' } });
  assert.equal(again.action, 'commented');
  assert.equal(again.number, 700);
  assert.equal(gh.state.issues.length, 1);
  assert.equal(gh.state.issues[0].comments.length, 1);
  assert.ok(gh.state.issues[0].comments[0].includes('https://r/2'));
  assert.ok(gh.state.issues[0].comments[0].includes('2026-09-25T11:00:00.000Z'));
  assert.deepEqual(again.labelsCreated, []);

  await raiseAlert({ gh, key: 'other', title: 'another', at: NOW });
  assert.equal(gh.state.issues.length, 2);
});

test('raise creates each missing label with its own command, and only the missing ones; every gh write is one command', async () => {
  const gh = fakeGh({ labels: ['off-board'] });
  await raiseAlert({ gh, key: 'k', title: 't', at: NOW });
  const creates = gh.state.writes.filter((w) => w[0] === 'label');
  assert.equal(creates.length, 1);
  assert.equal(creates[0][2], 'alert');
  assert.equal(gh.state.writes.length, 2);
  for (const c of gh.state.calls) assert.ok(c.args.every((x) => typeof x === 'string'), 'args are an argv array, never a shell string');
});

test('severity: info is not assigned (no notification), warn and critical are; a bad severity is refused', async () => {
  const gh = fakeGh();
  await raiseAlert({ gh, key: 'i', title: 't', severity: 'info', at: NOW });
  await raiseAlert({ gh, key: 'w', title: 't', severity: 'warn', at: NOW });
  await raiseAlert({ gh, key: 'c', title: 't', severity: 'critical', at: NOW });
  assert.deepEqual(gh.state.issues.map((i) => i.assignee), [undefined, 'thenewurbankid-web', 'thenewurbankid-web']);
  assert.ok(gh.state.issues[2].body.includes('**Severity:** critical'));
  await assert.rejects(raiseAlert({ gh, key: 'x', title: 't', severity: 'loud' }), /--severity must be one of/);
  await assert.rejects(raiseAlert({ gh, key: '', title: 't' }), /needs a --key/);
});

test('a raised body never contains a token, even from the free-text body and the tail', async () => {
  const gh = fakeGh();
  await raiseAlert({ gh, key: 'leak', title: 't', body: 'see ' + tok('github_pat_', 40), at: NOW, fields: { tail: 'Authorization: Bearer ' + tok('', 30) + '\nGH_TOKEN=' + tok('ghs_') } });
  const text = JSON.stringify(gh.state.calls);
  for (const needle of ['A1b2C3d4E5f6', 'github_pat_A1', 'ghs_A1']) assert.ok(!text.includes(needle), needle);
});

test('resolve comments and closes the open alert in one command; nothing open is a no-op', async () => {
  const gh = fakeGh();
  await raiseAlert({ gh, key: 'k', title: 't', at: NOW });
  const r = await resolveAlert({ gh, key: 'k', note: 'green again', at: NOW });
  assert.equal(r.action, 'closed');
  assert.equal(gh.state.issues[0].state, 'closed');
  assert.match(gh.state.issues[0].closeComment, /^Resolved at 2026-09-25T10:00:00.000Z: green again$/);
  const before = gh.state.writes.length;
  assert.equal((await resolveAlert({ gh, key: 'k' })).action, 'none');
  assert.equal(gh.state.writes.length, before);
  const again = await raiseAlert({ gh, key: 'k', title: 't', at: NOW });
  assert.equal(again.action, 'created', 'a closed alert is not open, the next failure opens a new one');
});

test('listOpenAlerts ignores issues whose title is not an alert title', async () => {
  const gh = fakeGh();
  gh.state.issues.push({ number: 5, title: 'Story: not an alert', url: 'u', state: 'open', labels: ['alert'], createdAt: '', updatedAt: '' });
  assert.deepEqual(await listOpenAlerts(gh), []);
});

// ---------------------------------------------------------------------------------------------------------------- status

const fetchWith = (routes) => async (url) => {
  const p = new URL(url).pathname;
  if (!(p in routes)) return { ok: false, status: 404, json: async () => ({}) };
  const v = routes[p];
  if (v instanceof Error) throw v;
  return { ok: true, status: 200, json: async () => v };
};
const PAPERCLIP = {
  '/api/companies': [{ id: 'c1', name: 'Line' }],
  '/api/companies/c1/agents': [
    { id: 'a1', name: 'Cockpit Dev', status: 'error', errorReason: 'adapter crashed' },
    { id: 'a2', name: 'OG', status: 'paused', pauseReason: 'manual' },
    { id: 'a3', name: 'PM', status: 'paused', pauseReason: 'budget hard stop', spentMonthlyCents: 1000, budgetMonthlyCents: 1000 },
    { id: 'a4', name: 'Construct Dev', status: 'idle' },
  ],
};

test('failedRuns keeps failures of the last 24 hours and marks one recovered by a later green run of the same workflow', async () => {
  const gh = fakeGh({ runs: { 'work/2026-09-23': [
    run({ databaseId: 3, workflowName: 'Build on ready', conclusion: 'success', createdAt: '2026-09-25T09:00:00Z' }),
    run({ databaseId: 2, workflowName: 'Build on ready', conclusion: 'failure', createdAt: '2026-09-25T08:00:00Z' }),
    run({ databaseId: 4, workflowName: 'Pages documentation', conclusion: 'failure', createdAt: '2026-09-25T07:00:00Z' }),
    run({ databaseId: 5, workflowName: 'Pages documentation', conclusion: 'failure', createdAt: '2026-09-23T07:00:00Z' }),
    run({ databaseId: 6, workflowName: 'Pages documentation', conclusion: 'cancelled', createdAt: '2026-09-25T07:30:00Z' }),
  ] } });
  const { runs } = await failedRuns(gh, { now: NOW });
  assert.deepEqual(runs.map((r) => r.id).sort(), [2, 4]);
  assert.equal(runs.find((r) => r.id === 2).recovered, true);
  assert.equal(runs.find((r) => r.id === 4).recovered, false);
});

test('paperclipTrouble reports error agents and budget hard stops, ignores idle and owner-paused ones, and is silent when unreachable', async () => {
  const t = await paperclipTrouble({ fetchImpl: fetchWith(PAPERCLIP) });
  assert.equal(t.reachable, true);
  assert.deepEqual(t.agents.map((a) => [a.name, a.status]), [['Cockpit Dev', 'error'], ['PM', 'budget-hard-stop']]);
  const down = await paperclipTrouble({ fetchImpl: fetchWith({ '/api/companies': new Error('ECONNREFUSED') }) });
  assert.deepEqual(down, { reachable: false, agents: [] });
  const noCompany = await paperclipTrouble({ fetchImpl: fetchWith({ '/api/companies': [{ id: 'z', name: 'Other' }] }) });
  assert.equal(noCompany.reachable, true);
  assert.match(noCompany.error, /no company "Line"/);
  await assert.rejects(paperclipTrouble({ fetchImpl: fetchWith({}), api: 'http://example.com:3100' }), /non-loopback/);
});

test('status merges open alerts, failed runs on the three branches and Paperclip agents; it makes no write', async () => {
  const gh = fakeGh({ runs: {
    'work/2026-09-23': [run({ databaseId: 10 })],
    studio: [],
    main: [run({ databaseId: 11, workflowName: 'Pages documentation', headBranch: 'main', event: 'schedule' })],
  } });
  await raiseAlert({ gh, key: 'build-x', title: 'x', at: NOW });
  gh.state.writes.length = 0;
  const st = await collectStatus({ gh, fetchImpl: fetchWith(PAPERCLIP), now: NOW });
  assert.equal(st.alerts.length, 1);
  assert.deepEqual(st.runs.map((r) => r.id).sort(), [10, 11]);
  assert.equal(st.agents.length, 2);
  assert.equal(st.paperclip, 'ok');
  assert.deepEqual(st.errors, []);
  assert.equal(gh.state.writes.length, 0);
  const branches = gh.state.calls.filter((c) => c.args[0] === 'run').map((c) => c.args[c.args.indexOf('--branch') + 1]);
  assert.deepEqual(branches, ['work/2026-09-23', 'studio', 'main']);
  const text = formatStatus(st);
  assert.match(text, /open alerts \(1\)/);
  assert.match(text, /Cockpit Dev: error/);
});

test('status without Paperclip skips it, and a failing gh source is named while the others are still reported', async () => {
  const gh = fakeGh({ runs: { 'work/2026-09-23': [run({ databaseId: 10 })] }, failOn: (a) => a[0] === 'run' && a.includes('studio') });
  const st = await collectStatus({ gh, fetchImpl: fetchWith({ '/api/companies': new Error('down') }), now: NOW });
  assert.equal(st.paperclip, 'unreachable');
  assert.deepEqual(st.agents, []);
  assert.equal(st.runs.length, 1);
  assert.match(st.errors[0], /runs of studio: gh boom/);
  assert.equal((await collectStatus({ gh: fakeGh(), now: NOW, paperclip: false })).paperclip, 'skipped');
});

// ----------------------------------------------------------------------------------------------------------------- watch

test('watch prints only what is new, persists its state atomically and is silent (no items, exit 0) the second time', async () => {
  const dir = makeTempDir('alert-watch-');
  const stateFile = path.join(dir, 'sub', 'alerts.json');
  const gh = fakeGh({ runs: { 'work/2026-09-23': [run({ databaseId: 10 })] } });
  const fetchImpl = fetchWith(PAPERCLIP);
  const first = await watch({ gh, fetchImpl, now: NOW, stateFile });
  assert.deepEqual(first.items.map((i) => i.kind).sort(), ['agent', 'agent', 'run']);
  assert.ok(fs.existsSync(stateFile));
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ['alerts.json'], 'no temp file left behind');
  const second = await watch({ gh, fetchImpl, now: new Date(NOW.getTime() + 60000), stateFile });
  assert.deepEqual(second.items, []);

  gh.state.runs['work/2026-09-23'].push(run({ databaseId: 12, workflowName: 'Pages documentation' }));
  await raiseAlert({ gh, key: 'build-y', title: 'y', at: NOW });
  const third = await watch({ gh, fetchImpl, now: new Date(NOW.getTime() + 120000), stateFile });
  assert.deepEqual(third.items.map((i) => i.id).sort(), ['alert:700', 'run:12']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the CLI prints nothing and exits 0 when nothing is new; --json prints { new: [...] } otherwise', async () => {
  const dir = makeTempDir('alert-watch-cli-');
  const stateFile = path.join(dir, 'a.json');
  const gh = fakeGh({ runs: { 'work/2026-09-23': [run({ databaseId: 10 })] } });
  const args = ['watch', '--paperclip', 'off', '--state-file', stateFile];
  const a = await main([...args, '--json'], { gh, now: NOW });
  assert.equal(a.code, 0);
  assert.equal(JSON.parse(a.out).new[0].id, 'run:10');
  const b = await main(args, { gh, now: NOW });
  assert.deepEqual(b, { code: 0, out: '' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('watch state is bounded to 500 ids and a damaged state file starts fresh', async () => {
  const dir = makeTempDir('alert-watch-bound-');
  const stateFile = path.join(dir, 'a.json');
  const seen = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`run:${i}`, new Date(1e12 + i * 1000).toISOString()]));
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, seen, daily: {} }));
  const gh = fakeGh({ runs: { 'work/2026-09-23': [run({ databaseId: 5000 })] } });
  await watch({ gh, now: NOW, stateFile, paperclip: false });
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(Object.keys(saved.seen).length, 500);
  assert.ok('run:5000' in saved.seen);
  assert.ok(!('run:0' in saved.seen), 'the oldest ids go first');
  fs.writeFileSync(stateFile, '{ not json');
  const again = await watch({ gh, now: NOW, stateFile, paperclip: false });
  assert.equal(again.items.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('watch alerts for a failed SCHEDULED docs build of main at most once a day, with the frozen-main note', async () => {
  const dir = makeTempDir('alert-watch-main-');
  const stateFile = path.join(dir, 'a.json');
  const sched = run({ databaseId: 20, workflowName: 'Pages documentation', headBranch: 'main', event: 'schedule', createdAt: '2026-09-25T06:17:00Z' });
  const gh = fakeGh({ runs: { main: [sched] } });
  const w1 = await watch({ gh, now: NOW, stateFile, paperclip: false });
  assert.equal(w1.raised.action, 'created');
  assert.equal(gh.state.issues.length, 1);
  assert.equal(gh.state.issues[0].title, '[alert] docs-main-schedule: the scheduled docs build of main failed');
  assert.match(gh.state.issues[0].body, /expected until main is unfrozen or its schedule is removed/);
  assert.ok(w1.items.some((i) => i.text.includes('docs-main-schedule')));

  // the same day, a newer failed scheduled run: no second write
  gh.state.runs.main.unshift({ ...sched, databaseId: 21, createdAt: '2026-09-25T12:17:00Z' });
  const w2 = await watch({ gh, now: new Date('2026-09-25T13:00:00Z'), stateFile, paperclip: false });
  assert.equal(w2.raised, null);
  assert.equal(gh.state.issues.length, 1);
  assert.equal(gh.state.issues[0].comments.length, 0);

  // the next day: a comment on the open alert (deduplicated by key, never a second issue)
  gh.state.runs.main.unshift({ ...sched, databaseId: 22, createdAt: '2026-09-26T06:17:00Z' });
  const w3 = await watch({ gh, now: new Date('2026-09-26T07:00:00Z'), stateFile, paperclip: false });
  assert.equal(w3.raised.action, 'commented');
  assert.equal(gh.state.issues.length, 1);
  assert.equal(gh.state.issues[0].comments.length, 1);

  // a failed push run of the docs on main, or a failed schedule run on another branch, does not trigger it
  const gh2 = fakeGh({ runs: { main: [{ ...sched, event: 'push' }], 'work/2026-09-23': [{ ...sched, databaseId: 30, headBranch: 'work/2026-09-23' }] } });
  const w4 = await watch({ gh: gh2, now: NOW, stateFile: path.join(dir, 'b.json'), paperclip: false });
  assert.equal(w4.raised, null);
  assert.equal(gh2.state.issues.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('statusItems leaves recovered runs out and gives a source error one id per day', () => {
  const st = { alerts: [], runs: [{ id: 1, recovered: true }, { id: 2, recovered: false, workflow: 'w', branch: 'b', event: 'push', at: 'x', sha: 's', url: 'u' }], agents: [], errors: ['runs of studio: boom'] };
  const items = statusItems(st, NOW);
  assert.deepEqual(items.map((i) => i.kind), ['run', 'error']);
  assert.equal(items[1].id, statusItems(st, new Date('2026-09-25T20:00:00Z'))[1].id);
});

// ------------------------------------------------------------------------------------------------------------ CI build

const HELD_TEXT = [
  'BUILD cockpit/build-2026-09-25-0900  aaaaaaaaa..bbbbbbbbb  1 capability in 2 commits  [held]',
  '  + bbbbbbbbb [#7] Client: a button',
  '  HELD: client specs failed after 12s',
  '    not ok 1 - renders',
  '    Authorization: Bearer ' + tok('', 30),
  'BUILD site/build-2026-09-25-0900  ccccccccc..ddddddddd  1 capability in 1 commit  [built]',
  '  + ddddddddd [#8] Site: a page',
].join('\n');

test('parseBuildOutput reads the held lane, its check and tail, and the built lane, from build-on-ready text', () => {
  const { builds } = parseBuildOutput(HELD_TEXT);
  assert.deepEqual(builds.map((b) => [b.lane, b.status, b.range]), [['cockpit', 'held', 'aaaaaaaaa..bbbbbbbbb'], ['site', 'built', 'ccccccccc..ddddddddd']]);
  assert.match(builds[0].held[0].check, /client specs \(failed after 12s\)/);
  assert.match(builds[0].held[0].tail, /not ok 1 - renders/);
});

test('parseBuildOutput reads the real formatResult output of build-on-ready (held and tag-push error)', () => {
  const text = formatResult({
    branch: 'work/2026-09-23', tip: 'f'.repeat(40), dryRun: false, lanes: ['cockpit', 'site'], baselines: [], notes: [], install: [],
    builds: [
      { lane: 'cockpit', tag: 'cockpit/build-2026-09-25-0900', from: 'a'.repeat(40), to: 'b'.repeat(40), commits: 2, capabilities: [{ sha: 'b'.repeat(40), subject: 'x' }], status: 'held', check: { ok: false, results: [{ name: 'client specs', ok: false, ms: 4000, tail: 'line one\nline two' }] } },
      { lane: 'site', tag: 'site/build-2026-09-25-0900', from: 'c'.repeat(40), to: 'd'.repeat(40), commits: 1, capabilities: [], status: 'failed', error: 'remote rejected', check: { ok: true, results: [] } },
    ],
  });
  const { builds } = parseBuildOutput(text);
  assert.equal(builds[0].lane, 'cockpit');
  assert.equal(builds[0].held[0].check, 'client specs (failed after 4s)');
  assert.equal(builds[0].held[0].tail.trim(), 'line one\nline two');
  assert.equal(builds[1].status, 'failed');
  assert.equal(builds[1].error, 'remote rejected');
});

test('a held lane raises build-<branch>-<lane> with lane, check, range, run URL and a redacted tail; the built lane does not', async () => {
  const gh = fakeGh();
  const r = await alertForBuild({ gh, branch: 'work/2026-09-23', outcome: 'failure', resultText: HELD_TEXT, runUrl: 'https://github.com/o/r/actions/runs/77', at: NOW });
  assert.deepEqual(r.raised.map((x) => x.key), ['build-work-2026-09-23-cockpit']);
  const issue = gh.state.issues[0];
  assert.equal(issue.title, '[alert] build-work-2026-09-23-cockpit: lane cockpit held by a failing check');
  for (const s of ['**Lane:** cockpit', 'client specs (failed after 12s)', 'aaaaaaaaa..bbbbbbbbb', 'actions/runs/77', 'not ok 1 - renders']) assert.ok(issue.body.includes(s), s);
  assert.ok(!issue.body.includes('A1b2C3d4E5f6'));
  // the same failure on the next push: a comment, not a second issue
  await alertForBuild({ gh, branch: 'work/2026-09-23', outcome: 'failure', resultText: HELD_TEXT, runUrl: 'https://github.com/o/r/actions/runs/78', at: NOW });
  assert.equal(gh.state.issues.length, 1);
  assert.equal(gh.state.issues[0].comments.length, 1);
});

test('a failed run with no held lane raises build-<branch>; a green run resolves every key of that branch and no other branch', async () => {
  const gh = fakeGh();
  const r = await alertForBuild({ gh, branch: 'work/2026-09-23', outcome: 'failure', resultText: '', runUrl: 'u', range: 'a..b', at: NOW });
  assert.equal(r.raised[0].key, 'build-work-2026-09-23');
  await raiseAlert({ gh, key: 'build-work-2026-09-23-cockpit', title: 't', at: NOW });
  await raiseAlert({ gh, key: 'build-studio-adhoc', title: 't', at: NOW });
  await raiseAlert({ gh, key: 'docs-work-2026-09-23', title: 't', at: NOW });
  const g = await alertForBuild({ gh, branch: 'work/2026-09-23', outcome: 'success', resultText: 'nothing to build: no lane has a capability commit since its last build tag', at: NOW });
  assert.deepEqual(g.resolved.map((x) => x.key).sort(), ['build-work-2026-09-23', 'build-work-2026-09-23-cockpit']);
  assert.deepEqual(gh.state.issues.filter((i) => i.state === 'open').map((i) => parseAlertTitle(i.title).key).sort(), ['build-studio-adhoc', 'docs-work-2026-09-23']);
});

test('a red run resolves only what it explains: a lane built now, and the run-level key when a lane is held', async () => {
  const gh = fakeGh();
  await raiseAlert({ gh, key: 'build-work-2026-09-23', title: 't', at: NOW });
  await raiseAlert({ gh, key: 'build-work-2026-09-23-site', title: 't', at: NOW });
  await raiseAlert({ gh, key: 'build-work-2026-09-23-guardrails', title: 't', at: NOW });
  const r = await alertForBuild({ gh, branch: 'work/2026-09-23', outcome: 'failure', resultText: HELD_TEXT, at: NOW });
  assert.deepEqual(r.raised.map((x) => x.key), ['build-work-2026-09-23-cockpit']);
  assert.deepEqual(r.resolved.map((x) => x.key).sort(), ['build-work-2026-09-23', 'build-work-2026-09-23-site']);
  assert.ok(gh.state.issues.find((i) => i.title.includes('-guardrails:')).state === 'open');
});

test('a tag that could not be pushed is an alert even though the job exit code is 0; a cancelled run does nothing', async () => {
  const gh = fakeGh();
  const text = 'BUILD site/build-2026-09-25-0900  c..d  1 capability in 1 commit  [failed]\n  ERROR: remote rejected';
  const r = await alertForBuild({ gh, branch: 'studio', outcome: 'success', resultText: text, at: NOW });
  assert.equal(r.raised[0].key, 'build-studio');
  assert.match(gh.state.issues[0].body, /remote rejected/);
  const c = await alertForBuild({ gh: fakeGh(), branch: 'studio', outcome: 'cancelled', resultText: text });
  assert.equal(c.skipped, 'the run was cancelled');
  assert.deepEqual(c.raised, []);
});

// -------------------------------------------------------------------------------------------------------------------- CLI

test('the CLI commands map to the helpers and report usage errors with exit 2', async () => {
  const gh = fakeGh();
  const raised = await main(['raise', '--key', 'k', '--title', 'T', '--body', 'hello', '--severity', 'critical', '--lane', 'cockpit'], { gh, now: NOW });
  assert.equal(raised.code, 0);
  assert.match(raised.out, /created alert k #700/);
  assert.ok(gh.state.issues[0].body.includes('hello'));
  assert.match((await main(['raise', '--key', 'k', '--title', 'T'], { gh, now: NOW })).out, /commented alert k #700/);
  const st = await main(['status', '--json', '--paperclip', 'off'], { gh, now: NOW });
  assert.equal(JSON.parse(st.out).alerts.length, 1);
  assert.match((await main(['resolve', '--key', 'k', '--note', 'ok'], { gh, now: NOW })).out, /closed alert k #700/);
  assert.equal((await main(['raise'], { gh })).code, 2);
  assert.equal((await main(['nope'], { gh })).code, 2);
  assert.equal((await main(['raise', '--key'], { gh })).code, 2);
  assert.equal((await main(['status'], { gh: fakeGh({ failOn: () => true }), fetchImpl: fetchWith({}), now: NOW })).code, 0, 'unreadable sources are reported, not fatal');
  assert.equal((await main(['raise', '--key', 'k', '--title', 't'], { gh: fakeGh({ failOn: () => true }) })).code, 1);
  assert.deepEqual(parseArgs(['status', '--json']), { cmd: 'status', flags: { json: true } });
});

// -------------------------------------------------------------------------------------------------------------- workflows

const loadWorkflow = (name) => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
  return { text, doc: yaml.load(text) };
};

test('build-on-ready.yml: issues: write, an Alert step that is `if: always()` after the build step, and the tagging step unchanged', () => {
  const { text, doc } = loadWorkflow('build-on-ready.yml');
  assert.equal(doc.permissions.issues, 'write');
  assert.equal(doc.permissions.contents, 'write');
  const steps = doc.jobs.build.steps;
  const iTag = steps.findIndex((s) => s.name === 'Check, tag and push');
  const iAlert = steps.findIndex((s) => /alert\.mjs/.test(s.run || ''));
  assert.ok(iTag > -1 && iAlert > iTag, 'the alert step comes after the check, tag and push step');
  assert.equal(steps[iAlert].if, 'always()');
  assert.equal(steps[iAlert]['continue-on-error'], true, 'a broken alert step never turns a green build red');
  assert.match(steps[iAlert].run, /ci-build --branch "\$BRANCH" --outcome "\$JOB_STATUS" --result-file "\$RUNNER_TEMP\/result\.txt"/);
  assert.equal(steps[iAlert].env.JOB_STATUS, '${{ job.status }}');
  assert.equal(steps[iAlert].env.GH_TOKEN, '${{ github.token }}');
  // the tagging step is exactly what #639 shipped: same condition, same command, same exit code semantics
  assert.deepEqual(steps[iTag], {
    name: 'Check, tag and push',
    if: "steps.plan.outputs.any == 'true'",
    shell: 'bash',
    run: [
      'set +e',
      'node packages/tools/dev/build-on-ready.mjs --branch "$BRANCH" --push > "$RUNNER_TEMP/result.txt" 2>&1',
      'code=$?',
      'cat "$RUNNER_TEMP/result.txt"',
      '{',
      "  echo '### Build on ready'",
      "  echo '```'",
      '  cat "$RUNNER_TEMP/result.txt"',
      "  echo '```'",
      '} >> "$GITHUB_STEP_SUMMARY"',
      'exit $code # 3 = a lane was held by a failing check (the other lanes were still tagged)',
      '',
    ].join('\n'),
  });
  assert.deepEqual(doc.on, { push: { branches: ['work/2026-09-23', 'studio'] } });
  assertNoSecret(text);
});

test('pages.yml: the alert job is only for the work branch, needs build and deploy, is `if: always()`, and the rest is untouched', () => {
  const { text, doc } = loadWorkflow('pages.yml');
  const job = doc.jobs.alert;
  assert.match(job.if, /^always\(\) && github\.ref == 'refs\/heads\/work\/2026-09-23'$/);
  assert.deepEqual(job.needs, ['build', 'deploy']);
  assert.equal(job.permissions.issues, 'write');
  assert.equal(job.permissions.contents, 'read');
  const alertStep = job.steps.find((s) => /alert\.mjs/.test(s.run || ''));
  assert.match(alertStep.run, /key="docs-\$BRANCH"/);
  assert.match(alertStep.run, /alert\.mjs raise --key "\$key"/);
  assert.match(alertStep.run, /alert\.mjs resolve --key "\$key"/);
  assert.equal(alertStep['continue-on-error'], true);
  // the workflow-level token, triggers, and the two existing jobs are as before
  assert.deepEqual(doc.permissions, { contents: 'read', issues: 'read', pages: 'write', 'id-token': 'write' });
  assert.deepEqual(doc.on.push.branches, ['work/2026-09-23', 'main']);
  assert.equal(doc.on.schedule[0].cron, '17 */6 * * *');
  assert.equal(doc.jobs.build.if, "github.event_name != 'issues' || startsWith(github.event.issue.title, '[Demo')");
  assert.equal(doc.jobs.build.permissions, undefined);
  assert.equal(doc.jobs.deploy.permissions, undefined);
  assert.deepEqual(doc.jobs.deploy.needs, 'build');
  assertNoSecret(text);
});

function assertNoSecret(text) {
  assert.ok(!/gh[pousr]_[A-Za-z0-9]{8,}|github_pat_|AKIA[A-Z0-9]{8,}|\bsk-[A-Za-z0-9]{8,}/.test(text), 'a token-shaped literal');
  assert.ok(!/secrets\.(?!GITHUB_TOKEN)/.test(text), 'a secret other than the built-in token');
  for (const m of text.matchAll(/GH_TOKEN:\s*(.+)/g)) assert.equal(m[1].trim(), '${{ github.token }}');
}
