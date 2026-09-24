// #407 -- per-project settings for the mechanical blocks (the PLAN_FLOWS): turn a block off for this project, and the
// default engine (Mechanical | AI) and default local model where the block supports one.
//
// Persistence and validation only; the HTTP surface is `blocksApi.mjs`, the enforcement is `planService.checkPlan`
// (a step whose flow is turned off is refused before anything starts), and the screen is the Blocks tab in
// `ui/client/features/blocks`. No model is called anywhere here and these settings are never sent to one.
//
// Same pattern as `notesStore.mjs`: state lives OUTSIDE the project, in the per-user state directory, keyed by the
// project's absolute path (`resolveStateDir()` / `projectKey()`), written atomically (`atomicWriteJson`), with a `rev`
// the caller must send back so two tabs cannot silently overwrite each other.
//
// Layout:  <stateDir>/block-settings/<projectKey>.json
//   { version: 1, rev, updatedAt, blocks: { '<flowId>': { enabled?: false, engine?: 'ai', model?: '<name>' } } }
// Only DIFFERENCES from the defaults are stored (`enabled: true`, `engine: 'mechanical'` and the one allowed provider
// are the defaults and are never written), so an empty `blocks` means "everything as shipped".
//
// What the store refuses, by named code (all 400 unless noted):
//   BLOCK_UNKNOWN            the flow id is not a key of PLAN_FLOWS (also `__proto__`, `constructor`, paths, ...)
//   BLOCK_NOT_OFFERED        the Cockpit never offers this block (pipeline.run), so there is nothing to set
//   BLOCK_FIELD_UNKNOWN      a setting other than enabled / engine / provider / model
//   BLOCK_FIELD_INVALID      a value of the wrong type or shape
//   BLOCK_AI_UNSUPPORTED     engine "ai" (or a provider / model) on a block that has no model path
//   BLOCK_ENGINE_UNSUPPORTED engine "mechanical" on a block that only a person can do
//   BLOCK_PROVIDER_NOT_ALLOWED  a provider other than the one local model provider (the Cockpit's own Ollama-only rule)
//   REV_REQUIRED / STALE_REV (409)
// A refused request writes nothing: the whole patch is checked before the first byte is saved.
import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDir, projectKey, atomicWriteJson } from '../../../packages/engine/processStore.mjs';
import { flowBlocks } from '../../../packages/core/block-flows.mjs';
import { LOCAL_PROVIDER, NOT_OFFERED } from './planService.mjs';

export const SETTINGS_VERSION = 1;
export const ENGINES = Object.freeze(['mechanical', 'ai']);
export const SETTING_FIELDS = Object.freeze(['enabled', 'engine', 'provider', 'model']);
export const MAX_MODEL_CHARS = 100;
/** An Ollama model name: `qwen2.5-coder:7b`, `library/llama3:8b`. Starts with a letter or digit (never `-`), no spaces. */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

