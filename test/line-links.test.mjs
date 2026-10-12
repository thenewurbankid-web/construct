// cu1 -- each linked Line module loads through the link from its own repo and answers one real call. Skipped (with the
// link step's own sentence) when the source repo is not on this machine or not at the pinned commit; the fallback for
// that case is test/line-links-fallback.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import path from 'node:path';
import { importLinked, linkStatus, readLinks } from '../packages/line-links/index.mjs';
import { createDecider } from '../packages/core/line-decide.mjs';
import { profilesWithOn } from '../packages/core/line-decide-mock.mjs';
import { ARGV_SCHEMA } from '../packages/core/plan-registry.mjs';

const status = linkStatus();
const skip = status.ok ? false : status.message;

test('link status: every package in links.json is ready at the pinned commit', { skip }, () => {
  assert.equal(status.head, readLinks().source.commit);
  assert.deepEqual(status.packages.map((p) => [p.name, p.state]), Object.keys(readLinks().links).map((n) => [n, 'ok']));
  assert.match(status.message, /^All 6 Line links are ready/);
});

test('@mx/reason: loads through the link, fits the contract, and decides a pick with no model (static path)', { skip }, async () => {
  const r = await importLinked('@mx/reason');
  assert.equal(r.ok, true, r.reason);
  assert.equal(typeof r.module.runLadder, 'function');
  assert.equal(typeof r.module.defineProfiles, 'function');
  const { decide } = createDecider({ jev: 'off', profiles: profilesWithOn(['construct.chooser']) });
  const one = await decide('construct.chooser', [{ id: 'a', enabled: false }, { id: 'b', enabled: true }], { question: 'Next?' });
  assert.deepEqual([one.choice, one.by, one.reasons[0]], ['b', 'single', 'It is the only option that passed the checks.']);
  const two = await decide('construct.chooser', ['a', 'b'], { question: 'Next?' });
  assert.deepEqual([two.choice, two.runnerUp, two.via, two.attribution.provider], ['a', 'b', 'static', '@mx/reason'], 'reason ran its ladder; the picker is off so the static order stands');
});

test('@mx/plan: create a plan, add a step and read its status, stored in a temp dir', { skip }, async (t) => {
  const r = await importLinked('@mx/plan');
  assert.equal(r.ok, true, r.reason);
  const viaName = await import('@mx/plan');
  assert.equal(viaName.createPlanApi, r.module.createPlanApi, '@mx/plan resolves by name once linked');
  const root = makeTempDir('cu1-plan-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = { list: () => [{ name: 'demo.read', kind: 'read', schema: ARGV_SCHEMA, describe: 'Reads nothing.' }], call: async () => ({ read: true }) };
  const api = r.module.createPlanApi({ registry, writer: r.module.createFileWriter(root) });
  const created = await api.plan_create({ goal: 'Check the demo.', by: 'user' });
  assert.equal(created.ok, true, created.reason);
  const added = await api.plan_add_step({ planId: created.plan.id, version: created.plan.version, by: 'agent', step: { tool: 'demo.read', args: {}, why: 'Read the demo once.' } });
  assert.equal(added.ok, true, added.reason);
  const st = await api.plan_status({ planId: created.plan.id });
  assert.equal(st.ok, true);
  assert.equal(st.state.next, added.plan.steps[0].id);
  assert.equal(st.state.counts.planned, 1);
  assert.ok(fs.existsSync(path.join(root, 'line', 'plans', `${created.plan.sessionId}.json`)));
});

test('@mx/gatelm: one static check refuses a lower-case component name with a sentence', { skip }, async () => {
  const r = await importLinked('@mx/gatelm');
  assert.equal(r.ok, true, r.reason);
  const why = r.module.checkProposal({ code: '', gaps: [] }, { id: 'g1', kind: 'name', family: 'VIEW' }, 'button', { props: '', components: [] });
  assert.equal(why, '"button" is not a component name; component names start with a capital letter.');
  assert.equal(r.module.checkProposal({ code: '', gaps: [] }, { id: 'g1', kind: 'name', family: 'VIEW' }, 'a; b', { props: '', components: [] }), '"a; b" is code or too long; give one short value only.');
});

test('Morpheus render: renders one small page to a themed HTML document', { skip }, async (t) => {
  const r = await importLinked('@mx/morpheus-render');
  assert.equal(r.ok, true, r.reason);
  const scratch = makeTempDir('cu1-render-');
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const html = await r.module.renderPage('export default function Page() { return <main className="p-4"><h1>Hello Line</h1></main>; }', { libraryDir: path.join(scratch, 'no-library'), scratch, title: 'Smoke' });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Smoke<\/title>/);
  assert.match(html, /<main class="p-4"><h1>Hello Line<\/h1><\/main>/);
  assert.match(html, /\.p-4\s*\{/, 'the theme CSS for the used class is inlined');
  assert.deepEqual(fs.readdirSync(scratch), [], 'the render folder is removed afterwards');
});
