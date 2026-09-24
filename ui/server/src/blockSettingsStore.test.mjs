// #407 -- the per-project block settings: what is stored, what is refused (each by its named code, writing nothing),
// what survives a "restart", and what a tampered file cannot do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBlockSettingsStore, blockSettingsFile, effectiveSettings, checkPatch, BlockSettingsError, MAX_MODEL_CHARS } from './blockSettingsStore.mjs';
import { projectKey } from '../../../packages/engine/processStore.mjs';
import { PLAN_FLOWS } from '../../../packages/core/plan.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const open = (over = {}) => {
  const stateDir = over.stateDir ?? makeTempDir('construct-blocks-state-');
  const project = over.project ?? makeTempDir('construct-blocks-project-');
  return { stateDir, project, store: openBlockSettingsStore(project, { stateDir, now: () => '2026-09-24T00:00:00.000Z' }) };
};
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof BlockSettingsError, `expected a BlockSettingsError, got ${e}`); return e.code; } return null; };

test('the file lives outside the project, at <stateDir>/block-settings/<projectKey>.json', () => {
  const { stateDir, project, store } = open();
  assert.equal(store.file, path.join(stateDir, 'block-settings', `${projectKey(project)}.json`));
  assert.equal(blockSettingsFile(project, { stateDir }), store.file);
  store.update({ rev: 0, blocks: { validate: { enabled: false } } });
  assert.ok(fs.existsSync(store.file));
  assert.deepEqual(fs.readdirSync(project), [], 'nothing is written into the project');
});

test('a fresh project: rev 0, every block on, mechanical, nothing stored', () => {
  const { store } = open();
  const { record, unreadable } = store.read();
  assert.deepEqual(record, { version: 1, rev: 0, updatedAt: null, blocks: {} });
  assert.equal(unreadable, null);
  assert.deepEqual(store.disabledFlows(), { flows: [], unreadable: null });
  assert.deepEqual(effectiveSettings('create.unit', {}), { enabled: true, engine: 'mechanical', provider: 'ollama', model: null });
  assert.deepEqual(effectiveSettings('validate', {}), { enabled: true, engine: 'mechanical', provider: null, model: null });
  assert.deepEqual(effectiveSettings('manual.task', {}), { enabled: true, engine: null, provider: null, model: null });
});

test('turn a block off and on: only the difference from the default is stored, rev counts up, and it survives a restart', () => {
  const { stateDir, project, store } = open();
  const off = store.update({ rev: 0, blocks: { 'create.unit': { enabled: false }, validate: { enabled: false } } });
  assert.equal(off.rev, 1);
  assert.deepEqual(off.blocks, { 'create.unit': { enabled: false }, validate: { enabled: false } });
  assert.deepEqual(store.disabledFlows().flows.sort(), ['create.unit', 'validate']);
  const restarted = openBlockSettingsStore(project, { stateDir });
  assert.deepEqual(restarted.disabledFlows().flows.sort(), ['create.unit', 'validate']);
  const on = restarted.update({ rev: 1, blocks: { validate: { enabled: true } } });
  assert.equal(on.rev, 2);
  assert.deepEqual(on.blocks, { 'create.unit': { enabled: false } }, 'enabled: true is the default, so the entry is removed');
});

test('default engine and model only where the block has a model path; provider is always the one local provider', () => {
  const { store } = open();
  const saved = store.update({ rev: 0, blocks: { 'create.unit': { engine: 'ai', provider: 'ollama', model: 'qwen2.5-coder:7b' } } });
  assert.deepEqual(saved.blocks, { 'create.unit': { engine: 'ai', model: 'qwen2.5-coder:7b' } }, 'the default provider is not stored');
  assert.deepEqual(effectiveSettings('create.unit', saved.blocks), { enabled: true, engine: 'ai', provider: 'ollama', model: 'qwen2.5-coder:7b' });
  const back = store.update({ rev: 1, blocks: { 'create.unit': { engine: 'mechanical', model: null } } });
  assert.deepEqual(back.blocks, {}, 'back to the defaults leaves nothing stored');
  for (const id of ['create.layer', 'create.unit', 'import.unit', 'import.plan']) {
    assert.equal(code(() => checkPatch({ [id]: { engine: 'ai' } })), null, `${id} supports a model`);
  }
});

