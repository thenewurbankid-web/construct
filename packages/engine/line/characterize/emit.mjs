// iv2-tests -- the text of the characterization files Construct writes into the target app: the runtime copy, the probe
// files (run and deleted while generating) and the locked tests. Deterministic: the same subject, scenarios and recorded
// observations give byte-identical files. Every value reaches source through `lit` / `json` (escaped literals) or
// `comment` from testSpecRender.mjs, and every file starts with GENERATED_MARKER so a later run only ever overwrites its
// own files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lit, comment } from '../../testSpecRender.mjs';
import { GENERATED_MARKER } from '../../testGenerator.mjs';

/** The folder, next to the route, that holds the characterization tests. */
export const CHAR_DIR = '__line_characterization__';
/** The probe folder inside CHAR_DIR (exists only while generating). */
export const PROBE_DIR = '__probe__';
/** The runtime file's name in the target. */
export const RUNTIME_FILE = 'line-char-runtime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/**
 * A JSON value as a JS literal (JSON plus the two line separators JSON leaves raw).
 * @param {any} v A JSON-safe value.
 * @returns {string} Source text.
 */
export const json = (v) => JSON.stringify(v).split(LS).join('\\u2028').split(PS).join('\\u2029');

/**
 * True when a file's text was written by this generator (starts with the marker).
 * @param {string} text File contents.
 * @returns {boolean}
 */
export const isGenerated = (text) => String(text).startsWith(`${GENERATED_MARKER}\n`);

const posix = (p) => p.split(path.sep).join('/');

/**
 * `../../libs/x` from a test folder to an app file, extension dropped (jest resolves it like the app's own import).
 * @param {string} fromDirAbs Absolute folder of the test file.
 * @param {string} appRoot Absolute app root.
 * @param {string} relFile App-relative file.
 * @returns {string} A relative module specifier.
 */
export function moduleSpec(fromDirAbs, appRoot, relFile) {
  let r = posix(path.relative(fromDirAbs, path.join(appRoot, relFile))).replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  if (r.endsWith('/index')) r = r.slice(0, -6);
  return r.startsWith('.') ? r : `./${r}`;
}

/**
 * The runtime file as it lands in the target.
 * @returns {string} runtime.cjs with the generated-file marker on top.
 */
export function runtimeText() {
  const src = fs.readFileSync(path.join(HERE, 'runtime.cjs'), 'utf8');
  return `${GENERATED_MARKER}\n// Line characterization runtime, copied by Construct from packages/engine/line/characterize/runtime.cjs.\n${src}`;
}

/** The mock lines and ENV object every characterization file of one closure shares. */
function preamble(analysis, appRoot, dirAbs, runtimeRel) {
  const { env } = analysis;
  const L = [];
  for (const m of env.hookModules) {
    const spec = m.bare ?? moduleSpec(dirAbs, appRoot, m.file);
    const kinds = Object.fromEntries(Object.entries(m.hooks).map(([n, h]) => [n, h.kind]).sort(([a], [b]) => a.localeCompare(b)));
    L.push(`jest.mock(${lit(spec)}, () => require(${lit(runtimeRel)}).hookModuleMock(jest.requireActual(${lit(spec)}), ${json(kinds)}));`);
  }
  if (env.router.length) L.push(`jest.mock('next/navigation', () => require(${lit(runtimeRel)}).nextNavigationMock());`);
  L.push('');
  L.push(`const rt = require(${lit(runtimeRel)});`);
  const spies = env.spies.map((s) => `    [() => require(${lit(s.bare ? s.module : moduleSpec(dirAbs, appRoot, s.module))}), ${lit(s.exportName)}, ${lit(s.method)}],`);
  const hosts = env.hosts.map((h) => `    () => require(${lit(h.spec)})[${lit(h.exportName)}],`);
  L.push('const ENV = {');
  L.push(`  pathname: ${lit(env.pathname)},`);
  L.push('  spies: [', ...spies, '  ],');
  L.push('  hosts: [', ...hosts, '  ],');
  L.push(`  renderHelper: ${env.renderHelper ? `() => require(${lit(moduleSpec(dirAbs, appRoot, env.renderHelper.file))})[${lit(env.renderHelper.exportName)}]` : 'null'},`);
  L.push('};');
  return L;
}

function subjectGetter(subject, appRoot, dirAbs) {
  const spec = moduleSpec(dirAbs, appRoot, subject.file);
  const [head, ...rest] = subject.exportName.split('.');
  const access = [head, ...rest].map((p) => `[${lit(p)}]`).join('');
  return { importLine: `import * as LineSubject from ${lit(spec)};`, getter: `const subject = () => (LineSubject as any)${access};`, spec };
}

