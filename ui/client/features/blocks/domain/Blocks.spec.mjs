import test from 'node:test';
import assert from 'node:assert/strict';
import { argKind, commandText, runsText } from './BlockText.ts';
import { blockRunRequest, modelPatch, runBlocked } from './BlockRun.ts';
import { buildBlocksView, matchesFilter, summaryText } from './BlocksView.ts';
import { initialScreen, screenReducer } from '../workflows/BlocksMachine.ts';

const defaults = { enabled: true, engine: 'mechanical', provider: null, model: null };
const validate = {
  id: 'validate', purpose: 'Check the whole project against its architecture rules and list every violation.', reads: 'Every source file and architecture.yml.', writes: null, writesFiles: false,
  modelCalls: 'none', engines: ['mechanical'], scope: 'empty', offered: true,
  args: [{ name: 'format', type: 'string', required: false, enum: ['json', 'text'], path: false }, { name: 'dir', type: 'string', required: false, path: true, description: 'Target a Construct project nested in a subdirectory.' }],
  example: { title: 'Validate the project', flow: 'validate', executor: 'deterministic', args: { format: 'text' }, argv: ['construct', 'validate', '--format', 'text'] },
  settings: { ...defaults }, runs: 0,
};
const createUnit = {
  id: 'create.unit', purpose: 'Add one file for one layer of a feature.', reads: 'architecture.yml.', writes: 'One new file in the feature.', writesFiles: true,
  modelCalls: 'optional', engines: ['mechanical', 'ai'], scope: 'derived', offered: true,
  args: [{ name: 'layer', type: 'string', required: true, path: false }, { name: 'name', type: 'string', required: true, path: false }, { name: 'feature', type: 'string', required: true, path: false }],
  example: { title: 'Add the Cart domain', flow: 'create.unit', executor: 'deterministic', args: { layer: 'domain', name: 'Cart', feature: 'billing' }, touches: { features: ['billing'] }, argv: ['construct', 'create', 'domain', 'Cart', '--feature', 'billing'] },
  settings: { enabled: true, engine: 'mechanical', provider: 'ollama', model: null }, runs: 3,
};
const pipeline = { id: 'pipeline.run', purpose: 'Run generator steps against a raw Context Envelope.', reads: 'The envelope.', writes: 'Whatever the steps generate.', writesFiles: true, modelCalls: 'none', engines: ['mechanical'], scope: 'declared', offered: false, notOffered: 'Running a raw Context Envelope is not offered in the Cockpit.', args: [], example: null, settings: { ...defaults }, runs: 0 };
const data = (blocks, rev = 0, extra = {}) => ({ rev, updatedAt: null, unreadable: null, provider: 'ollama', engines: ['mechanical', 'ai'], blocks, ...extra });
const off = (row) => ({ ...row, settings: { ...row.settings, enabled: false } });
const run = (actions, from = initialScreen) => actions.reduce(screenReducer, from);
const ready = (blocks = [validate, createUnit, pipeline], rev = 0) => run([{ type: 'LOAD_START' }, { type: 'LOADED', data: data(blocks, rev) }]);
const cardOf = (view, id) => view.cards.find((c) => c.id === id);

test('a card says, in plain words: read-only or writes, model calls: 0 or can use a model, what it reads and writes, and how often it ran', () => {
  const view = buildBlocksView(ready());
  const v = cardOf(view, 'validate');
  assert.deepEqual(v.kind, { label: 'Read-only', tone: 'read' });
  assert.deepEqual(v.model, { label: 'model calls: 0', tone: 'none' });
  assert.equal(v.writes, 'Nothing: it never changes a file.');
  assert.equal(v.reads, 'Every source file and architecture.yml.');
  assert.equal(v.runs, 'Not run in this project yet');
  const c = cardOf(view, 'create.unit');
  assert.deepEqual(c.kind, { label: 'Writes files', tone: 'write' });
  assert.deepEqual(c.model, { label: 'can use a model', tone: 'optional' });
  assert.equal(c.writes, 'One new file in the feature.');
  assert.equal(c.runs, 'Ran 3 times in this project');
  assert.equal(runsText(1), 'Ran 1 time in this project');
});

