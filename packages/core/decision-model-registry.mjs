// #647 (epic #616) -- importing a verified model bundle, replaying it against the rules baseline, and the per-project MODEL REGISTRY
// in the state directory (`<state dir>/models/<project key>/registry.json` and one folder of verified files per model):
//
//   importModel(root, dir, { yes })   verify (decision-model-bundle.mjs), replay the HELD-OUT test records of the export the model
//                                     was trained from, print the comparison with the rules baseline; with `yes`, store it DISABLED
//   listModels / removeModel          the registry
//   setModelEnabled                   the owner's explicit act: flips one flag in the state directory; `architecture.yml` is never edited
//   loadRegisteredModelProvider       the provider of an ENABLED, loadable model (typed refusal otherwise)
//   registeredModelProvider           the same as a plugin-file default export: it asks the registry on EVERY suggestion, so enabling,
//                                     disabling, removing or re-importing takes effect without a restart, and a model that is not
//                                     usable makes the suggestion fail, which the decision seam answers with the rules provider
//
// What is guaranteed: nothing in the bundle is executed (only JSON is parsed; only a `features.json` (decision-features.mjs) or a
// `prototypes.json` (decision-prototypes.mjs, #645) is loaded, by a pure scorer); an imported model is DISABLED until the owner enables it; the replay is the same yardstick as
// `construct traces replay` (`replayTraces`), on records the model never saw; a model that loses is stored and reported as losing,
// never promoted. `decision:` in `architecture.yml` is NEVER written by anything here. A model kind with no loader in this version
// (`model.onnx`) is verified and stored, not replayed, and cannot be enabled; the report says so.
// No network. Every failure is `{ ok: false, code, message }`. Decision record: docs/TRAIN-ELSEWHERE.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStateDir, projectKey } from '../engine/processStore.mjs';
import { readTraces } from './decision-trace-store.mjs';
import { findExport } from './decision-dataset.mjs';
import { verifyModelBundle, MODEL_VERSION_PATTERN } from './decision-model-bundle.mjs';
import { validateFeaturesModel, createFeaturesProvider } from './decision-features.mjs';
import { validatePrototypesModel, createPrototypesProvider } from './decision-prototypes.mjs';
import { getDecisionProvider, registerDecisionProvider, unregisterDecisionProvider } from './decision-provider.mjs';
import { replayTraces, DEFAULT_MIN_TRACES } from './decision-trace-replay.mjs';
import { PROVIDER_NAME_PATTERN } from './decision-plugin.mjs';

const fail = (code, message) => ({ ok: false, code, message });
const errText = (e) => `${e?.code ? `${e.code}: ` : ''}${String(e?.message ?? e).split('\n')[0]}`.slice(0, 160);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
const asPath = (root) => (root instanceof URL ? fileURLToPath(root) : String(root));

/** The model kinds this version can load (`onnx` cannot): the kind's file, its validator and the provider it makes. */
const LOADERS = {
  features: { file: 'features.json', validate: validateFeaturesModel, provider: createFeaturesProvider },
  prototypes: { file: 'prototypes.json', validate: validatePrototypesModel, provider: createPrototypesProvider },
};
const loaderOf = (kind) => (Object.hasOwn(LOADERS, kind) ? LOADERS[kind] : null);

/**
 * The directory of a project's model registry: `<state dir>/models/<project key>`.
 *
 * @param {string | URL} root The project root.
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory (default `resolveStateDir`).
 * @returns {string} Absolute path (outside the project).
 *
 * @example
 * modelsDir('/work/web', { stateDir: '/var/state' }); // => '/var/state/models/web-<hash>'
 */
export function modelsDir(root, options = {}) {
  return path.join(options.stateDir ?? resolveStateDir(options.env ?? process.env), 'models', projectKey(asPath(root)));
}