export class BlockSettingsError extends Error {
  /** @param {string} message @param {{status?: number, code?: string, path?: string}} [opts] */
  constructor(message, { status = 400, code, path: at } = {}) {
    super(message);
    this.name = 'BlockSettingsError';
    this.status = status;
    this.code = code;
    this.path = at;
  }
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const refuse = (code, message, at, status = 400) => new BlockSettingsError(message, { status, code, path: at });

/** What a block can do, from the contract block (block-flows.mjs), never from a per-screen copy. */
export function blockSupport(flowId) {
  const blocks = flowBlocks();
  if (typeof flowId !== 'string' || !Object.hasOwn(blocks, flowId)) return null;
  const executors = blocks[flowId].meta.executors;
  return { mechanical: executors.includes('deterministic'), ai: executors.includes('local-model'), offered: !Object.hasOwn(NOT_OFFERED, flowId) };
}

/**
 * Check one block's patch and reduce it to the fields that differ from the defaults. `null` means "back to the default".
 *
 * @param {string} flowId
 * @param {unknown} patch `{ enabled?, engine?, provider?, model? }`
 * @param {string} [at] Dotted path used in errors.
 * @returns {Record<string, any>} The normalised patch: a field set to `null` is to be removed.
 * @throws {BlockSettingsError}
 */
export function checkBlockPatch(flowId, patch, at = `blocks.${flowId}`) {
  const support = blockSupport(flowId);
  if (!support) throw refuse('BLOCK_UNKNOWN', `"${String(flowId).slice(0, 60)}" is not a block Construct has.`, at);
  if (!support.offered) throw refuse('BLOCK_NOT_OFFERED', `"${flowId}" is never offered in the Cockpit, so there is nothing to set for it.`, at);
  if (!isPlain(patch)) throw refuse('BLOCK_FIELD_INVALID', `The settings for "${flowId}" must be an object.`, at);
  const out = {};
  for (const [field, value] of Object.entries(patch)) {
    const here = `${at}.${field}`;
    if (!SETTING_FIELDS.includes(field)) throw refuse('BLOCK_FIELD_UNKNOWN', `"${field.slice(0, 40)}" is not a setting. Settings are: ${SETTING_FIELDS.join(', ')}.`, here);
    if (field === 'enabled') {
      if (typeof value !== 'boolean') throw refuse('BLOCK_FIELD_INVALID', `"enabled" for "${flowId}" must be true or false.`, here);
      out.enabled = value ? null : false;
    } else if (field === 'engine') {
      if (value !== null && !ENGINES.includes(value)) throw refuse('BLOCK_FIELD_INVALID', `"engine" must be one of ${ENGINES.join(', ')}.`, here);
      if (value === 'ai' && !support.ai) throw refuse('BLOCK_AI_UNSUPPORTED', `"${flowId}" has no model path, so its engine can only be Mechanical.`, here);
      if (value === 'mechanical' && !support.mechanical) throw refuse('BLOCK_ENGINE_UNSUPPORTED', `"${flowId}" is done by a person, so its engine cannot be Mechanical.`, here);
      out.engine = value === null || (value === 'mechanical' && support.mechanical) ? null : value;
    } else if (field === 'provider') {
      if (value !== null && typeof value !== 'string') throw refuse('BLOCK_FIELD_INVALID', '"provider" must be text or null.', here);
      if (value !== null && !support.ai) throw refuse('BLOCK_AI_UNSUPPORTED', `"${flowId}" has no model path, so it has no provider to choose.`, here);
      if (value !== null && value !== LOCAL_PROVIDER) throw refuse('BLOCK_PROVIDER_NOT_ALLOWED', `The Cockpit only runs a local model (${LOCAL_PROVIDER}); "${value.slice(0, 40)}" is not allowed.`, here);
      out.provider = null; // the one allowed provider is the default, so it is never stored
    } else {
      if (value !== null && typeof value !== 'string') throw refuse('BLOCK_FIELD_INVALID', '"model" must be text or null.', here);
      if (value !== null && !support.ai) throw refuse('BLOCK_AI_UNSUPPORTED', `"${flowId}" has no model path, so it has no model to choose.`, here);
      if (value !== null && (value.length > MAX_MODEL_CHARS || !MODEL_RE.test(value))) {
        throw refuse('BLOCK_FIELD_INVALID', `"model" must be a model name such as "qwen2.5-coder:7b" (letters, digits and . _ : / @ -, at most ${MAX_MODEL_CHARS} characters, not starting with a dash).`, here);
      }
      out.model = value === null || value === '' ? null : value;
    }
  }
  return out;
}

/** Check a whole patch, `{ '<flowId>': { ... } }`, before anything is saved. */
export function checkPatch(patch) {
  if (!isPlain(patch)) throw refuse('BLOCKS_INVALID', '"blocks" must be an object of block id to settings.', 'blocks');
  const ids = Object.keys(patch);
  if (ids.length > Object.keys(flowBlocks()).length) throw refuse('BLOCKS_INVALID', 'More blocks than Construct has.', 'blocks');
  return Object.fromEntries(ids.map((id) => [id, checkBlockPatch(id, patch[id])]));
}

/** Apply a checked patch to the stored `blocks`. A `null` field is removed; an entry left empty is removed. */
export function applyPatch(blocks, checked) {
  const next = Object.fromEntries(Object.entries(blocks).map(([id, s]) => [id, { ...s }]));
  for (const [id, fields] of Object.entries(checked)) {
    const entry = next[id] ?? {};
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) delete entry[field];
      else entry[field] = value;
    }
    if (Object.keys(entry).length) next[id] = entry;
    else delete next[id];
  }
  return next;
}

