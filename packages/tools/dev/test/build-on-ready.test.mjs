// #639 -- build-on-ready.mjs: what counts as a capability (per lane, from the real lanes.json), the build plan, tag naming and
// collisions, the JSON tag message, the first-run baseline, idempotency, a held lane not blocking the others, and the studio
// branch, the last ones against a real temporary git repository with a real bare remote.
//
//   node --test packages/tools/dev/test/build-on-ready.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import {
  classifyCommit, globToRegExp, issuesOf, loadConfig, newestTag, parseTagMessage, parseTagName, planBaselines, planBuilds, run, stamp, tagMessage, tagName,
} from '../build-on-ready.mjs';

const config = loadConfig();
const verdict = (subject, files, lanes) => classifyCommit({ subject, files }, config, lanes ? { lanes } : {});

// ------------------------------------------------------------------------------------------------ classifier, per lane

test('lanes.json is data only: every lane has globs, a tag prefix and a check with a timeout', () => {
  assert.deepEqual(Object.keys(config.lanes), ['construct', 'guardrails', 'cockpit', 'site', 'design', 'adhoc']);
  for (const [name, lane] of Object.entries(config.lanes)) {
    assert.ok(lane.userFacing.length, name);
    assert.ok(lane.tagPrefix.startsWith(`${name}/`), name);
    assert.ok(Array.isArray(lane.check) && lane.check.length, name);
    for (const c of lane.check) assert.ok(c.cmd && c.timeoutSec > 0 && Array.isArray(c.args), `${name}: ${c.name}`);
  }
  assert.deepEqual(config.branches.studio, ['adhoc']);
  assert.equal(JSON.stringify(config).includes('function'), false);
});

test('glob: ** crosses directories (and may match none), * stays in one, {a,b} alternates', () => {
  assert.ok(globToRegExp('packages/{core,cli}/**/*.mjs').test('packages/core/a.mjs'));
  assert.ok(globToRegExp('packages/{core,cli}/**/*.mjs').test('packages/cli/x/y/z.mjs'));
  assert.ok(!globToRegExp('packages/{core,cli}/**/*.mjs').test('packages/ast/a.mjs'));
  assert.ok(globToRegExp('**/test/**').test('test/a.mjs'));
  assert.ok(!globToRegExp('ui/*.js').test('ui/a/b.js'));
  assert.ok(globToRegExp('site/build.mjs').test('site/build.mjs'));
  assert.ok(!globToRegExp('site/build.mjs').test('site/buildXmjs'));
});

test('construct lane: CLI, core, engine, ast and schemas are user-facing; their tests are not', () => {
  assert.deepEqual(verdict('[#600] Import: ask for the route folder', ['packages/core/import.mjs']).lanes, ['construct']);
  assert.deepEqual(verdict('Add a rule', ['packages/cli/construct.mjs', 'test/rule.test.mjs']).lanes, ['construct']);
  assert.deepEqual(verdict('plan schema gains ext', ['schemas/plan.v1.json']).lanes, ['construct']);
  const t = verdict('More coverage for the planner', ['test/planner.test.mjs', 'packages/core/planner.test.mjs']);
  assert.equal(t.capability, false);
  assert.match(t.reason, /ignored paths/);
});

test('cockpit lane: a screen or an API is user-facing; specs, unit tests and e2e are not', () => {
  assert.deepEqual(verdict('Notes screen', ['ui/client/features/notes/components/NotesScreen.tsx']).lanes, ['cockpit']);
  assert.deepEqual(verdict('POST /api/notes', ['ui/server/src/notesApi.mjs', 'ui/server/src/notesApi.test.mjs']).lanes, ['cockpit']);
  assert.equal(verdict('pin the notes spec', ['ui/e2e/tests/notes.spec.js']).capability, false);
  assert.equal(verdict('unit spec', ['ui/client/features/notes/domain/notes.spec.mjs', 'ui/server/src/notesApi.test.mjs']).capability, false);
});

