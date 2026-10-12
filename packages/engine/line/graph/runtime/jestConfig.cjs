// G2: the app's own jest config with the recorder added (every transform wrapped by jestTransform.cjs, jestSetup.cjs
// appended to setupFilesAfterEnv). withRuntimeRecorder writes a one-line config file that calls wrapConfig, so the app's
// config file is never touched.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TRANSFORM = path.join(__dirname, 'jestTransform.cjs');
const SETUP = path.join(__dirname, 'jestSetup.cjs');
const CANDIDATES = ['jest.config.js', 'jest.config.cjs', 'jest.config.json'];

/** The app's jest config object: an explicit path, else jest.config.{js,cjs,json}, else package.json "jest", else {}. */
async function loadAppConfig(appRoot, configPath) {
  const file = configPath ? path.resolve(appRoot, configPath) : CANDIDATES.map((c) => path.join(appRoot, c)).find((c) => fs.existsSync(c));
  if (file) {
    if (/\.(ts|mjs)$/.test(file)) throw new Error(`The runtime recorder cannot read ${path.basename(file)}; give the app a jest.config.js or pass its config as JSON.`);
    let c = file.endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : require(file);
    if (c && c.__esModule && c.default) c = c.default;
    if (typeof c === 'function') c = await c();
    return { config: c ?? {}, dir: path.dirname(file) };
  }
  const pkg = path.join(appRoot, 'package.json');
  const fromPkg = fs.existsSync(pkg) ? JSON.parse(fs.readFileSync(pkg, 'utf8')).jest : undefined;
  return { config: fromPkg ?? {}, dir: appRoot };
}

/** Resolve a transformer name the way jest would, from the app. */
function resolveFrom(dir, name) {
  return require.resolve(name, { paths: [dir] });
}

/**
 * @param {{appRoot: string, files: string[], configPath?: string}} o
 * @returns {Promise<object>} A jest config.
 */
async function wrapConfig(o) {
  const { config, dir } = await loadAppConfig(o.appRoot, o.configPath);
  if (config.projects) throw new Error('The runtime recorder does not wrap a multi-project jest config yet; run it on one project.');
  const rootDir = path.resolve(dir, config.rootDir ?? '.');
  let transform = config.transform;
  if (!transform) transform = { '\\.[jt]sx?$': 'babel-jest' };
  if (config.preset && !config.transform) {
    // a preset's transform (ts-jest's) is merged by jest after this file is read; name it here so it can be wrapped
    try {
      const presetFile = resolveFrom(rootDir, `${config.preset}/jest-preset`);
      transform = require(presetFile).transform ?? transform;
    } catch { /* keep babel-jest */ }
  }
  const wrapped = {};
  for (const [pattern, entry] of Object.entries(transform)) {
    const [name, opts] = Array.isArray(entry) ? entry : [entry, {}];
    const resolved = resolveFrom(rootDir, name.replace(/<rootDir>/g, rootDir));
    wrapped[pattern] = [TRANSFORM, { inner: [resolved, opts ?? {}], appRoot: o.appRoot, files: o.files }];
  }
  return { ...config, rootDir, transform: wrapped, setupFilesAfterEnv: [...(config.setupFilesAfterEnv ?? []).map((s) => s.replace(/<rootDir>/g, rootDir)), SETUP] };
}

module.exports = { wrapConfig, loadAppConfig, TRANSFORM, SETUP };
