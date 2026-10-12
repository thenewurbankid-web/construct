// G2, Line's runtime call graph: record what the tests actually run, merge it into the knowledge graph's runtime layer.
//
// Mechanisms (where each is used):
//   jest (characterization runs, the target app's own tests): jest has its own module system, so load hooks do not
//     see its requires. withRuntimeRecorder(jestArgs) points jest at a generated config = the app's config with every
//     transform wrapped by jestTransform.cjs (instruments the target files) and jestSetup.cjs appended to
//     setupFilesAfterEnv (the recorder, fetch, test names, writing the records).
//   plain node (node:test, scripts): `node --import <REGISTER_PATH>`, module.registerHooks (Node >= 22.15 / 23.5).
//
// Integration points (others own characterize/emit.mjs and runtime.cjs; nothing there is edited):
//   withRuntimeRecorder(jestArgs, {appRoot, files, workDir}) -> {args, env, recordsDir, read()}: add `args` to the jest
//     argv and `env` to its environment (characterize.mjs runJest's spawn), then `read()` the records.
//   runtimeCoverage(map, records) -> "reached at runtime" per unit, beside istanbul's UnitCoverage.
//   mergeRuntime(graph, records, {map}) -> CALLED_AT_RUNTIME edges for G1's graph.
//   For Fix 2 (mocks follow moves): every record names its callee by module identity {file, name} and marks jest mocks
//     `mocked: true`; resolveRef falls back to the export's name when the file moved, so a mock's target can be
//     re-pointed from the caller -> callee pairs recorded before the move.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RUNTIME_ENV } from './contract.mjs';

const require = createRequire(import.meta.url);
const recorderCjs = require('./recorder.cjs');

export const shapeOf = recorderCjs.shapeOf;
export const urlPattern = recorderCjs.urlPattern;
export const createRecorder = recorderCjs.createRecorder;
export { mergeRuntime, runtimeCoverage, resolveRef } from './merge.mjs';
export { RUNTIME_EDGE_TYPE, RUNTIME_LAYER, RUNTIME_ENV, unitNodeId } from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `node --import` this file to record a plain node process. */
export const REGISTER_PATH = path.join(HERE, 'register.mjs');
const JEST_CONFIG = path.join(HERE, 'jestConfig.cjs');

/**
 * Every record written under a folder (by jestSetup.cjs or register.mjs).
 * @param {string} dir
 * @returns {import('./contract.mjs').RuntimeRecord[]}
 */
export function readRuntimeRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/**
 * Jest argv and env that record the run. The app's own config (`--config` in `jestArgs`, else jest.config.{js,cjs,json}
 * or package.json "jest") is wrapped, never edited.
 * @param {string[]} jestArgs
 * @param {{appRoot: string, files: string[], workDir?: string}} o `files`: app-relative files to instrument.
 * @returns {{args: string[], env: Record<string, string>, recordsDir: string, configPath: string, read: () => import('./contract.mjs').RuntimeRecord[]}}
 */
export function withRuntimeRecorder(jestArgs, o) {
  const workDir = o.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'line-runtime-'));
  const recordsDir = path.join(workDir, 'runtime-records');
  fs.rmSync(recordsDir, { recursive: true, force: true });
  const args = [...jestArgs];
  let appConfig;
  const at = args.findIndex((a) => a === '--config' || a === '-c' || a.startsWith('--config='));
  if (at >= 0) {
    if (args[at].startsWith('--config=')) { appConfig = args[at].slice('--config='.length); args.splice(at, 1); }
    else { appConfig = args[at + 1]; args.splice(at, 2); }
    if (appConfig?.trim().startsWith('{')) throw new Error('The runtime recorder needs the jest config as a file, not inline JSON.');
  }
  const configPath = path.join(workDir, 'line-runtime.jest.config.cjs');
  const files = o.files.map((f) => f.split(path.sep).join('/'));
  fs.writeFileSync(configPath, `module.exports = () => require(${JSON.stringify(JEST_CONFIG)}).wrapConfig(${JSON.stringify({ appRoot: o.appRoot, files, configPath: appConfig })});\n`);
  args.push('--config', configPath);
  const env = { [RUNTIME_ENV.dir]: recordsDir, [RUNTIME_ENV.root]: o.appRoot, [RUNTIME_ENV.files]: files.join(',') };
  return { args, env, recordsDir, configPath, read: () => readRuntimeRecords(recordsDir) };
}