/** What a stored file may say, re-checked on read: unknown blocks, unknown fields and bad values are dropped, never
 * trusted. The one exception fails closed: an `enabled` that is anything but `true` reads as turned off. */
function sanitizeBlocks(raw) {
  const out = {};
  if (!isPlain(raw)) return out;
  for (const [id, entry] of Object.entries(raw)) {
    if (!isPlain(entry)) continue;
    const kept = {};
    for (const [field, value] of Object.entries(entry)) {
      try {
        const one = checkBlockPatch(id, { [field]: field === 'enabled' ? value === true : value });
        if (one[field] !== null && one[field] !== undefined) kept[field] = one[field];
      } catch { /* a tampered or stale entry is ignored */ }
    }
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

/** The effective settings of one block: what a screen shows and a step is prefilled from. */
export function effectiveSettings(flowId, blocks = {}) {
  const support = blockSupport(flowId);
  const own = Object.hasOwn(blocks, flowId) ? blocks[flowId] : {};
  return {
    enabled: own.enabled !== false,
    engine: support?.mechanical ? (own.engine === 'ai' && support.ai ? 'ai' : 'mechanical') : null,
    provider: support?.ai ? LOCAL_PROVIDER : null,
    model: support?.ai && typeof own.model === 'string' ? own.model : null,
  };
}

/** Absolute file holding one project's block settings: `<stateDir>/block-settings/<projectKey>.json`. */
export function blockSettingsFile(projectRoot, { stateDir = resolveStateDir() } = {}) {
  return path.join(stateDir, 'block-settings', `${projectKey(projectRoot)}.json`);
}

const EMPTY = () => ({ version: SETTINGS_VERSION, rev: 0, updatedAt: null, blocks: {} });

/**
 * Open the settings for one project. No in-memory cache: the file on disk IS the store, so a second Cockpit process
 * (or a restarted one) reads back exactly what was saved.
 *
 * @param {string} projectRoot
 * @param {{stateDir?: string, now?: () => string}} [options] State directory and clock (test seams).
 */
export function openBlockSettingsStore(projectRoot, { stateDir = resolveStateDir(), now = () => new Date().toISOString() } = {}) {
  const file = blockSettingsFile(projectRoot, { stateDir });

  /** `{ record, unreadable }`: a file that cannot be read is reported (and enforcement fails closed), not thrown. */
  const read = () => {
    if (!fs.existsSync(file)) return { record: EMPTY(), unreadable: null };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return { record: EMPTY(), unreadable: `unreadable: ${e.message}` };
    }
    if (!isPlain(parsed) || !Number.isInteger(parsed.rev) || parsed.rev < 0) return { record: EMPTY(), unreadable: 'unreadable: not a block settings record' };
    return { record: { version: SETTINGS_VERSION, rev: parsed.rev, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null, blocks: sanitizeBlocks(parsed.blocks) }, unreadable: null };
  };

  return {
    file,
    read,
    /** The blocks turned off for this project, for the plan check. `unreadable` is set when the file cannot be trusted. */
    disabledFlows() {
      const { record, unreadable } = read();
      return { flows: Object.entries(record.blocks).filter(([, s]) => s.enabled === false).map(([id]) => id), unreadable };
    },
    /**
     * Apply a patch: `{ rev, blocks: { '<flowId>': { enabled?, engine?, provider?, model? } } }`. The whole patch is
     * checked first; on any refusal nothing is written. A file that cannot be read has no rev to conflict with, so a
     * save replaces it (that is how a person recovers from a damaged file).
     *
     * @throws {BlockSettingsError}
     */
    update({ rev, blocks } = {}) {
      const checked = checkPatch(blocks);
      const { record, unreadable } = read();
      if (!unreadable) {
        if (rev === undefined || rev === null || rev === '') throw refuse('REV_REQUIRED', 'rev is required to save: reload the settings and try again.', 'rev');
        if (!Number.isInteger(rev) || rev < 0) throw refuse('REV_REQUIRED', 'rev must be the whole number the settings were loaded with.', 'rev');
        if (rev !== record.rev) throw refuse('STALE_REV', 'These settings changed elsewhere since they were loaded. Reload them and try again.', 'rev', 409);
      }
      const next = { version: SETTINGS_VERSION, rev: record.rev + 1, updatedAt: now(), blocks: applyPatch(record.blocks, checked) };
      atomicWriteJson(file, next);
      return next;
    },
  };
}