/**
 * A probe file: mode `fuzz` searches for scenarios, mode `record` observes chosen ones; both read their input from and
 * write their output to `$LINE_CHAR_DIR/<subject id>.<mode>.{in,out}.json`.
 * @param {{analysis: object, appRoot: string, dirAbs: string, subject: object, mode: 'fuzz'|'record', timeoutMs: number}} o
 * @returns {string} The probe's source.
 */
export function probeText({ analysis, appRoot, dirAbs, subject, mode, timeoutMs }) {
  const g = subjectGetter(subject, appRoot, dirAbs);
  const L = [
    GENERATED_MARKER,
    '// @ts-nocheck',
    `// Line characterization probe (${comment(mode)}) for ${comment(subject.exportName)} in ${comment(subject.file)}. Construct runs and deletes this file while generating.`,
    ...preamble(analysis, appRoot, dirAbs, `../${RUNTIME_FILE}`),
    g.importLine,
    g.getter,
    '',
    `test(${lit(`line probe ${mode} ${subject.id}`)}, async () => {`,
    `  const base = require('path').join(process.env.LINE_CHAR_DIR, ${lit(`${subject.id}.${mode}`)});`,
    "  const input = JSON.parse(require('fs').readFileSync(`${base}.in.json`, 'utf8'));",
    '  input.envRuntime = ENV;',
    `  await rt.${mode === 'fuzz' ? 'fuzz' : 'record'}(input, subject, \`\${base}.out.json\`);`,
    `}, ${Number(timeoutMs)});`,
    '',
  ];
  return L.join('\n');
}

const label = (sig) => {
  const [ev, tag, aria, text] = String(sig ?? '').split('|');
  const what = (aria || text || tag || '').trim().slice(0, 40);
  return `${String(ev).replace(/^on/, '').replace(/^win:/, 'window ').toLowerCase()}${what ? ` "${what}"` : ''}`;
};

const preview = (v) => {
  const s = JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
};

/**
 * A readable, unique-in-file title for a scenario.
 * @param {{kind: string, exportName: string}} subject
 * @param {object} sc The scenario.
 * @param {number} i Its index in the file.
 * @returns {string}
 */
export function scenarioTitle(subject, sc, i) {
  const n = String(i + 1).padStart(3, '0');
  if (subject.kind === 'pure') return `#${n} ${subject.exportName}(${(sc.args ?? []).map(preview).join(', ')})`;
  const steps = (sc.steps ?? []).map((s) => (s.ev === 'hook' ? `${s.name} changes` : s.ev === 'tick' ? `${s.v}ms pass` : s.ev === 'props' ? 'props change' : label(s.sig)));
  const hooks = Object.keys(sc.hooks ?? {}).length;
  const qs = Object.keys(sc.search ?? {});
  const head = subject.kind === 'hook' ? 'runs' : 'renders';
  const parts = [`#${n} ${head}`, hooks ? `${hooks} data hooks` : 'no data', qs.length ? `?${qs.join('&')}` : ''].filter(Boolean).join(' with ');
  const title = steps.length ? `${parts}, then ${steps.join(', then ')}` : parts;
  return title.length > 160 ? `${title.slice(0, 157)}...` : title;
}

/**
 * The kind of CharTest a scenario is.
 * @param {{kind: string}} subject
 * @param {{steps?: object[]}} sc
 * @returns {'pure'|'render'|'interaction'}
 */
export const testKind = (subject, sc) => (subject.kind === 'pure' ? 'pure' : (sc.steps ?? []).length ? 'interaction' : 'render');

/**
 * A locked test file: every scenario replayed and compared with what it did when generated.
 * @param {{analysis: object, appRoot: string, dirAbs: string, subject: object, cases: {title: string, scenario: object, expected: object[]}[]}} o
 * @returns {string} The test file's source.
 */
export function lockedText({ analysis, appRoot, dirAbs, subject, cases }) {
  const g = subjectGetter(subject, appRoot, dirAbs);
  const L = [
    GENERATED_MARKER,
    '// @ts-nocheck',
    `// Line characterization tests for ${comment(subject.exportName)} in ${comment(subject.file)}: they pin down what it does today, so`,
    '// moving or reshaping it into Line blocks must keep every observation (text, form values, data-hook arguments, effects).',
    '// Generated by Construct (packages/engine/line/characterize.mjs); regenerate instead of editing.',
    ...preamble(analysis, appRoot, dirAbs, `./${RUNTIME_FILE}`),
    g.importLine,
    g.getter,
    '',
    `describe(${lit(`Line characterization: ${subject.exportName} (${subject.file})`)}, () => {`,
    '  beforeEach(() => rt.beforeEachScenario(ENV));',
    '  afterEach(() => rt.afterEachScenario());',
  ];
  for (const c of cases) {
    L.push('');
    L.push(`  test(${lit(c.title)}, async () => {`);
    L.push(`    await rt.expectScenario(${lit(subject.kind)}, subject, ${json(c.scenario)}, ${json(c.expected)});`);
    L.push('  });');
  }
  L.push('});', '');
  return L.join('\n');
}