/**
 * @typedef {{ name: string, version: string, kind: string, loadable: boolean, enabled: boolean, datasetHash: string, createdAt: string, importedAt: string, files: Record<string, { sha256: string, bytes: number }>, replay: { verdict: string, persons: number, hits: number, agreement: number | null, baselineAgreement: number | null, coverage: number | null, heldOut: { expected: number, found: number } } | null }} ModelEntry
 * One registered model. `enabled` is false until the owner enables it; `replay` is the held-out comparison made at import (null when there was no loader).
 */

/**
 * Read the registry of a project. A missing or unreadable registry is an empty one. Never throws.
 *
 * @param {string | URL} root The project root.
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory.
 * @returns {{ dir: string, models: ModelEntry[] }} The registered models, by name.
 *
 * @example
 * readModelRegistry(root).models.map((m) => `${m.name}@${m.version} ${m.enabled ? 'on' : 'off'}`);
 */
export function readModelRegistry(root, options = {}) {
  const dir = modelsDir(root, options);
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'));
    const models = (Array.isArray(parsed?.models) ? parsed.models : []).filter((m) => typeof m?.name === 'string' && PROVIDER_NAME_PATTERN.test(m.name) && typeof m.version === 'string' && MODEL_VERSION_PATTERN.test(m.version));
    return { dir, models };
  } catch {
    return { dir, models: [] };
  }
}

function writeRegistry(dir, models) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.registry.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, models }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, 'registry.json'));
}

/** Replay the held-out records of the export the model came from through the model and the rules baseline (same yardstick as `traces replay`). */
async function replayHeldOut(root, verified, exported, options) {
  if (!verified.loadable) return { ran: false, note: verified.notes[0] ?? 'This model kind has no loader in this version, so it was not replayed.' };
  const ids = new Set(exported.testIds);
  const decisions = readTraces(root, options).decisions.filter((d) => ids.has(d.id));
  if (!decisions.length) return { ran: false, note: `None of the ${ids.size} held-out records of that export is in the trace store any more (rotated or deleted), so the model could not be replayed.` };
  const name = verified.manifest.name;
  if (getDecisionProvider(name)) return { ran: false, error: fail('MODEL_NAME_TAKEN', `A decision provider named "${name}" is already registered in this process; it cannot be replayed under that name.`) };
  registerDecisionProvider(name, loaderOf(verified.kind).provider(verified.model, { name, version: verified.manifest.version }));
  try {
    const report = await replayTraces(decisions, { provider: name, baseline: 'rules', minTraces: options.minTraces ?? DEFAULT_MIN_TRACES });
    if (!report.ok) return { ran: false, error: fail('MODEL_REPLAY_FAILED', report.error) };
    return { ran: true, report, heldOut: { expected: ids.size, found: decisions.length } };
  } finally {
    unregisterDecisionProvider(name);
  }
}

const summaryOf = (replay) => {
  const o = replay.report.overall;
  return { verdict: o.verdict, persons: o.persons, hits: o.hits, agreement: o.agreement, baselineAgreement: o.baseline.agreement, coverage: o.coverage, heldOut: replay.heldOut };
};

/**
 * Import a model bundle trained elsewhere: VERIFY it (`verifyModelBundle`: plain data only, checksums, schema versions, a dataset
 * this project exported), REPLAY the held-out test records of that export against the rules baseline (only for a model kind this
 * version can load: `features.json`), and, with `yes`, REGISTER it in the state directory DISABLED. Without `yes` nothing is
 * stored. Nothing in the bundle is executed; `architecture.yml` is never touched. A model with the same name replaces the
 * registered one and comes back disabled.
 *
 * @param {string} root The project root.
 * @param {string} dir The model bundle folder.
 * @param {{ yes?: boolean, minTraces?: number, now: string, stateDir?: string, env?: Record<string, string | undefined> }} options `yes` to store it, the minimum person-made traces for `promotable`, the injected clock, the state directory.
 * @returns {Promise<{ ok: true, registered: boolean, replaced: string | null, manifest: object, kind: string, loadable: boolean, notes: string[], evalReport: object, replay: object | null, replayNote: string | null, entry: ModelEntry } | { ok: false, code: string, message: string }>} The verification, the comparison and whether it was stored; or the typed refusal.
 *
 * @example
 * const r = await importModel(root, 'model-out', { yes: false, now: new Date().toISOString() });
 * r.replay.overall.verdict; // => 'beats' | 'ties' | 'loses'
 */
