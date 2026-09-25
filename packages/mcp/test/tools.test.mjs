// #649 -- the tool list, the schema of each tool, and each tool run for real on a `construct init` project through the SDK's
// in-process client. What a tool must NOT do (write, leave the root, leak) is packages/mcp/test/safety.test.mjs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { parseRequirement } from '../../core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../../core/placement.mjs';
import { recordChoices } from '../../core/decision-trace-store.mjs';
import { LIMITS } from '../src/limits.mjs';
import { TOOLS } from '../src/server.mjs';
import { makeProject, connectInProcess, callTool, hashTree } from '../test-utils/harness.mjs';

const NAMES = ['requirement_parse', 'placement_place', 'plan_validate', 'decide', 'summarize', 'validate', 'machine_capabilities', 'traces_stats'];
const SENTENCE = 'A user wants to see a list of products';

const stateDir = makeTempDir('construct-mcp-state-');
process.env.CONSTRUCT_STATE_DIR = stateDir;
delete process.env.CONSTRUCT_DECISION_PLUGINS;

let root;
let session;
before(async () => {
  root = makeProject({ files: { 'features/billing/domain/Invoice.domain.ts': 'export type Invoice = { id: string };\n' } });
  session = await connectInProcess({ root }, 'claude-code');
});
after(async () => {
  await session.close();
});
const call = (name, args) => callTool(session.client, name, args);

test('the tool list is exactly the eight read-only tools, each with a JSON schema and no path argument', async () => {
  const { tools } = await session.client.listTools();
  assert.deepEqual(tools.map((t) => t.name), NAMES);
  assert.deepEqual(TOOLS.map((t) => t.name), NAMES);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(tool.description.length > 40 && tool.description.length < 600, `${tool.name} has a description a model can decide on`);
    assert.deepEqual([tool.annotations.readOnlyHint, tool.annotations.destructiveHint, tool.annotations.openWorldHint], [true, false, false], `${tool.name} is annotated read-only`);
    for (const key of Object.keys(tool.inputSchema.properties ?? {})) assert.doesNotMatch(key, /^(root|projectRoot|project_root|path|dir|directory|file|cwd)$/i, `${tool.name} takes no path: ${key}`);
  }
});

test('input schemas name their required fields and their bounds', async () => {
  const { tools } = await session.client.listTools();
  const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
  assert.deepEqual(by.requirement_parse.required, ['text']);
  assert.equal(by.requirement_parse.properties.text.maxLength, LIMITS.textChars);
  assert.deepEqual(by.placement_place.required, ['text']);
  assert.equal(by.placement_place.properties.answers.maxItems, LIMITS.answers);
  assert.deepEqual(by.plan_validate.required, ['plan']);
  assert.equal(by.validate.properties.limit.maximum, LIMITS.findings);
  assert.deepEqual(by.machine_capabilities.properties ?? {}, {});
  assert.equal(by.decide.properties.summary.properties.options.maxItems, 5);
});

test('requirement_parse: a sentence becomes a card summary, an unknown word a closed question', async () => {
  const ok = await call('requirement_parse', { text: SENTENCE });
  assert.equal(ok.isError, false);
  assert.deepEqual([ok.body.ok, ok.body.complete, ok.body.questions], [true, true, []]);
  assert.equal(ok.body.card.version, 'requirement-card.v1');
  assert.deepEqual(ok.body.card.counts, { nouns: 2, verbs: 1, checks: 0, open: 0 });
  assert.equal(ok.body.card.readBack.length, 3);

  const open = await call('requirement_parse', { text: 'A user can frobnicate the widget' });
  assert.equal(open.body.complete, false);
  assert.ok(open.body.questions.length >= 1);
  const q = open.body.questions[0];
  assert.match(q.id, /^o\d+$/);
  assert.equal(q.source, 'card');
  assert.ok(q.options.length >= 2 && q.options.length <= 5, 'a chooser-shaped question: 2 to 5 options');
  assert.deepEqual(Object.keys(q.options[0]).sort(), ['enabled', 'id', 'label', 'why']);
});