test('a block that does not support AI can never be set to AI (nor given a model or provider)', () => {
  const { store } = open();
  const noModel = Object.entries(PLAN_FLOWS).filter(([, f]) => !f.executors.includes('local-model')).map(([id]) => id).filter((id) => id !== 'pipeline.run');
  assert.ok(noModel.length >= 20);
  for (const id of noModel) {
    assert.equal(code(() => store.update({ rev: 0, blocks: { [id]: { engine: 'ai' } } })), 'BLOCK_AI_UNSUPPORTED', `${id} engine`);
    assert.equal(code(() => store.update({ rev: 0, blocks: { [id]: { model: 'qwen2.5-coder:7b' } } })), 'BLOCK_AI_UNSUPPORTED', `${id} model`);
    assert.equal(code(() => store.update({ rev: 0, blocks: { [id]: { provider: 'ollama' } } })), 'BLOCK_AI_UNSUPPORTED', `${id} provider`);
  }
  assert.ok(!fs.existsSync(store.file), 'nothing was written by any refusal');
  assert.equal(code(() => store.update({ rev: 0, blocks: { 'manual.task': { engine: 'mechanical' } } })), 'BLOCK_ENGINE_UNSUPPORTED');
  assert.equal(code(() => store.update({ rev: 0, blocks: { 'import.route': { engine: 'mechanical' } } })), 'BLOCK_ENGINE_UNSUPPORTED');
});

test('only the local provider is allowed, only a plain model name, and the refusal names its code', () => {
  const { store } = open();
  for (const provider of ['claude', 'openai', 'OLLAMA', '', 'http://evil.example']) {
    assert.equal(code(() => store.update({ rev: 0, blocks: { 'create.unit': { provider } } })), 'BLOCK_PROVIDER_NOT_ALLOWED', `provider ${JSON.stringify(provider)}`);
  }
  for (const model of ['--flag', '-x', 'a b', 'a;b', 'a\nb', '$(id)', '../../etc/passwd', '', 'x'.repeat(MAX_MODEL_CHARS + 1)]) {
    assert.equal(code(() => store.update({ rev: 0, blocks: { 'create.unit': { model } } })), 'BLOCK_FIELD_INVALID', `model ${JSON.stringify(model).slice(0, 30)}`);
  }
  for (const model of ['qwen2.5-coder:7b', 'library/llama3:8b', 'llama3.1', 'x'.repeat(MAX_MODEL_CHARS)]) {
    assert.equal(code(() => checkPatch({ 'create.unit': { model } })), null, model.slice(0, 20));
  }
  assert.ok(!fs.existsSync(store.file));
});

test('hostile block ids and shapes are refused: unknown ids, prototype keys, paths, non-objects, unknown settings', () => {
  const { store } = open();
  const bad = [
    [{ nope: { enabled: false } }, 'BLOCK_UNKNOWN'],
    [{ '../../etc/passwd': { enabled: false } }, 'BLOCK_UNKNOWN'],
    [{ 'create.unit ': { enabled: false } }, 'BLOCK_UNKNOWN'],
    [{ CREATE_UNIT: { enabled: false } }, 'BLOCK_UNKNOWN'],
    [JSON.parse('{"__proto__":{"enabled":false}}'), 'BLOCK_UNKNOWN'],
    [JSON.parse('{"constructor":{"enabled":false}}'), 'BLOCK_UNKNOWN'],
    [{ toString: { enabled: false } }, 'BLOCK_UNKNOWN'],
    [{ 'pipeline.run': { enabled: false } }, 'BLOCK_NOT_OFFERED'],
    [{ validate: 'off' }, 'BLOCK_FIELD_INVALID'],
    [{ validate: null }, 'BLOCK_FIELD_INVALID'],
    [{ validate: [] }, 'BLOCK_FIELD_INVALID'],
    [{ validate: { enabled: 'false' } }, 'BLOCK_FIELD_INVALID'],
    [{ validate: { enabled: 0 } }, 'BLOCK_FIELD_INVALID'],
    [{ validate: { enabled: null } }, 'BLOCK_FIELD_INVALID'],
    [{ validate: { engine: 'gpu' } }, 'BLOCK_FIELD_INVALID'],
    [{ validate: { engine: ['ai'] } }, 'BLOCK_FIELD_INVALID'],
    [{ validate: { run: true } }, 'BLOCK_FIELD_UNKNOWN'],
    [{ validate: { __proto__: null, executor: 'user' } }, 'BLOCK_FIELD_UNKNOWN'],
    [{ 'create.unit': { model: { $ne: 1 } } }, 'BLOCK_FIELD_INVALID'],
    [{ 'create.unit': { model: 7 } }, 'BLOCK_FIELD_INVALID'],
    [[], 'BLOCKS_INVALID'],
    ['x', 'BLOCKS_INVALID'],
    [null, 'BLOCKS_INVALID'],
    [undefined, 'BLOCKS_INVALID'],
  ];
  for (const [blocks, expected] of bad) {
    assert.equal(code(() => store.update({ rev: 0, blocks })), expected, JSON.stringify(blocks));
  }
  // One bad entry refuses the WHOLE patch: the good entry beside it is not applied.
  assert.equal(code(() => store.update({ rev: 0, blocks: { validate: { enabled: false }, nope: { enabled: false } } })), 'BLOCK_UNKNOWN');
  assert.ok(!fs.existsSync(store.file), 'nothing was written');
  assert.equal(({}).enabled, undefined, 'Object.prototype is untouched');
});