export async function importModel(root, dir, options) {
  try {
    const verified = verifyModelBundle(dir, { findExport: (hash) => findExport(root, hash, options) });
    if (!verified.ok) return verified;
    const exported = findExport(root, verified.manifest.datasetHash, options);
    const replay = await replayHeldOut(root, verified, exported, options);
    if (replay.error) return replay.error;
    const m = verified.manifest;
    const entry = {
      name: m.name,
      version: m.version,
      kind: verified.kind,
      loadable: verified.loadable,
      enabled: false,
      datasetHash: m.datasetHash,
      createdAt: m.createdAt,
      importedAt: options.now,
      files: Object.fromEntries(Object.keys(verified.files).map((n) => [n, { sha256: sha256(verified.files[n]), bytes: verified.files[n].length }])),
      replay: replay.ran ? summaryOf(replay) : null,
    };
    const base = { ok: true, registered: false, replaced: null, manifest: m, kind: verified.kind, loadable: verified.loadable, notes: verified.notes, evalReport: verified.evalReport, replay: replay.ran ? replay.report : null, replayNote: replay.ran ? null : replay.note, entry };
    if (!options.yes) return base;

    const registry = readModelRegistry(root, options);
    const previous = registry.models.find((x) => x.name === m.name) ?? null;
    const target = path.join(registry.dir, m.name);
    if (path.dirname(target) !== registry.dir) return fail('MODEL_REGISTER_FAILED', 'The model name is not a plain folder name.');
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const [name, data] of Object.entries(verified.files)) fs.writeFileSync(path.join(target, name), data, { flag: 'wx', mode: 0o600 });
    writeRegistry(registry.dir, [...registry.models.filter((x) => x.name !== m.name), entry].sort((a, b) => (a.name < b.name ? -1 : 1)));
    return { ...base, registered: true, replaced: previous ? `${previous.name}@${previous.version}` : null };
  } catch (e) {
    return fail('MODEL_REGISTER_FAILED', `The model could not be stored (${errText(e)}).`);
  }
}

/**
 * The registered models of a project (`readModelRegistry`), as the `model list` command shows them.
 *
 * @param {string} root The project root.
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory.
 * @returns {{ ok: true, models: ModelEntry[] }} The models.
 *
 * @example
 * listModels(root).models.length; // => 1
 */
export function listModels(root, options = {}) {
  return { ok: true, models: readModelRegistry(root, options).models };
}

/**
 * Remove a registered model: its folder and its registry entry (state directory only; nothing in the project changes). A project
 * plugin file that still names it will fail to load and the rules provider answers instead.
 *
 * @param {string} root The project root.
 * @param {string} name The registered model's name.
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory.
 * @returns {{ ok: true, removed: string } | { ok: false, code: string, message: string }} What was removed, or `MODEL_NOT_FOUND`.
 *
 * @example
 * removeModel(root, 'features-lr'); // => { ok: true, removed: 'features-lr@1-3fa9c2d1' }
 */
export function removeModel(root, name, options = {}) {
  try {
    const registry = readModelRegistry(root, options);
    const found = registry.models.find((m) => m.name === name);
    if (!found) return fail('MODEL_NOT_FOUND', `No model named ${JSON.stringify(String(name).slice(0, 40))} is registered. Registered: ${registry.models.map((m) => m.name).join(', ') || 'none'}.`);
    writeRegistry(registry.dir, registry.models.filter((m) => m.name !== name));
    fs.rmSync(path.join(registry.dir, found.name), { recursive: true, force: true });
    return { ok: true, removed: `${found.name}@${found.version}` };
  } catch (e) {
    return fail('MODEL_REGISTER_FAILED', `The model could not be removed (${errText(e)}).`);
  }
}