test('placement_place: blocks, offers and a plan preview with the files each step touches, proof and wiring', async () => {
  const first = await call('placement_place', { text: SENTENCE });
  assert.equal(first.isError, false);
  assert.equal(first.body.stage, 'planned');
  assert.ok(first.body.offers.some((o) => o.id === 'q-shape'), 'the shape is offered, not imposed');
  assert.match(first.body.apply, /per-diff approval/);

  const shaped = await call('placement_place', { text: SENTENCE, answers: [{ id: 'q-shape', option: 'list' }] });
  const b = shaped.body;
  assert.equal(b.complete, true);
  assert.equal(b.plan.feature, 'products');
  assert.ok(b.plan.stepCount >= 8);
  const create = b.plan.steps.find((s) => s.flow === 'create.unit');
  assert.ok(create.files.every((f) => /^[\w./-]+$/.test(f.path) && !f.path.startsWith('/') && ['create', 'modify'].includes(f.change)), 'files are project-relative');
  assert.ok(b.plan.steps.some((s) => s.flow === 'create.route' && s.files[0].path === 'src/App.tsx'));
  assert.equal(b.proof.state, 'pending');
  assert.equal(b.wiring.routes[0].route, '/products');
  assert.ok(b.offers.some((o) => o.id === 'q-dependency'), 'the dependency is a closed offer');
  assert.deepEqual(b.decisions, [{ question: 'q-shape', option: 'list', by: 'llm', provider: 'claude-code' }], 'the MCP client is the attributed source of the answer');
  assert.ok(Object.keys(b.files).length >= 1);
});

// The shared session allows 30 calls a minute (LIMITS): the shape tests below use a session of their own so they do not eat that budget.
const withOwnSession = async (fn) => {
  const own = await connectInProcess({ root }, 'claude-code');
  try {
    return await fn((name, args) => callTool(own.client, name, args));
  } finally {
    await own.close();
  }
};

test('placement_place: an overview is offered the dashboard shape (#627); an LLM answers it by id and the plan carries the shape, attributed to the client', () => withOwnSession(async (call) => {
  const text = 'A manager wants an overview of orders with totals';
  const first = (await call('placement_place', { text })).body;
  const offer = first.offers.find((o) => o.id === 'q-shape');
  assert.deepEqual(offer.options.map((o) => o.id), ['dashboard', 'scaffold']);
  assert.equal(offer.default, 'dashboard');
  const shaped = (await call('placement_place', { text, answers: [{ id: 'q-shape', option: 'dashboard' }] })).body;
  assert.equal(shaped.complete, true);
  assert.equal(shaped.plan.feature, 'orders-dashboard');
  assert.deepEqual(shaped.decisions, [{ question: 'q-shape', option: 'dashboard', by: 'llm', provider: 'claude-code' }]);
  assert.ok(shaped.files.b1.includes('features/orders-dashboard/domain/OrdersDashboard.domain.ts'));
  const wrong = await call('placement_place', { text, answers: [{ id: 'q-shape', option: 'list' }] });
  assert.equal(wrong.isError, true, 'list is not an option of this card');
}));

test('placement_place: a step-by-step flow is offered the wizard shape (#628); the plan carries its steps and the workflow layer, attributed to the client', () => withOwnSession(async (call) => {
  const text = 'A user wants a step by step signup';
  const offer = (await call('placement_place', { text })).body.offers.find((o) => o.id === 'q-shape');
  assert.deepEqual([offer.options.map((o) => o.id), offer.default], [['wizard', 'scaffold'], 'wizard']);
  const shaped = (await call('placement_place', { text, answers: [{ id: 'q-shape', option: 'wizard' }] })).body;
  assert.equal(shaped.complete, true);
  assert.equal(shaped.plan.feature, 'signup');
  assert.deepEqual(shaped.decisions, [{ question: 'q-shape', option: 'wizard', by: 'llm', provider: 'claude-code' }]);
  assert.ok(shaped.plan.steps.some((s) => s.flow === 'create.unit' && s.files.some((f) => f.path === 'features/signup/workflows/Signup.workflow.ts')), 'the machine is a plan step');
  assert.ok(shaped.files.b1.includes('features/signup/workflows/Signup.workflow.ts'));
}));