test('site lane: pages, assets and the docs generator; not the site tests', () => {
  assert.deepEqual(verdict('docs: re-verify the import guide', ['site/content/user/import.md']).lanes, ['site']);
  assert.deepEqual(verdict('docs generator', ['packages/docs-site/lib/pages.mjs']).lanes, ['site']);
  assert.deepEqual(verdict('a screenshot', ['site/assets/img/notes.png']).lanes, ['site']);
  assert.equal(verdict('site test', ['site/test/site.test.mjs']).capability, false);
});

test('design lane: docs/design counts, other docs do not', () => {
  assert.deepEqual(verdict('Design: popover spec', ['docs/design/popovers.md']).lanes, ['design']);
  assert.equal(verdict('docs: delegation mechanics', ['docs/DELEGATION.md']).capability, false);
  assert.equal(verdict('docs: versioning', ['docs/VERSIONING.md']).reason, 'no user-facing path of any lane');
});

test('adhoc lane: Studio source and bin count, its scripts and tests do not', () => {
  assert.deepEqual(verdict('Studio editor: trim', ['packages/studio/src/editor/ops.mjs']).lanes, ['adhoc']);
  assert.deepEqual(verdict('Studio: doctor', ['packages/studio/bin/doctor.mjs']).lanes, ['adhoc']);
  assert.equal(verdict('pack script', ['packages/studio/scripts/pack.mjs']).capability, false);
  assert.equal(verdict('studio test', ['packages/studio/test/editor-ops.test.mjs']).capability, false);
});

test('one commit can be a capability for several lanes', () => {
  const v = verdict('[#599] Import Wizard streams output', ['packages/core/import.mjs', 'ui/client/features/import/View.tsx', 'site/content/user/import.md']);
  assert.deepEqual(v.lanes, ['construct', 'cockpit', 'site']);
  assert.equal(v.capability, true);
});

test('not capabilities: CI, board, changelog, lockfile-only, internal docs, empty (merge) commits', () => {
  assert.equal(verdict('ci: cache npm', ['.github/workflows/pages.yml']).capability, false);
  assert.equal(verdict('board: add a module', ['docs/PROJECT_BOARD.md', 'packages/tools/project-board/sync.mjs']).capability, false);
  assert.equal(verdict('Changelog', ['CHANGELOG.md']).capability, false);
  assert.equal(verdict('bump', ['package-lock.json', 'ui/server/package-lock.json']).capability, false);
  assert.equal(verdict('docs: how to delegate', ['docs/DELEGATION.md']).capability, false);
  assert.equal(verdict('Merge pull request #12 from x/y', []).capability, false);
});

test('not capabilities: a refactor, test, chore, style or release subject wins over the paths it touches', () => {
  const files = ['packages/core/import.mjs', 'ui/client/features/x/View.tsx'];
  for (const subject of ['refactor: split import', '[#598] refactor(ui): polling', 'chore: deps', 'test: more cases', 'ci: node 22', 'style: format', 'release: v0.10.0', 'e2e: fix path', '[#598] clone: move the polling loops into services/ClonePolling', 'Formatting only']) {
    const v = verdict(subject, files);
    assert.equal(v.capability, false, subject);
    assert.match(v.reason, /ignore rule/, subject);
  }
});

test('an issue reference raises confidence but is never required', () => {
  const files = ['ui/client/features/notes/View.tsx'];
  const withRef = verdict('[#596] Notes screen', files);
  const without = verdict('Notes screen', files);
  assert.equal(withRef.capability, true);
  assert.equal(without.capability, true);
  assert.equal(withRef.confidence, 'high');
  assert.equal(without.confidence, 'medium');
  assert.deepEqual(withRef.issues, [596]);
  assert.deepEqual(issuesOf('[#12] [#7] fix (#9) and [#7]'), [7, 9, 12]);
  // a reference does not rescue a refactor
  assert.equal(verdict('[#598] refactor: polling', files).capability, false);
});