/**
 * Enable or disable a registered model: the owner's explicit act. It flips ONE flag in the registry (state directory); it does
 * not edit `architecture.yml` and does not write a plugin file. A model with no loader (`model.onnx`, `prototypes.json`) cannot
 * be enabled. The project's plugin file (docs/TRAIN-ELSEWHERE.md) loads only an enabled model.
 *
 * @param {string} root The project root.
 * @param {string} name The registered model's name.
 * @param {boolean} enabled The new state.
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory.
 * @returns {{ ok: true, entry: ModelEntry } | { ok: false, code: string, message: string }} The entry, or `MODEL_NOT_FOUND` / `MODEL_NOT_LOADABLE`.
 *
 * @example
 * setModelEnabled(root, 'features-lr', true).entry.enabled; // => true
 */
export function setModelEnabled(root, name, enabled, options = {}) {
  try {
    const registry = readModelRegistry(root, options);
    const found = registry.models.find((m) => m.name === name);
    if (!found) return fail('MODEL_NOT_FOUND', `No model named ${JSON.stringify(String(name).slice(0, 40))} is registered.`);
    if (enabled && !found.loadable) return fail('MODEL_NOT_LOADABLE', `${found.name} is a "${found.kind}" model: this version can verify and store it but has no loader for it, so it cannot be enabled.`);
    const entry = { ...found, enabled };
    writeRegistry(registry.dir, registry.models.map((m) => (m.name === name ? entry : m)));
    return { ok: true, entry };
  } catch (e) {
    return fail('MODEL_REGISTER_FAILED', `The model could not be updated (${errText(e)}).`);
  }
}

/**
 * The decision provider of a registered model, for the project plugin file that names it (docs/TRAIN-ELSEWHERE.md, "Enable it").
 * Refuses (typed, no throw) when the model is not registered, is DISABLED, has no loader, or its stored files no longer match
 * the hashes recorded at import (`MODEL_TAMPERED`). Reads plain JSON and scores it in pure JavaScript; nothing is executed.
 *
 * @param {string} name The registered model's name (the provider name).
 * @param {{ root: string | URL, stateDir?: string, env?: Record<string, string | undefined>, requireEnabled?: boolean }} options The project root (a path or the `URL` of the project folder) and the state directory; `requireEnabled: false` also loads a model that is still DISABLED, for offline scoring only (`construct traces replay --model`), never for a project plugin.
 * @returns {{ ok: true, provider: { name: string, version: string, suggest: (summary: object) => object | null } } | { ok: false, code: string, message: string }} The provider, or why not.
 *
 * @example
 * const loaded = loadRegisteredModelProvider('features-lr', { root: new URL('..', import.meta.url) });
 * export default loaded.provider;
 */
export function loadRegisteredModelProvider(name, options) {
  try {
    const root = asPath(options.root);
    const registry = readModelRegistry(root, options);
    const entry = registry.models.find((m) => m.name === name);
    if (!entry) return fail('MODEL_NOT_FOUND', `No model named ${JSON.stringify(String(name).slice(0, 40))} is registered for this project.`);
    if (options.requireEnabled !== false && !entry.enabled) return fail('MODEL_DISABLED', `The model ${name} is registered but disabled. Enable it with: construct model enable ${name}`);
    const loader = loaderOf(entry.kind);
    if (!entry.loadable || !loader) return fail('MODEL_NOT_LOADABLE', `The model ${name} is a "${entry.kind}" model and this version has no loader for it.`);
    const file = path.join(registry.dir, entry.name, loader.file);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > 8 * 1024 * 1024) return fail('MODEL_TAMPERED', `The stored files of ${name} are not what was imported.`);
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== entry.files[loader.file]?.sha256) return fail('MODEL_TAMPERED', `The stored ${loader.file} of ${name} does not match the hash recorded at import; re-import it.`);
    const model = JSON.parse(bytes.toString('utf8'));
    const checked = loader.validate(model);
    if (!checked.ok) return fail('MODEL_TAMPERED', `The stored ${loader.file} of ${name} is not valid any more.`);
    return { ok: true, provider: loader.provider(model, { name: entry.name, version: entry.version }) };
  } catch (e) {
    return fail('MODEL_NOT_LOADABLE', `The model could not be loaded (${errText(e)}).`);
  }
}

