import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeSecret, readOpenProjectRequest } from './OpenProjectRequest.ts';
import { traceMatchFor, traceToolFor } from './OpenProjectScript.ts';
import { HELPER_OPTIONS, helperReply } from './OpenProjectChat.ts';
import { requestForAnswer, requestForOption } from './OpenProjectChatRequests.ts';
import { chatOptionProblems, chatMessageProblems } from '../../../lib/lineChat.ts';
import { LINE_CONTROLS } from '../../../../../packages/engine/line/controls.mjs';
import { assertTraceMatch } from '../../../../../packages/engine/line/contract.mjs';

const PROJECTS = ['line-sample', 'shop', 'notes'];
const read = (t) => readOpenProjectRequest(t, PROJECTS);
const lit = (t) => traceToolFor(read(t))?.controls.map((c) => `${c.controlId}${c.target ? `:${c.target}` : ''}`) ?? [];
const moves = (t) => traceToolFor(read(t))?.script.map((a) => `${a.kind} ${a.controlId}${a.value ? `=${a.value}` : ''}`) ?? [];

test('plain requests are read statically into what they ask for', () => {
  assert.deepEqual(read('start a shop called acme-store'), { kind: 'new', name: 'acme-store', framework: 'line' });
  assert.deepEqual(read('start a new shop project'), { kind: 'new', name: 'shop', framework: 'line' });
  assert.deepEqual(read('create a new React app named spa-1'), { kind: 'new', name: 'spa-1', framework: 'react-spa' });
  assert.deepEqual(read('new project'), { kind: 'new', name: null, framework: 'line' });
  assert.deepEqual(read('bring in my GitHub project octocat/Hello-World'), { kind: 'github', link: 'octocat/Hello-World' });
  assert.deepEqual(read('https://github.com/octocat/Hello-World'), { kind: 'github', link: 'https://github.com/octocat/Hello-World' });
  assert.deepEqual(read('open line-sample'), { kind: 'open', wanted: 'line-sample', project: 'line-sample' });
  assert.deepEqual(read('open the nothing-here project'), { kind: 'open', wanted: 'nothing-here', project: null });
  assert.deepEqual(read('what is a Line project?'), { kind: 'explain' });
  assert.deepEqual(read('show my projects'), { kind: 'list' });
  assert.deepEqual(read('hello'), { kind: 'unknown' });
});

test('request -> controls: a new Line project lights the New project tab, the name, Next, Line project, Next and Create', () => {
  assert.deepEqual(lit('start a shop called acme-store'), ['open-project.tabNew', 'open-project.name', 'open-project.nameNext', 'open-project.kind', 'open-project.kindNext', 'open-project.create']);
  assert.deepEqual(moves('start a shop called acme-store'), ['click open-project.tabNew', 'type open-project.name=acme-store', 'click open-project.nameNext', 'click open-project.kind', 'click open-project.kindNext', 'approve open-project.create']);
  // Without a name Auto only opens the tab, and says what it still needs in one sentence.
  const noName = traceToolFor(read('start a new project'));
  assert.deepEqual(noName.script.map((a) => a.controlId), ['open-project.tabNew']);
  assert.equal(noName.missing, 'What should we call it?');
});

test('request -> controls: From GitHub stops for the person at "Is it private?" and at Bring it in, and never touches a token', () => {
  assert.deepEqual(moves('bring in octocat/Hello-World'), ['click open-project.tabGithub', 'type open-project.link=octocat/Hello-World', 'click open-project.linkNext', 'approve open-project.private', 'click open-project.privateNext', 'approve open-project.bringIn']);
  for (const t of ['bring in octocat/Hello-World', 'start a shop called acme-store', 'open shop']) {
    for (const a of traceToolFor(read(t)).script) assert.doesNotMatch(`${a.controlId} ${a.value ?? ''}`, /token/i, t);
  }
});

test('request -> controls: opening a project is one card click (a read), with the project as the target', () => {
  assert.deepEqual(lit('open shop'), ['open-project.tabProjects', 'open-project.card:shop']);
  assert.equal(traceToolFor(read('open shop')).toolId, 'line.openProject');
  assert.equal(traceToolFor(read('open nope')).missing, 'There is no project called nope in your workspace.');
});

test('every lit control is a registered control of the open-project screen, and the match has the trace contract shape', () => {
  const ids = new Set(LINE_CONTROLS.filter((c) => c.screen === 'open-project').map((c) => c.controlId));
  for (const t of ['start a shop called acme-store', 'bring in octocat/Hello-World', 'open shop']) {
    for (const c of traceToolFor(read(t)).controls) assert.ok(ids.has(c.controlId), c.controlId);
    assertTraceMatch(traceMatchFor(t, read(t)));
  }
  assert.equal(traceMatchFor('what is a Line project?', read('what is a Line project?')), null);
});

test('a token is never read: anything that looks like one is refused, not echoed', () => {
  for (const t of ['my token is ghp_abcdefghijklmnopqrstuvwxyz012345', 'bring in o/r with github_pat_11ABCDEFG0123456789_abcdefghij']) {
    assert.equal(looksLikeSecret(t), true);
    assert.deepEqual(read(t), { kind: 'secret' });
    const reply = helperReply(read(t), PROJECTS);
    assert.equal(reply.tone, 'refusal');
    assert.doesNotMatch(reply.text, /ghp_|github_pat_/);
    assert.equal(traceToolFor(read(t)), null);
  }
});

test('the chat answers in full sentences, with stable option ids and project cards to pick', () => {
  assert.deepEqual(chatOptionProblems(HELPER_OPTIONS), []);
  for (const t of ['start a shop called acme-store', 'start a new project', 'bring in o/r', 'open shop', 'open nope', 'show my projects', 'what is a Line project?', 'hello']) {
    const r = helperReply(read(t), PROJECTS);
    assert.deepEqual(chatMessageProblems({ id: 'm', from: 'line', text: r.text, pick: r.pick }), [], t);
  }
  assert.equal(helperReply(read('show my projects'), PROJECTS).text, 'Here are your projects: <ProjectCard name="line-sample"/> <ProjectCard name="shop"/> <ProjectCard name="notes"/> One click opens one.');
  assert.deepEqual(helperReply(read('open nope'), PROJECTS).pick.items.map((i) => [i.id, i.control]), PROJECTS.map((p) => [p, 'open-project.card']));
  assert.equal(helperReply(read('start a new project'), PROJECTS).ask.id, 'open-project.name');
  assert.equal(requestForOption('open-project.github'), 'bring in from GitHub');
  assert.deepEqual(read(requestForAnswer('open-project.name', 'acme-store')), { kind: 'new', name: 'acme-store', framework: 'line' });
  assert.deepEqual(read(requestForAnswer('open-project.link', 'octocat/Hello-World')), { kind: 'github', link: 'octocat/Hello-World' });
});