test('classification is deterministic', () => {
  const c = { subject: '[#1] x', files: ['ui/server/src/a.mjs', 'site/content/a.md'] };
  assert.equal(JSON.stringify(classifyCommit(c, config)), JSON.stringify(classifyCommit(c, config)));
});

// -------------------------------------------------------------------------------------------------------- planBuilds

const commit = (sha, subject, files, parents) => ({ sha, subject, files, ...(parents ? { parents } : {}) });

test('planBuilds: several lanes, each from its own last tag; non-capability commits ride along', () => {
  const commits = [
    commit('c1', '[#1] Notes screen', ['ui/client/features/notes/View.tsx']),
    commit('c2', 'refactor: rename', ['packages/core/a.mjs']),
    commit('c3', '[#2] docs: notes guide', ['site/content/user/notes.md']),
    commit('c4', 'ci: cache', ['.github/workflows/x.yml']),
    commit('c5', '[#3] Import wizard', ['packages/core/import.mjs', 'ui/server/src/importApi.mjs']),
  ];
  const lastTags = {
    construct: { name: 'construct/build-baseline', sha: 'c1' }, // built up to c1
    cockpit: { name: 'cockpit/build-baseline', sha: 'c3' }, // built up to c3
    site: { name: 'site/build-baseline', sha: 'c3' },
    design: { name: 'design/pack-baseline', sha: 'c1' },
  };
  const plan = planBuilds({ commits, lastTags, config, lanes: ['construct', 'cockpit', 'site', 'design'] });
  assert.deepEqual(plan.map((p) => p.lane), ['construct', 'cockpit']);
  const construct = plan[0];
  assert.deepEqual(construct.capabilities.map((c) => c.sha), ['c5']); // c2 is a refactor
  assert.equal(construct.commits, 4); // c2..c5 ride along
  assert.equal(construct.from, 'c1');
  assert.equal(construct.to, 'c5');
  assert.deepEqual(construct.capabilities[0].issues, [3]);
  assert.deepEqual(plan[1].capabilities.map((c) => c.sha), ['c5']);
  assert.equal(planBuilds({ commits, lastTags: { ...lastTags, cockpit: { name: 'x', sha: 'c5' } }, config, lanes: ['cockpit'] }).length, 0);
});

test('planBuilds follows the real graph: a side branch merged after the tag still counts', () => {
  const commits = [
    commit('side', '[#4] Cockpit fix', ['ui/server/src/a.mjs'], ['base']), // authored before the tag commit, merged after it
    commit('tagged', 'x', [], ['base']),
    commit('merge', 'Merge pull request #4', [], ['tagged', 'side']),
  ];
  const plan = planBuilds({ commits, lastTags: { cockpit: { name: 't', sha: 'tagged' } }, config, lanes: ['cockpit'], tip: 'merge' });
  assert.deepEqual(plan[0].capabilities.map((c) => c.sha), ['side']);
  assert.equal(plan[0].to, 'merge');
});

test('planBuilds does not plan a lane with no tag; planBaselines does', () => {
  const lastTags = { construct: null, cockpit: { name: 't', sha: 'a' } };
  assert.deepEqual(planBuilds({ commits: [commit('b', 'x', ['packages/core/a.mjs'])], lastTags, config, lanes: ['construct'] }), []);
  assert.deepEqual(planBaselines({ lastTags, tip: 'tip1', config, lanes: ['construct', 'cockpit', 'design'] }), [
    { lane: 'construct', tag: 'construct/build-baseline', to: 'tip1' },
    { lane: 'design', tag: 'design/pack-baseline', to: 'tip1' },
  ]);
});

// ------------------------------------------------------------------------------------------------------------ tag names