test('arguments read as a list of what each one is, and the example carries the exact command', () => {
  const v = cardOf(buildBlocksView(ready()), 'validate');
  assert.deepEqual(v.args.map((a) => [a.label, a.kind]), [['format', 'one of json, text'], ['dir', 'a path inside the project']]);
  assert.equal(v.args[1].description, 'Target a Construct project nested in a subdirectory.');
  assert.deepEqual(v.example, { title: 'Validate the project', command: 'construct validate --format text' });
  assert.equal(argKind({ name: 'layers', type: 'string[]', required: true, path: false }), 'a list, separated by commas');
  assert.equal(argKind({ name: 'x', type: 'boolean', required: false, path: false }), 'yes or no');
  assert.equal(argKind({ name: 'plan', type: 'object', required: true, path: false }), 'structured data');
  assert.equal(commandText(['construct', 'create', 'domain', 'A B', "it's"]), "construct create domain 'A B' 'it'\\''s'");
  assert.equal(commandText(null), null);
});

test('the default engine is offered only on a block with a model path', () => {
  const view = buildBlocksView(ready());
  assert.equal(cardOf(view, 'validate').engine, null);
  assert.deepEqual(cardOf(view, 'create.unit').engine, { value: 'mechanical', model: '', provider: 'ollama' });
  const ai = buildBlocksView(ready([{ ...createUnit, settings: { enabled: true, engine: 'ai', provider: 'ollama', model: 'qwen2.5-coder:7b' } }]));
  assert.deepEqual(cardOf(ai, 'create.unit').engine, { value: 'ai', model: 'qwen2.5-coder:7b', provider: 'ollama' });
});

test('a turned-off block says so and cannot be run from its card; a block the Cockpit never offers is locked', () => {
  const view = buildBlocksView(ready([off(validate), createUnit, pipeline]));
  const v = cardOf(view, 'validate');
  assert.equal(v.enabled, false);
  assert.match(v.offNote, /Turned off for this project/);
  assert.equal(v.runBlocked, 'Turned off for this project.');
  assert.equal(cardOf(view, 'create.unit').runBlocked, null);
  const p = cardOf(view, 'pipeline.run');
  assert.equal(p.locked, true);
  assert.match(p.offNote, /not offered in the Cockpit/);
  assert.match(p.runBlocked, /not offered/);
  assert.equal(view.summary, '3 blocks, 1 turned off');
  assert.equal(summaryText([validate]), '1 block');
});

test('Run this block builds the one step the Plan screen adds: the example, tagged with the default engine', () => {
  assert.deepEqual(blockRunRequest(createUnit), { flow: 'create.unit', title: 'Add the Cart domain', executor: 'deterministic', args: { layer: 'domain', name: 'Cart', feature: 'billing' }, touches: { features: ['billing'] } });
  const ai = { ...createUnit, settings: { enabled: true, engine: 'ai', provider: 'ollama', model: null } };
  assert.deepEqual(blockRunRequest(ai), { flow: 'create.unit', title: 'Add the Cart domain', executor: 'local-model', args: { layer: 'domain', name: 'Cart', feature: 'billing', llm: 'ollama' }, touches: { features: ['billing'] } });
  // A block with no model path stays mechanical even if a stale row claimed AI.
  assert.equal(blockRunRequest({ ...validate, settings: { enabled: true, engine: 'ai', provider: null, model: null } }).executor, 'deterministic');
  // Off, not offered and no example: nothing to hand over.
  assert.equal(blockRunRequest(off(validate)), null);
  assert.equal(blockRunRequest(pipeline), null);
  assert.equal(blockRunRequest({ ...validate, example: null }), null);
  assert.equal(runBlocked({ ...validate, example: null }), 'This block has no example to start from.');
  // The request is a copy: editing the step on the Plan screen never edits the catalogue.
  const req = blockRunRequest(createUnit);
  req.args.name = 'Changed';
  assert.equal(createUnit.example.args.name, 'Cart');
});

test('the model box: empty puts the default back, text is trimmed', () => {
  assert.deepEqual(modelPatch(''), { model: null });
  assert.deepEqual(modelPatch('   '), { model: null });
  assert.deepEqual(modelPatch(' qwen2.5-coder:7b '), { model: 'qwen2.5-coder:7b' });
});