test('placement_place: the data source of a shaped screen (#621) is a closed offer an LLM answers by id, attributed to it; an option that was not offered is refused', async () => {
  const shape = { id: 'q-shape', option: 'list' };
  const asked = (await call('placement_place', { text: SENTENCE, answers: [shape] })).body;
  const offer = asked.offers.find((o) => o.id === 'q-source');
  assert.deepEqual([offer.default, offer.options.map((o) => o.id)], ['local', ['local', 'endpoint']], 'no OpenAPI file in this project: local is the rules default');
  const answered = (await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-source', option: 'endpoint' }] })).body;
  assert.deepEqual(answered.decisions, [{ question: 'q-shape', option: 'list', by: 'llm', provider: 'claude-code' }, { question: 'q-source', option: 'endpoint', by: 'llm', provider: 'claude-code' }]);
  assert.equal(answered.files['b1'].some((f) => f.includes('Store')), false, 'the endpoint source writes no store');
  assert.equal(asked.files['b1'].some((f) => f.includes('ProductsStore')), true, 'the default writes it');
  const refused = await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-source', option: 'openapi' }] });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, 'PLAN_REFUSED');
});

test('placement_place: the type-check (#632) is a closed offer, q-verify, answered by id and attributed to the client; both steps on request', async () => {
  const shape = { id: 'q-shape', option: 'list' };
  const asked = (await call('placement_place', { text: SENTENCE, answers: [shape] })).body;
  const offer = asked.offers.find((o) => o.id === 'q-verify');
  assert.deepEqual([offer.default, offer.options.map((o) => o.id)], ['types', ['types', 'types-build', 'none']]);
  assert.deepEqual([asked.verify, asked.plan.steps.some((s) => s.flow === 'check.types')], [{ types: 's11', build: null }, true]);
  const none = (await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-verify', option: 'none' }] })).body;
  assert.deepEqual([none.verify, none.plan.steps.some((s) => s.flow === 'check.types')], [{ types: null, build: null }, false]);
  assert.deepEqual(none.decisions.at(-1), { question: 'q-verify', option: 'none', by: 'llm', provider: 'claude-code' });
  const both = (await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-verify', option: 'types-build' }] })).body;
  assert.deepEqual(both.verify, { types: 's11', build: 's12' }, 'the init project has a build script, so building is on offer');
  assert.deepEqual(both.plan.steps.filter((s) => s.flow.startsWith('check.')).map((s) => [s.flow, s.files]), [['check.types', []], ['check.build', []]], 'read-only: no file is touched');
});

test('placement_place: the wizard step count (#659) is a closed offer, q-steps, answered by id and attributed to the client; the steps ride on every unit and the proof', () => withOwnSession(async (call) => {
  const wizard = 'A user wants a step by step signup';
  const shape = { id: 'q-shape', option: 'wizard' };
  const asked = (await call('placement_place', { text: wizard, answers: [shape] })).body;
  const offer = asked.offers.find((o) => o.id === 'q-steps');
  assert.deepEqual([offer.default, offer.chosen, offer.options.map((o) => o.id)], ['three', null, ['three', 'two', 'four']]);
  const stepFiles = (body) => body.plan.steps.find((s) => s.title === 'Create component Signup').files.map((f) => f.path).filter((f) => f.endsWith('Step.component.tsx')).map((f) => f.split('/').pop().replace('Signup', '').replace('Step.component.tsx', ''));
  assert.deepEqual(stepFiles(asked), ['Details', 'Review', 'Done'], 'unanswered: three steps, a component each');
  const four = (await call('placement_place', { text: wizard, answers: [shape, { id: 'q-steps', option: 'four' }] })).body;
  assert.deepEqual(four.decisions.at(-1), { question: 'q-steps', option: 'four', by: 'llm', provider: 'claude-code' });
  assert.equal(four.offers.find((o) => o.id === 'q-steps').chosen, 'four');
  assert.deepEqual(stepFiles(four), ['Details', 'Options', 'Review', 'Done'], 'the four steps are the ones of the table');
  const two = (await call('placement_place', { text: wizard, answers: [shape, { id: 'q-steps', option: 'two' }] })).body;
  assert.deepEqual(stepFiles(two), ['Details', 'Done']);
  const refused = await call('placement_place', { text: wizard, answers: [shape, { id: 'q-steps', option: 'seven' }] });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, 'PLAN_REFUSED');
  const list = (await call('placement_place', { text: SENTENCE, answers: [{ id: 'q-shape', option: 'list' }] })).body;
  assert.equal(list.offers.some((o) => o.id === 'q-steps'), false, 'only the wizard is asked');
}));

test('placement_place: a card that needs a secret names its environment variables (#632): a q-env per variable, answered by id, the add.env steps previewed with their file', async () => {
  const text = 'A logged-in user wants to safely manage billing details Stripe';
  const asked = (await call('placement_place', { text })).body;
  assert.deepEqual(asked.offers.filter((o) => o.id.startsWith('q-env')).map((o) => [o.id, o.default, o.options.map((x) => x.id)]), [['q-env-stripe-secret-key', 'add', ['add', 'skip']], ['q-env-allowed-redirect-origins', 'add', ['add', 'skip']]]);
  assert.deepEqual(asked.env.map((e) => [e.variable, e.scope]), [['STRIPE_SECRET_KEY', 'server'], ['ALLOWED_REDIRECT_ORIGINS', 'server']]);
  const step = asked.plan.steps.find((s) => s.flow === 'add.env');
  assert.deepEqual(step.files, [{ path: '.env.example', change: 'create' }]);
  const skipped = (await call('placement_place', { text, answers: [{ id: 'q-env-stripe-secret-key', option: 'skip' }] })).body;
  assert.deepEqual(skipped.env.map((e) => [e.variable, e.step === null]), [['STRIPE_SECRET_KEY', true], ['ALLOWED_REDIRECT_ORIGINS', false]]);
  assert.deepEqual(skipped.decisions.at(-1), { question: 'q-env-stripe-secret-key', option: 'skip', by: 'llm', provider: 'claude-code' });
  assert.equal(JSON.stringify(asked).includes(root), false, 'path-free like every result');
  assert.equal(fs.existsSync(path.join(root, '.env.example')), false, 'plan-only: nothing is written');
});

test('placement_place: an unknown word is a question first, answered by id, then it places', async () => {
  const text = 'A user can frobnicate the widget';
  const open = await call('placement_place', { text });
  assert.equal(open.body.stage, 'card-questions');
  assert.equal(open.body.plan, null);
  const id = open.body.questions[0].id;
  const answers = open.body.questions.map((q) => ({ id: q.id, option: q.options.find((o) => o.id === 'ignore').id }));
  const answered = await call('placement_place', { text, answers });
  assert.notEqual(answered.body.stage, 'card-questions', JSON.stringify(answered.body.questions));
  const refused = await call('placement_place', { text, answers: [{ id, option: 'no-such-option' }] });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, 'ANSWER_REFUSED');
});

test('plan_validate: a plan from placement is valid, a broken one lists what is wrong', async () => {
  const card = parseRequirement(SENTENCE).card;
  const placed = placeCard(card, { framework: 'react-spa', answers: { 'q-shape': 'list' } });
  const { plan } = planFromBlocks(placed.blocks, { feature: 'products', root, decisions: placed.decisions });
  const good = await call('plan_validate', { plan });
  assert.equal(good.body.valid, true);
  assert.equal(good.body.stepCount, plan.steps.length);
  assert.ok(good.body.steps[0].files.length >= 1);

  const bad = await call('plan_validate', { plan: { version: 1, ticket: { source: 'text', title: 'x' }, steps: [{ id: 's1', flow: 'no.such.flow', title: 't', args: {} }] } });
  assert.equal(bad.isError, false);
  assert.equal(bad.body.valid, false);
  assert.ok(bad.body.errorCount >= 1);
  assert.deepEqual(Object.keys(bad.body.errors[0]).sort(), ['code', 'message', 'path']);
});

test('decide: the rules provider suggests for a summary and for every open question of a sentence', async () => {
  const summary = { id: 'q-x', question: 'Which shape?', options: [{ id: 'list', label: 'List', enabled: true, why: 'many items' }, { id: 'scaffold', label: 'Scaffold', enabled: true, why: 'empty' }] };
  const s = await call('decide', { summary });
  assert.equal(s.body.provider.name, 'rules');
  assert.equal(s.body.suggestion.option, 'list');
  assert.equal(s.body.suggestion.runnerUp, 'scaffold');

  const t = await call('decide', { text: SENTENCE });
  assert.equal(t.body.questions[0].id, 'q-shape');
  assert.equal(t.body.questions[0].suggestion.option, 'list');

  const both = await call('decide', { summary, text: SENTENCE });
  assert.equal(both.body.error.code, 'INVALID_INPUT');
  const neither = await call('decide', {});
  assert.equal(neither.body.error.code, 'INVALID_INPUT');
  const tooMany = await call('decide', { summary: { ...summary, options: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}` })) } });
  assert.equal(tooMany.body.error.code, 'INVALID_INPUT');
});

test('decide: a project plugin is not loaded unless the server was started with plugins on', async () => {
  const withPlugin = makeProject({ files: { 'plugin.mjs': 'export default { name: "mine", version: "1", suggest: () => ({ option: "scaffold", reason: "always" }) };\n' } });
  fs.appendFileSync(path.join(withPlugin, 'architecture.yml'), '\ndecision:\n  provider: mine\n  plugin: plugin.mjs\n');
  const summary = { id: 'q-x', question: 'Which?', options: [{ id: 'list', label: 'List', enabled: true, why: 'a' }, { id: 'scaffold', label: 'Scaffold', enabled: true, why: 'b' }] };
  const off = await connectInProcess({ root: withPlugin, allowPlugins: false });
  const refused = await callTool(off.client, 'decide', { summary });
  await off.close();
  assert.equal(refused.body.provider.name, 'rules');
  assert.equal(refused.body.fellBackFrom, 'mine');
  assert.match(refused.body.notes.join(' '), /plugins are not enabled/);
  assert.equal(refused.body.suggestion.option, 'list');
});

test('summarize: the project and one feature, bounded and path-free', async () => {
  const all = await call('summarize', {});
  assert.equal(all.body.scope, 'project');
  assert.deepEqual(all.body.features.map((f) => f.feature).sort(), ['billing', 'core']);
  const billing = await call('summarize', { feature: 'billing' });
  assert.equal(billing.body.scope, 'feature');
  assert.equal(billing.body.features.length, 1);
  assert.equal(billing.body.features[0].layers.domain, 1);
  assert.match(billing.body.summary, /billing/);
  const missing = await call('summarize', { feature: 'nope' });
  assert.equal(missing.isError, true);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('summarize with backend: true: the Express route table, roles and env names of backend.dir, bounded and root-contained', async () => {
  const many = Array.from({ length: LIMITS.backendRoutes + 20 }, (_, i) => `app.get('/bulk/${i}', (req, res) => res.end());`).join('\n');
  const backendRoot = makeProject({
    files: {
      'server/index.mjs': `import express from 'express';\nimport { createNotesRouter } from './notesApi.mjs';\nconst app = express();\nconst secret = process.env.SESSION_SECRET;\napp.use('/api/notes', createNotesRouter());\napp.get('/api/health', (req, res) => res.end('ok'));\n${many}\n`,
      'server/notesApi.mjs': `import express from 'express';\nexport function createNotesRouter() {\n  const router = express.Router();\n  router.get('/:id', listNote);\n  return router;\n}\nfunction listNote(req, res) { res.end(); }\n`,
      'server/notesStore.mjs': `import fs from 'node:fs';\nexport const save = (x) => fs.writeFileSync('n', x);\n`,
    },
  });
  fs.appendFileSync(path.join(backendRoot, 'architecture.yml'), '\nbackend:\n  dir: server\n');
  const before = hashTree(backendRoot);
  const { client, close } = await connectInProcess({ root: backendRoot });
  const r = await callTool(client, 'summarize', { backend: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.body.scope, 'backend');
  assert.equal(r.body.dir, 'server');
  assert.equal(r.body.framework, 'express');
  assert.equal(r.body.counts.routes, LIMITS.backendRoutes + 22);
  assert.equal(r.body.routes.length, LIMITS.backendRoutes);
  assert.equal(r.body.truncated, true);
  assert.deepEqual(r.body.routes.slice(0, 2).map((x) => [x.method, x.path, x.handler, x.file]), [['GET', '/api/notes/:id', 'listNote', 'server/notesApi.mjs'], ['GET', '/api/health', '(inline)', 'server/index.mjs']]);
  assert.deepEqual(r.body.env, ['SESSION_SECRET']);
  assert.equal(r.body.roles.store, 1);
  assert.ok(r.text.length < 32 * 1024, `${r.text.length} bytes: bounded`);
  assert.doesNotMatch(r.text, new RegExp(backendRoot.replaceAll('/', '\\/')), 'path-free');
  const both = await callTool(client, 'summarize', { backend: true, feature: 'billing' });
  assert.equal(both.body.error.code, 'INVALID_INPUT');
  const off = await callTool(client, 'summarize', { backend: false });
  assert.equal(off.body.scope, 'project', 'backend: false is the ordinary summary');
  await close();
  assert.equal(hashTree(backendRoot), before, 'nothing was written');

  const escaping = makeProject({ files: {} });
  fs.appendFileSync(path.join(escaping, 'architecture.yml'), '\nbackend:\n  dir: ../elsewhere\n');
  const c2 = await connectInProcess({ root: escaping });
  const refused = await callTool(c2.client, 'summarize', { backend: true });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, 'CONFIG_UNREADABLE');
  assert.doesNotMatch(refused.text, /\/tmp|\/home/, 'the refusal names no absolute path');
  await c2.close();
});

test('validate: counts by severity and rule and the first findings with rule id, file and fix', async () => {
  const r = await call('validate', { limit: 1 });
  assert.equal(r.body.passed, false);
  assert.ok(r.body.counts.total >= 1);
  assert.equal(r.body.counts.error + r.body.counts.warning, r.body.counts.total);
  assert.ok(r.body.counts.byRule['IMPORT-001'] >= 1);
  assert.equal(r.body.findings.length, 1);
  const f = r.body.findings[0];
  assert.deepEqual([typeof f.rule, typeof f.file, typeof f.fix], ['string', 'string', 'string']);
  assert.ok(!f.file.startsWith('/'), 'the file is project-relative');
  const many = await call('validate', {});
  assert.ok(many.body.findings.length <= LIMITS.defaultFindings);
});

test('machine_capabilities: the tier and what memory and cores allow, nothing probed on the network', async () => {
  const r = await call('machine_capabilities', {});
  assert.ok(['lite', 'cockpit', 'contributor', 'below-lite'].includes(r.body.tier.id));
  assert.equal(typeof r.body.capabilities.modelProposals.available, 'boolean');
  assert.equal(typeof r.body.capabilities.cockpit.available, 'boolean');
  assert.equal(r.body.decisionPlugins.enabled, false);
  assert.ok(r.body.notProbed.includes('Ollama'));
});

test('traces_stats: an empty project, then counts of what was recorded, never a record or a path', async () => {
  const empty = await call('traces_stats', {});
  assert.deepEqual([empty.body.total, empty.body.enabled, empty.body.unreadable], [0, true, false]);
  const q = { id: 'q-shape', question: 'How should it be built?', options: [{ id: 'list', label: 'List', enabled: true, why: 'a' }, { id: 'scaffold', label: 'Scaffold', enabled: true, why: 'b' }], chosen: null };
  await recordChoices(root, [{ summary: q, chosen: 'list', by: 'person' }], { stateDir });
  const one = await call('traces_stats', {});
  assert.equal(one.body.total, 1);
  assert.equal(Object.keys(one.body.byChooser).length, 1);
  assert.doesNotMatch(one.text, /decisions\.jsonl|construct-mcp-state/);
  const other = await call('traces_stats', { chooser: 'no-such-chooser' });
  assert.equal(other.body.total, 0);
});

test('placement_place: how a screen shows its states (#622) is a closed offer, q-states, answered by id and attributed to the client; a skip warns, the notice is left out of the plan', () => withOwnSession(async (call) => {
  const shape = { id: 'q-shape', option: 'list' };
  const asked = (await call('placement_place', { text: SENTENCE, answers: [shape] })).body;
  const offer = asked.offers.find((o) => o.id === 'q-states');
  assert.deepEqual([offer.default, offer.chosen, offer.options.map((o) => o.id)], ['default', null, ['default', 'custom', 'skip-empty', 'skip-all']]);
  const filesOf = (body, title) => body.plan.steps.find((s) => s.title === title).files.map((f) => f.path.split('/').pop());
  assert.ok(filesOf(asked, 'Create component Products').includes('ProductsNotice.component.tsx'), 'unanswered: the default views');
  assert.equal(asked.warnings.some((w) => /no view/.test(w)), false);
  const custom = (await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-states', option: 'custom' }] })).body;
  assert.deepEqual(custom.decisions.at(-1), { question: 'q-states', option: 'custom', by: 'llm', provider: 'claude-code' });
  assert.deepEqual(filesOf(custom, 'Create component Products').filter((f) => /Loading|Empty|Failed/.test(f)).sort(), ['ProductsEmpty.component.tsx', 'ProductsFailed.component.tsx', 'ProductsLoading.component.tsx']);
  const skipped = (await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-states', option: 'skip-all' }] })).body;
  assert.equal(skipped.offers.find((o) => o.id === 'q-states').chosen, 'skip-all');
  assert.equal(filesOf(skipped, 'Create component Products').some((f) => /Notice/.test(f)), false, 'nothing uses the notice');
  assert.match(skipped.warnings.join(' '), /no view for any state/);
  const refused = await call('placement_place', { text: SENTENCE, answers: [shape, { id: 'q-states', option: 'hidden' }] });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, 'PLAN_REFUSED');
}));