test('tag names: <lane>/build-YYYY-MM-DD-HHMM in UTC, design/pack-...; a same-minute collision appends -2, -3', () => {
  const d = new Date('2026-09-24T07:05:59Z');
  assert.equal(stamp(d), '2026-09-24-0705');
  assert.equal(tagName('cockpit/build-', d), 'cockpit/build-2026-09-24-0705');
  assert.equal(tagName('design/pack-', d), 'design/pack-2026-09-24-0705');
  assert.equal(tagName('cockpit/build-', d, ['cockpit/build-2026-09-24-0705']), 'cockpit/build-2026-09-24-0705-2');
  assert.equal(tagName('cockpit/build-', d, ['cockpit/build-2026-09-24-0705', 'cockpit/build-2026-09-24-0705-2']), 'cockpit/build-2026-09-24-0705-3');
  assert.equal(tagName('cockpit/build-', new Date('2026-09-24T23:59:00-05:00')), 'cockpit/build-2026-09-25-0459'); // UTC, not local
});

test('new tag names cannot match the release workflow (v*.*.*)', () => {
  const pages = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../.github/workflows/pages.yml'), 'utf8');
  assert.match(pages, /tags: \['v\*\.\*\.\*'\]/);
  for (const n of ['construct/build-2026-09-24-0705', 'design/pack-2026-09-24-0705-2', 'adhoc/build-baseline']) assert.equal(n.startsWith('v'), false);
});

test('the workflow is valid YAML with the guardrails: contents: write only, queue per branch, work and studio pushes, no tag trigger', async () => {
  const { default: yaml } = await import('js-yaml');
  const file = path.resolve(import.meta.dirname, '../../../../', ['.', 'github'].join(''), 'workflows', 'build-on-ready.yml');
  const wf = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(wf.on.push.branches, ['work/2026-09-23', 'studio']);
  assert.equal(wf.on.push.tags, undefined);
  assert.deepEqual(wf.permissions, { contents: 'write' });
  assert.match(wf.concurrency.group, /\$\{\{ github\.ref \}\}/);
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  const steps = wf.jobs.build.steps;
  assert.equal(steps.find((s) => s.uses?.startsWith('actions/checkout'))?.with['fetch-depth'], 0);
  assert.equal(String(steps.find((s) => s.uses?.startsWith('actions/setup-node')).with['node-version']), '22');
  assert.ok(steps.some((s) => /build-on-ready\.mjs .*--push/.test(s.run || '')));
  assert.equal(steps.filter((s) => /ui\/client/.test(s.run || '') && /npm (ci|install)/.test(s.run || '')).length, 0, 'ui/client is never installed');
  assert.deepEqual(config.branches['work/2026-09-23'].concat(config.branches.studio).sort(), Object.keys(config.lanes).sort());
});

test('parseTagName reads new, suffixed, baseline and older day-only names; newestTag orders them', () => {
  assert.deepEqual(parseTagName('cockpit/build-2026-09-24-1930'), { lane: 'cockpit', kind: 'build', date: '2026-09-24', time: '1930', n: 1, sort: '2026-09-24-1930-0001' });
  assert.equal(parseTagName('cockpit/build-2026-09-24-1930-12').n, 12);
  assert.equal(parseTagName('design/pack-2026-09-24-0001').lane, 'design');
  assert.equal(parseTagName('site/build-baseline').kind, 'baseline');
  assert.equal(parseTagName('site/build-2026-09-24').date, '2026-09-24');
  assert.equal(parseTagName('v0.9.0'), null);
  assert.equal(parseTagName('cockpit/pack-2026-09-24-1930'), null);
  assert.equal(newestTag(['site/build-baseline', 'site/build-2026-09-24-0900', 'site/build-2026-09-24-0900-2', 'site/build-2026-09-23-2359']), 'site/build-2026-09-24-0900-2');
  assert.equal(newestTag(['site/build-baseline']), 'site/build-baseline');
  assert.equal(newestTag([]), null);
});