test('rev is required and must match: 400 REV_REQUIRED, 409 STALE_REV, and neither writes', () => {
  const { store } = open();
  assert.equal(code(() => store.update({ blocks: { validate: { enabled: false } } })), 'REV_REQUIRED');
  store.update({ rev: 0, blocks: { validate: { enabled: false } } });
  for (const rev of [undefined, null, '', '1', 1.5, -1, {}]) {
    assert.equal(code(() => store.update({ rev, blocks: { sync: { enabled: false } } })), 'REV_REQUIRED', `rev ${JSON.stringify(rev)}`);
  }
  try { store.update({ rev: 0, blocks: { sync: { enabled: false } } }); assert.fail('stale rev accepted'); } catch (e) { assert.equal(e.code, 'STALE_REV'); assert.equal(e.status, 409); }
  assert.deepEqual(store.disabledFlows().flows, ['validate']);
});

test('a tampered file cannot smuggle anything: unknown blocks and fields are dropped, and a non-true "enabled" reads as OFF', () => {
  const { store } = open();
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  fs.writeFileSync(store.file, JSON.stringify({
    version: 1, rev: 4, updatedAt: 'x',
    blocks: {
      nope: { enabled: false },
      'pipeline.run': { enabled: false },
      validate: { enabled: 'nope', executor: 'user', engine: 'ai' },
      'create.unit': { engine: 'ai', model: '--evil', provider: 'claude', enabled: true },
      sync: 'off',
      'test.run': { enabled: false, engine: 'ai' },
    },
  }));
  const { record, unreadable } = store.read();
  assert.equal(unreadable, null);
  assert.equal(record.rev, 4);
  assert.deepEqual(record.blocks, { validate: { enabled: false }, 'create.unit': { engine: 'ai' }, 'test.run': { enabled: false } });
});

test('a file that cannot be read is reported (so enforcement fails closed) and a save replaces it, whatever the rev', () => {
  const { store } = open();
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  for (const junk of ['{not json', '[]', '"x"', '{"rev":"1"}', '{"rev":-3}']) {
    fs.writeFileSync(store.file, junk);
    const { unreadable } = store.read();
    assert.match(unreadable, /^unreadable:/, junk);
    assert.match(store.disabledFlows().unreadable, /^unreadable:/);
  }
  const saved = store.update({ rev: 99, blocks: { validate: { enabled: false } } });
  assert.equal(saved.rev, 1);
  assert.equal(store.read().unreadable, null);
});

test('projects do not share settings', () => {
  const stateDir = makeTempDir('construct-blocks-state-');
  const a = openBlockSettingsStore(makeTempDir('construct-blocks-a-'), { stateDir });
  const b = openBlockSettingsStore(makeTempDir('construct-blocks-b-'), { stateDir });
  a.update({ rev: 0, blocks: { validate: { enabled: false } } });
  assert.deepEqual(b.disabledFlows().flows, []);
});