/**
 * The recorded decisions a registered model has NOT seen: the held-out test records of the export it was built from, plus every
 * decision recorded after that export. Scoring a model on the records it was built from would flatter it, so `construct traces
 * replay --model` uses this unless `--all` is given.
 *
 * @param {string} root The project root.
 * @param {string} name The registered model's name.
 * @param {{ id: string, at: string }[]} decisions The recorded decisions (`readTraces`).
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory.
 * @returns {{ ok: true, decisions: object[], heldOut: number, later: number, exportedAt: string } | { ok: false, code: string, message: string }} The unseen decisions and how many of each kind, or `MODEL_NOT_FOUND` / `MODEL_DATASET_UNKNOWN`.
 *
 * @example
 * unseenByModel(root, 'layer-proto', readTraces(root).decisions).decisions.length; // => 13
 */
export function unseenByModel(root, name, decisions, options = {}) {
  const entry = readModelRegistry(root, options).models.find((m) => m.name === name);
  if (!entry) return fail('MODEL_NOT_FOUND', `No model named ${JSON.stringify(String(name).slice(0, 40))} is registered.`);
  const exported = findExport(root, entry.datasetHash, options);
  if (!exported) return fail('MODEL_DATASET_UNKNOWN', 'The export ledger no longer knows the dataset this model was built from, so its held-out records cannot be told apart.');
  const ids = new Set(exported.testIds);
  const heldOut = decisions.filter((d) => ids.has(d.id));
  const later = decisions.filter((d) => !ids.has(d.id) && Date.parse(d.at) > Date.parse(exported.createdAt));
  const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);
  return { ok: true, decisions: [...heldOut, ...later].sort(byTime), heldOut: heldOut.length, later: later.length, exportedAt: exported.createdAt };
}

/**
 * The provider a project's plugin file default-exports to use a registered model (docs/TRAIN-ELSEWHERE.md, "Enable it"):
 * `{ name, version, suggest }` whose `suggest` consults the registry on every call (a small file read; the parsed model is reused
 * while the stored file is unchanged). A model that is not registered, is DISABLED, has no loader or no longer matches its recorded
 * hash makes `suggest` throw a path-free message; the decision seam (`openDecision`) then answers with the rules provider and says
 * why, so the person never waits on a broken model and enabling or removing a model needs no restart.
 *
 * @param {string} name The registered model's name; it must also be the `decision.provider` of `architecture.yml`.
 * @param {{ root: string | URL, stateDir?: string, env?: Record<string, string | undefined> }} options The project root (a path or the `URL` of the project folder) and the state directory.
 * @returns {{ name: string, version: string, suggest: (summary: object) => object | null }} The provider (its `version` is read from the registry each time it is asked).
 *
 * @example
 * // tools/decision-model.mjs in the project
 * export default registeredModelProvider('features-lr', { root: new URL('..', import.meta.url) });
 */