test('the tag message is JSON and round-trips: lane, range, capability subjects, issues', () => {
  const built = new Date('2026-09-24T19:30:00Z');
  const text = tagMessage({
    lane: 'cockpit', branch: 'work/2026-09-23', from: 'a'.repeat(40), to: 'b'.repeat(40), builtAt: built, commits: 5,
    capabilities: [{ sha: 'c'.repeat(40), subject: '[#596] Notes screen: "quotes", tabs\tand ünïcode', issues: [596] }, { sha: 'd'.repeat(40), subject: 'Plain', issues: [] }],
    checks: [{ name: 'cockpit server tests', ms: 1234, ok: true }],
  });
  const doc = JSON.parse(text);
  assert.equal(doc.lane, 'cockpit');
  assert.equal(doc.range, `${'a'.repeat(9)}..${'b'.repeat(9)}`);
  assert.equal(doc.builtAt, '2026-09-24T19:30:00.000Z');
  assert.deepEqual(doc.issues, [596]);
  assert.equal(doc.commits, 5);
  assert.deepEqual(parseTagMessage(text), doc);
  assert.equal(parseTagMessage(text).capabilities[0].subject, '[#596] Notes screen: "quotes", tabs\tand ünïcode');
  assert.equal(parseTagMessage('Build of the site, 2026-09-24'), null); // an older free-text tag
  assert.equal(parseTagMessage(''), null);
  assert.equal(parseTagMessage('{"schema":"other"}'), null);
});

// ------------------------------------------------------------------------- against a real repository and a real remote

const NODE = process.execPath;
const ok = { name: 'ok', cmd: NODE, args: ['-e', 'process.exit(0)'], cwd: '.', timeoutSec: 30 };
const red = { name: 'red', cmd: NODE, args: ['-e', 'console.log("line one\\nassertion failed: nope"); process.exit(1)'], cwd: '.', timeoutSec: 30 };
const slow = { name: 'slow', cmd: NODE, args: ['-e', 'setTimeout(() => {}, 20000)'], cwd: '.', timeoutSec: 1 };
const miniConfig = (checks = {}) => ({
  version: 1,
  branches: { main: ['construct', 'cockpit', 'design'], studio: ['adhoc'] },
  ignore: ['**/*.test.*'],
  ignoreSubjects: ['^(chore|refactor)[:!]'],
  lanes: {
    construct: { tagPrefix: 'construct/build-', userFacing: ['core/**'], ignore: [], ignoreSubjects: [], install: ['.'], check: [checks.construct || ok] },
    cockpit: { tagPrefix: 'cockpit/build-', userFacing: ['ui/**'], ignore: [], ignoreSubjects: [], install: ['.', 'ui/server'], check: [checks.cockpit || ok] },
    design: { tagPrefix: 'design/pack-', userFacing: ['design/**'], ignore: [], ignoreSubjects: [], install: [], check: [checks.design || ok] },
    adhoc: { tagPrefix: 'adhoc/build-', userFacing: ['studio/**'], ignore: [], ignoreSubjects: [], install: ['.'], check: [checks.adhoc || ok] },
  },
});

function sh(cwd, ...args) {
  return shEnv(cwd, {}, ...args);
}
function shEnv(cwd, env, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env } }).trim();
}

function repo() {
  const base = makeTempDir('build-on-ready-');
  const remote = path.join(base, 'remote.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(remote);
  sh(remote, 'init', '--bare', '-q', '--initial-branch=main');
  fs.mkdirSync(work);
  sh(work, 'init', '-q', '--initial-branch=main');
  sh(work, 'config', 'user.name', 't');
  sh(work, 'config', 'user.email', 't@t');
  sh(work, 'remote', 'add', 'origin', remote);
  let n = 0;
  let days = 0;
  const commit = (subject, ...files) => {
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }); fs.writeFileSync(path.join(work, f), `${f} ${++n}\n`); }
    sh(work, 'add', '-A');
    const date = `2026-09-${String(20 + days++).padStart(2, '0')}T12:00:00Z`; // one commit per day, so --since can cut between them
    shEnv(work, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, 'commit', '-q', '-m', subject);
    return sh(work, 'rev-parse', 'HEAD');
  };
  const tags = () => sh(remote, 'tag', '--list').split('\n').filter(Boolean).sort();
  return { work, remote, commit, tags };
}
const at = (iso) => new Date(iso);