test('the filter needs every word in the id or the purpose, and says so when nothing matches', () => {
  assert.equal(matchesFilter(validate, ''), true);
  assert.equal(matchesFilter(validate, 'VALID'), true);
  assert.equal(matchesFilter(validate, 'architecture rules'), true);
  assert.equal(matchesFilter(validate, 'architecture cart'), false);
  const s = run([{ type: 'FILTER', text: 'cart' }], ready());
  assert.deepEqual(buildBlocksView(s).cards.map((c) => c.id), []);
  assert.equal(buildBlocksView(s).empty, 'No block matches that.');
  assert.deepEqual(buildBlocksView(run([{ type: 'FILTER', text: 'add one file' }], ready())).cards.map((c) => c.id), ['create.unit']);
});

test('loading, a failed load with Retry, and a load that keeps what is already shown', () => {
  assert.equal(buildBlocksView(run([{ type: 'LOAD_START' }])).status, 'loading');
  const failed = run([{ type: 'LOAD_START' }, { type: 'LOAD_FAILED', error: 'The Cockpit server could not be reached.' }]);
  assert.equal(failed.status, 'failed');
  assert.equal(buildBlocksView(failed).error, 'The Cockpit server could not be reached.');
  // A refresh that fails, or is in flight, does not blank a tab that already has the list.
  const again = run([{ type: 'LOAD_START' }, { type: 'LOAD_FAILED', error: 'x' }], ready());
  assert.equal(again.status, 'ready');
  assert.equal(again.blocks.length, 3);
});

test('a change shows on screen only after the server confirmed it', () => {
  const s0 = ready();
  const saving = run([{ type: 'SAVE_START', id: 'validate' }], s0);
  assert.equal(cardOf(buildBlocksView(saving), 'validate').enabled, true, 'still the confirmed copy while saving');
  assert.equal(cardOf(buildBlocksView(saving), 'validate').saving, true);
  assert.equal(cardOf(buildBlocksView(saving), 'create.unit').saving, false);
  const saved = run([{ type: 'SAVED', data: data([off(validate), createUnit, pipeline], 1) }], saving);
  assert.equal(cardOf(buildBlocksView(saved), 'validate').enabled, false);
  assert.equal(saved.rev, 1);
  assert.equal(saved.saving, null);
});

test('the server\'s refusal is shown on the card it is about, in the server\'s own words, and the old copy stays', () => {
  const s = run([
    { type: 'SAVE_START', id: 'validate' },
    { type: 'SAVE_REFUSED', id: 'validate', code: 'BLOCK_AI_UNSUPPORTED', message: '"validate" has no model path, so its engine can only be Mechanical.' },
  ], ready());
  const view = buildBlocksView(s);
  assert.equal(cardOf(view, 'validate').refusal, '"validate" has no model path, so its engine can only be Mechanical.');
  assert.equal(cardOf(view, 'create.unit').refusal, null);
  assert.equal(view.notice, null);
  assert.equal(s.rev, 0);
  // The next change starts clean.
  assert.equal(run([{ type: 'SAVE_START', id: 'validate' }], s).refusal, null);
});

test('a stale save adopts the copy it lost to and says so once, above the list', () => {
  const s = run([
    { type: 'SAVE_START', id: 'validate' },
    { type: 'SAVE_REFUSED', id: 'validate', code: 'STALE_REV', message: 'These settings changed elsewhere since they were loaded. Reload them and try again.', current: data([validate, off(createUnit), pipeline], 5) },
  ], ready());
  assert.equal(s.rev, 5);
  assert.equal(cardOf(buildBlocksView(s), 'create.unit').enabled, false, 'the winning copy is what shows');
  assert.equal(cardOf(buildBlocksView(s), 'validate').refusal, 'These settings changed elsewhere since they were loaded. Reload them and try again.');
});

test('a refusal about no card (a reset that failed) shows as one notice', () => {
  const s = run([{ type: 'SAVE_START', id: null }, { type: 'SAVE_REFUSED', id: null, code: 'NOT_WRITABLE', message: 'The block settings folder is not writable.' }], ready());
  assert.equal(buildBlocksView(s).notice, 'The block settings folder is not writable.');
  assert.equal(s.saving, null);
});

test('damaged settings are reported so the tab can offer a reset', () => {
  const s = run([{ type: 'LOADED', data: data([validate], 0, { unreadable: 'unreadable: Unexpected token' }) }]);
  assert.equal(buildBlocksView(s).unreadable, 'unreadable: Unexpected token');
  assert.equal(buildBlocksView(ready()).unreadable, null);
});