export function registeredModelProvider(name, options) {
  let cached = null;
  const current = () => {
    const root = asPath(options.root);
    const entry = readModelRegistry(root, options).models.find((m) => m.name === name);
    let stamp = 'none';
    try {
      const file = loaderOf(entry?.kind)?.file ?? 'features.json';
      const st = fs.statSync(path.join(modelsDir(root, options), name, file));
      stamp = `${st.mtimeMs}:${st.size}:${entry?.files?.[file]?.sha256 ?? ''}:${entry?.enabled}`;
    } catch {
      // not stored: loadRegisteredModelProvider says so
    }
    if (cached?.stamp === stamp) return cached.provider;
    const loaded = loadRegisteredModelProvider(name, options);
    if (!loaded.ok) throw new Error(loaded.message);
    cached = { stamp, provider: loaded.provider };
    return loaded.provider;
  };
  return {
    name,
    get version() {
      const v = readModelRegistry(asPath(options.root), options).models.find((m) => m.name === name)?.version;
      return typeof v === 'string' ? v : '0';
    },
    suggest: (summary) => current().suggest(summary),
  };
}

const line = (label, m) => `${label.padEnd(16)} persons ${String(m.persons).padEnd(4)} agreement ${pct(m.agreement).padEnd(7)} when answered ${pct(m.agreementWhenAnswered).padEnd(7)} coverage ${pct(m.coverage)}`;

/**
 * The plain-text result of `construct model import`: what was verified, the held-out comparison with the rules baseline, and
 * what happened to the model (stored DISABLED, or nothing stored yet).
 *
 * @param {Extract<Awaited<ReturnType<typeof importModel>>, { ok: true }>} result A successful `importModel` result.
 * @returns {string} The text.
 *
 * @example
 * console.log(renderImport(await importModel(root, dir, { now })));
 */
export function renderImport(result) {
  const m = result.manifest;
  const lines = [`Verified model ${m.name}@${m.version} (${result.kind}): plain data only, checksums and manifest agree, schema ${m.traceVersion}, trained on a dataset this project exported (${m.datasetHash.slice(0, 12)}).`];
  lines.push(`Files: ${Object.entries(result.entry.files).map(([n, f]) => `${n} ${f.bytes}B`).join(', ')}`);
  for (const n of result.notes) lines.push(n);
  if (result.replay) {
    const o = result.replay.overall;
    lines.push('', `Replay of the held-out test records (${result.entry.replay.heldOut.found} of ${result.entry.replay.heldOut.expected} found in the trace store) against the rules baseline:`);
    for (const [id, r] of Object.entries(result.replay.byChooser)) lines.push(`  ${id}`, `    ${line(m.name, r)}`, `    ${line('rules', r.baseline)}`, `    verdict: ${r.verdict}`);
    lines.push(`  overall`, `    ${line(m.name, o)}`, `    ${line('rules', o.baseline)}`, `    verdict: ${o.verdict}; ${o.reason}`);
  } else lines.push('', `Not replayed: ${result.replayNote}`);
  lines.push('');
  if (result.registered) lines.push(`Registered as a decision provider in the state directory, DISABLED${result.replaced ? ` (it replaced ${result.replaced})` : ''}. architecture.yml was not touched. To use it, see docs/TRAIN-ELSEWHERE.md, "Enable it".`);
  else lines.push('PREVIEW: nothing is stored. Add --yes to register it (disabled).');
  return lines.join('\n');
}

/**
 * The plain-text list of registered models.
 *
 * @param {ModelEntry[]} models The registry entries.
 * @returns {string} The text.
 *
 * @example
 * console.log(renderModelList(listModels(root).models));
 */
export function renderModelList(models) {
  if (!models.length) return 'No models are registered. Train one elsewhere (docs/TRAIN-ELSEWHERE.md) and run construct model import <folder>.';
  return models.map((m) => `${m.name}@${m.version}  ${m.kind}  ${m.enabled ? 'ENABLED' : 'disabled'}${m.loadable ? '' : '  (no loader in this version)'}  dataset ${m.datasetHash.slice(0, 12)}  ${m.replay ? `held-out: ${m.replay.verdict}, agreement ${pct(m.replay.agreement)} vs rules ${pct(m.replay.baselineAgreement)}` : 'not replayed'}`).join('\n');
}