test('first run: every lane gets a baseline tag at the tip, and it is not a build', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  const tip = r.commit('[#1] a capability that predates the baseline', 'core/a.mjs');
  const res = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  assert.deepEqual(res.baselines.map((b) => [b.tag, b.status]), [['construct/build-baseline', 'created'], ['cockpit/build-baseline', 'created'], ['design/pack-baseline', 'created']]);
  assert.deepEqual(res.builds, []);
  assert.deepEqual(r.tags(), ['cockpit/build-baseline', 'construct/build-baseline', 'design/pack-baseline']);
  assert.equal(sh(r.remote, 'rev-list', '-n1', 'construct/build-baseline'), tip);
  assert.equal(parseTagMessage(sh(r.remote, 'tag', '-l', '--format=%(contents)', 'construct/build-baseline')).kind, 'baseline');
});

test('a dry run (the default) creates nothing and runs no check', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  r.commit('[#2] a change', 'core/b.mjs');
  const res = await run({ root: r.work, branch: 'main', config: miniConfig({ construct: red }), now: at('2026-09-24T10:05:00Z') });
  assert.equal(res.dryRun, true);
  assert.deepEqual(res.builds.map((b) => [b.lane, b.status, b.check]), [['construct', 'planned', null]]);
  assert.equal(r.tags().length, 3);
  assert.equal(sh(r.work, 'tag', '--list').split('\n').length, 3);
});

test('a capability builds its lane only, tags with a JSON message, and re-running does nothing (idempotent)', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  r.commit('chore: tidy', 'core/x.test.mjs');
  const cap = r.commit('[#7] Notes screen', 'ui/notes.tsx');
  r.commit('refactor: inner', 'core/inner.mjs');
  const first = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T11:30:10Z') });
  assert.deepEqual(first.builds.map((b) => [b.lane, b.tag, b.status]), [['cockpit', 'cockpit/build-2026-09-24-1130', 'built']]);
  assert.deepEqual(first.baselines, []);
  assert.ok(r.tags().includes('cockpit/build-2026-09-24-1130'));
  assert.equal(r.tags().includes('construct/build-2026-09-24-1130'), false, 'the refactor and the test change did not build construct');
  const doc = parseTagMessage(sh(r.remote, 'tag', '-l', '--format=%(contents)', 'cockpit/build-2026-09-24-1130'));
  assert.equal(doc.lane, 'cockpit');
  assert.deepEqual(doc.capabilities.map((c) => [c.sha, c.subject, c.issues]), [[cap, '[#7] Notes screen', [7]]]);
  assert.deepEqual(doc.issues, [7]);
  assert.equal(doc.commits, 3);
  assert.equal(doc.checks[0].name, 'ok');
  // again: same commits, same minute or later, nothing new
  const again = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T11:30:40Z') });
  assert.deepEqual(again.builds, []);
  const later = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T15:00:00Z') });
  assert.deepEqual(later.builds, []);
  assert.equal(r.tags().length, 4);
});

test('two builds of one lane in the same minute: the second is -2', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  r.commit('[#8] one', 'ui/a.tsx');
  const a = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T12:00:05Z') });
  r.commit('[#9] two', 'ui/b.tsx');
  const b = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T12:00:50Z') });
  r.commit('[#10] three', 'ui/c.tsx');
  const c = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T12:00:59Z') });
  assert.deepEqual([a, b, c].map((x) => x.builds[0].tag), ['cockpit/build-2026-09-24-1200', 'cockpit/build-2026-09-24-1200-2', 'cockpit/build-2026-09-24-1200-3']);
  assert.deepEqual(b.builds[0].capabilities.map((x) => x.subject), ['[#9] two']); // only what is new since the previous build
});

test('a lane whose check fails is held (output tail, no tag); the other lanes are built anyway', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  r.commit('[#11] core and ui together', 'core/a.mjs', 'ui/a.tsx');
  const res = await run({ root: r.work, branch: 'main', config: miniConfig({ construct: red }), push: true, now: at('2026-09-24T13:00:00Z') });
  const by = Object.fromEntries(res.builds.map((b) => [b.lane, b]));
  assert.equal(by.construct.status, 'held');
  assert.equal(by.cockpit.status, 'built');
  assert.deepEqual(res.held, ['construct']);
  assert.match(by.construct.check.results[0].tail, /assertion failed: nope/);
  assert.equal(r.tags().includes('construct/build-2026-09-24-1300'), false);
  assert.ok(r.tags().includes('cockpit/build-2026-09-24-1300'));
  // the held lane keeps its commits: the next push retries them, now green
  const retry = await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T13:10:00Z') });
  assert.deepEqual(retry.builds.map((b) => [b.lane, b.status]), [['construct', 'built']]);
  assert.equal(retry.builds[0].capabilities[0].subject, '[#11] core and ui together');
});

test('a check that times out is held with a timeout note', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  r.commit('[#12] core', 'core/a.mjs');
  const res = await run({ root: r.work, branch: 'main', config: miniConfig({ construct: slow }), push: true, now: at('2026-09-24T13:00:00Z') });
  assert.equal(res.builds[0].status, 'held');
  assert.match(res.builds[0].check.results[0].tail, /timed out after 1s/);
});

test('the studio branch maps to the adhoc lane only, whatever else the commit touches', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  sh(r.work, 'checkout', '-q', '-b', 'studio');
  const res0 = await run({ root: r.work, branch: 'studio', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  assert.deepEqual(res0.baselines.map((b) => b.tag), ['adhoc/build-baseline']);
  r.commit('[#637] Studio editor plus a core change', 'studio/editor.mjs', 'core/a.mjs', 'ui/a.tsx');
  const res = await run({ root: r.work, branch: 'studio', config: miniConfig(), push: true, now: at('2026-09-24T14:00:00Z') });
  assert.deepEqual(res.builds.map((b) => b.lane), ['adhoc']);
  assert.deepEqual(res.lanes, ['adhoc']);
  await assert.rejects(run({ root: r.work, branch: 'nowhere', config: miniConfig() }), /not in lanes.json/);
});

test('--since simulates a dry run for lanes with no tag yet, and refuses to combine with a push', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  const res = await run({ root: r.work, branch: 'main', config: miniConfig(), since: '2026-09-21', now: at('2026-09-24T10:00:00Z') });
  assert.equal(res.baselines.length, 0);
  assert.equal(res.builds.length, 0);
  r.commit('[#13] core', 'core/a.mjs');
  const sim = await run({ root: r.work, branch: 'main', config: miniConfig(), since: '2026-09-21' });
  assert.deepEqual(sim.builds.map((b) => b.lane), ['construct']);
  assert.equal(r.tags().length, 0);
  await assert.rejects(run({ root: r.work, branch: 'main', config: miniConfig(), since: '2026-09-21', push: true }), /cannot be combined/);
});

test('the result names the installs the building lanes need, and nothing else', async () => {
  const r = repo();
  r.commit('start', 'README.md');
  await run({ root: r.work, branch: 'main', config: miniConfig(), push: true, now: at('2026-09-24T10:00:00Z') });
  r.commit('[#14] a design page', 'design/spec.md');
  assert.deepEqual((await run({ root: r.work, branch: 'main', config: miniConfig() })).install, []);
  r.commit('[#15] a cockpit screen', 'ui/a.tsx');
  assert.deepEqual((await run({ root: r.work, branch: 'main', config: miniConfig() })).install, ['.', 'ui/server']);
});
