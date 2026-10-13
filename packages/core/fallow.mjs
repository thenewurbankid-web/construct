// fallow block (#924): wraps the OSS analyzer fallow (https://github.com/fallow-rs/fallow, MIT, npm
// `fallow`, pinned exact in package.json) so `construct validate` also reports dead code and complexity
// it does not compute itself. Construct runs two fallow commands on a project root --
// `fallow dead-code --format json` and `fallow health --format json` -- and maps the findings into the
// same violation shape every enforcer produces (diagnostics.mjs), with `FALLOW-*` rule ids, severity
// `warning`, and fallow's own stable fingerprint kept on each finding.
//
// What stays OFF, on purpose: fallow's architecture/boundaries and policy detectors (Construct's own
// validator is the authority for layer rules -- any boundary/policy finding a user's fallow config
// produces is dropped here), the similar-code model (`fallow similar-code` is never invoked),
// `--type-aware` (never passed), and telemetry (FALLOW_TELEMETRY_DISABLED=1 and DO_NOT_TRACK=1 on every
// run, on top of fallow's own off-by-default). `--no-cache` keeps a validate read-only: fallow writes
// no cache folder into the user's project.
//
// Never a crash: no binary is an `unavailable` result with one message, a run that times out or prints
// something that is not JSON is a `failed` result with the reason; neither throws.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { assertValidViolation } from './diagnostics.mjs';

/** The fallow version Construct pins and maps (package.json devDependencies). */
export const FALLOW_VERSION = '3.33.1';
/** Env var naming a fallow binary to run instead of the resolved one (tests, a system install). */
export const FALLOW_BIN_ENV = 'CONSTRUCT_FALLOW_BIN';
const DEFAULT_TIMEOUT_MS = 120_000;
const DOCS_URL = 'https://fallow.tools/docs/';
const INSTALL_HINT = `npm i -D fallow@${FALLOW_VERSION}`;

/**
 * Every FALLOW-* rule this block can report: id, the fallow issue it comes from, module, and why it matters.
 * `module` uses diagnostics.mjs's fixed set: an unresolved import or an import cycle is about how units
 * connect (architecture); unused code and complexity are about what a reader has to carry (readability).
 */
export const FALLOW_RULES = {
  'FALLOW-UNUSED-EXPORT': { module: 'readability', why: 'An export nothing imports is dead surface: readers and generators treat it as API that must keep working.' },
  'FALLOW-UNUSED-FILE': { module: 'readability', why: 'A file no entry point reaches is never run: it is either dead or not wired into a route yet.' },
  'FALLOW-UNUSED-DEPENDENCY': { module: 'readability', why: 'A declared package nothing imports costs install time and audit surface for nothing.' },
  'FALLOW-UNUSED-PROP': { module: 'readability', why: 'A component prop the component never reads misleads every caller that passes it.' },
  'FALLOW-UNRESOLVED-IMPORT': { module: 'architecture', why: 'An import that resolves to no file or package fails at build or run time.' },
  'FALLOW-CYCLE': { module: 'architecture', why: 'Modules that import each other in a cycle can see each other half-initialized and cannot be understood one at a time.' },
  'FALLOW-DUPLICATE': { module: 'readability', why: 'The same export name from several modules makes an import ambiguous to readers and to tooling.' },
  'FALLOW-COMPLEXITY-CYCLOMATIC': { module: 'readability', why: 'Too many independent paths through one function: each one needs its own test and its own reading.' },
  'FALLOW-COMPLEXITY-COGNITIVE': { module: 'readability', why: 'Nesting and breaks in flow make this function hard to follow, whatever its path count.' },
  'FALLOW-CRAP': { module: 'readability', why: 'Complex and (by fallow\'s static estimate) untested: the riskiest code to change.' },
};

/** Which health `exceeded` value maps to which rules (one HealthFinding can exceed several thresholds). */
const HEALTH_EXCEEDED = {
  cyclomatic: ['FALLOW-COMPLEXITY-CYCLOMATIC'],
  cognitive: ['FALLOW-COMPLEXITY-COGNITIVE'],
  both: ['FALLOW-COMPLEXITY-CYCLOMATIC', 'FALLOW-COMPLEXITY-COGNITIVE'],
  crap: ['FALLOW-CRAP'],
  cyclomatic_crap: ['FALLOW-COMPLEXITY-CYCLOMATIC', 'FALLOW-CRAP'],
  cognitive_crap: ['FALLOW-COMPLEXITY-COGNITIVE', 'FALLOW-CRAP'],
  all: ['FALLOW-COMPLEXITY-CYCLOMATIC', 'FALLOW-COMPLEXITY-COGNITIVE', 'FALLOW-CRAP'],
};

const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const str = (v, fallback = '') => (typeof v === 'string' && v ? v : fallback);
const num = (v, fallback = 1) => (Number.isFinite(v) && v > 0 ? v : fallback);

function violation(rule, { file, line, message, fingerprint, suggestedFix }) {
  const v = {
    rule,
    module: FALLOW_RULES[rule].module,
    severity: 'warning',
    file: str(file, '.'),
    line: num(line),
    message,
    why: FALLOW_RULES[rule].why,
    expected: [],
    suggestedFix,
    docsUrl: DOCS_URL,
    fingerprint: fingerprint || null,
    source: 'fallow',
  };
  assertValidViolation(v);
  return v;
}

/** The first action's description (fallow's own suggested fix), when it gives one. */
const fixOf = (f) => str(arr(f.actions)[0]?.description) || undefined;

/**
 * Map one `fallow dead-code --format json` document to Construct violations. Unknown fields are ignored;
 * a missing array or field never throws (a finding without a path is reported against `.` line 1).
 * Boundary, policy and every other category outside FALLOW_RULES are dropped on purpose.
 *
 * @param {any} doc Parsed dead-code JSON (any shape: a non-object yields `[]`).
 * @returns {object[]} Violations, in fallow's category order.
 */
export function mapDeadCode(doc) {
  if (!doc || typeof doc !== 'object') return [];
  const out = [];
  const fp = (f) => str(f.finding_id) || null;
  for (const f of [...arr(doc.unused_exports), ...arr(doc.unused_types)]) {
    out.push(violation('FALLOW-UNUSED-EXPORT', { file: f.path, line: f.line, fingerprint: fp(f), suggestedFix: fixOf(f), message: `Export "${str(f.export_name, '?')}"${f.is_type_only ? ' (type)' : ''} is never imported.` }));
  }
  for (const f of arr(doc.unused_files)) {
    out.push(violation('FALLOW-UNUSED-FILE', { file: f.path, line: 1, fingerprint: fp(f), suggestedFix: fixOf(f), message: 'No entry point reaches this file.' }));
  }
  for (const key of ['unused_dependencies', 'unused_dev_dependencies', 'unused_optional_dependencies']) {
    for (const f of arr(doc[key])) {
      out.push(violation('FALLOW-UNUSED-DEPENDENCY', { file: str(f.path, 'package.json'), line: f.line, fingerprint: fp(f), suggestedFix: fixOf(f), message: `Package "${str(f.package_name, '?')}" in ${str(f.location, 'dependencies')} is never imported.` }));
    }
  }
  for (const f of arr(doc.unused_component_props)) {
    out.push(violation('FALLOW-UNUSED-PROP', { file: f.path, line: f.line, fingerprint: fp(f), suggestedFix: fixOf(f), message: `Prop "${str(f.prop_name, '?')}" of ${str(f.component_name, 'the component')} is never read.` }));
  }
  for (const f of arr(doc.unresolved_imports)) {
    out.push(violation('FALLOW-UNRESOLVED-IMPORT', { file: f.path, line: f.line, fingerprint: fp(f), suggestedFix: fixOf(f), message: `Import "${str(f.specifier, '?')}" resolves to no file or package.` }));
  }
  for (const f of arr(doc.circular_dependencies)) {
    const files = Array.isArray(f.files) ? f.files.filter((x) => typeof x === 'string') : [];
    out.push(violation('FALLOW-CYCLE', { file: files[0], line: f.line, fingerprint: fp(f), suggestedFix: fixOf(f), message: `Import cycle: ${files.length ? [...files, files[0]].join(' -> ') : '(files not reported)'}.` }));
  }
  for (const f of arr(doc.duplicate_exports)) {
    const locs = arr(f.locations);
    out.push(violation('FALLOW-DUPLICATE', { file: locs[0]?.path, line: locs[0]?.line, fingerprint: fp(f), suggestedFix: fixOf(f), message: `Export "${str(f.export_name, '?')}" is declared in ${locs.length || 'several'} modules${locs.length ? `: ${locs.map((l) => str(l.path, '?')).join(', ')}` : ''}.` }));
  }
  return out;
}

/**
 * Map one `fallow health --format json` document's `findings` to Construct violations: one violation per
 * threshold a function exceeds. fallow gives health findings no fingerprint of its own, so the kept
 * fingerprint is fallow's function identity (the key its `--baseline-mode identity` matches on):
 * `health:<rule>:<path>:<function name>`. Unknown fields ignored; missing ones never throw.
 *
 * @param {any} doc Parsed health JSON (any shape: a non-object yields `[]`).
 * @returns {object[]} Violations.
 */
export function mapHealth(doc) {
  if (!doc || typeof doc !== 'object') return [];
  const out = [];
  for (const f of arr(doc.findings)) {
    const rules = HEALTH_EXCEEDED[f.exceeded] || [];
    const name = str(f.name, '(anonymous)');
    for (const rule of rules) {
      const detail = rule === 'FALLOW-CRAP' ? `CRAP score ${f.crap ?? '?'}`
        : rule === 'FALLOW-COMPLEXITY-COGNITIVE' ? `cognitive complexity ${f.cognitive ?? '?'}`
          : `cyclomatic complexity ${f.cyclomatic ?? '?'}`;
      out.push(violation(rule, {
        file: f.path,
        line: f.line,
        fingerprint: `health:${rule.slice('FALLOW-'.length).toLowerCase()}:${str(f.path, '.')}:${name}`,
        suggestedFix: str(arr(f.actions).find((a) => a.type === 'refactor-function')?.description) || fixOf(f),
        message: `Function "${name}" is over fallow's threshold: ${detail}${f.severity ? ` (${f.severity})` : ''}.`,
      }));
    }
  }
  return out;
}

/**
 * The command to run fallow with, or `null` when none is installed. Order: `CONSTRUCT_FALLOW_BIN`, the
 * pinned copy Construct itself depends on, then the project's own `node_modules/fallow`.
 *
 * @param {string} root Project root.
 * @param {{env?: Record<string, string|undefined>}} [opts]
 * @returns {{command: string, args: string[], source: string}|null}
 */
export function resolveFallowBin(root, { env = process.env } = {}) {
  if (env[FALLOW_BIN_ENV]) {
    const bin = env[FALLOW_BIN_ENV];
    return fs.existsSync(bin) ? { command: bin, args: [], source: FALLOW_BIN_ENV } : null;
  }
  const candidates = [];
  try {
    candidates.push({ pkg: createRequire(import.meta.url).resolve('fallow/package.json'), source: 'construct' });
  } catch { /* not installed alongside Construct */ }
  candidates.push({ pkg: path.join(root, 'node_modules', 'fallow', 'package.json'), source: 'project' });
  for (const { pkg, source } of candidates) {
    const js = path.join(path.dirname(pkg), 'bin', 'fallow');
    if (fs.existsSync(js)) return { command: process.execPath, args: [js], source };
  }
  return null;
}

/**
 * Whether `construct validate` should run fallow for `root`: off with `--no-fallow`, with `fallow: false`
 * (or `fallow: {enabled: false}`) in architecture.yml, or when the root has no package.json (nothing for
 * fallow to take entry points and dependencies from). On otherwise.
 *
 * @param {string} root Project root.
 * @param {string[]} [args] CLI args.
 * @returns {{enabled: boolean, reason?: string}}
 */
export function fallowSetting(root, args = []) {
  if (args.includes('--no-fallow')) return { enabled: false, reason: '--no-fallow' };
  const file = path.join(root, 'architecture.yml');
  if (fs.existsSync(file)) {
    let c = null;
    try { c = yaml.load(fs.readFileSync(file, 'utf8')); } catch { /* loadConfig reports a bad file */ }
    const v = c && typeof c === 'object' ? c.fallow : undefined;
    if (v === false || (v && typeof v === 'object' && v.enabled === false)) return { enabled: false, reason: 'architecture.yml fallow: false' };
  }
  if (!fs.existsSync(path.join(root, 'package.json'))) return { enabled: false, reason: 'no package.json' };
  return { enabled: true };
}

function runOne(bin, sub, root, { env, timeoutMs, execFileImpl }) {
  return new Promise((resolve) => {
    const args = [...bin.args, sub, '--root', root, '--format', 'json', '--quiet', '--no-cache'];
    const childEnv = { ...env, FALLOW_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
    execFileImpl(bin.command, args, { cwd: root, env: childEnv, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && (err.killed || err.signal)) return resolve({ error: `fallow ${sub} timed out after ${timeoutMs} ms` });
      if (err && err.code === 'ENOENT') return resolve({ error: 'fallow not installed', unavailable: true });
      // fallow exits 1 when its own severity gate fails -- the JSON report on stdout is still complete.
      try {
        return resolve({ doc: JSON.parse(stdout) });
      } catch {
        const why = String(stderr || stdout || (err && err.message) || '').trim().split('\n')[0];
        return resolve({ error: `fallow ${sub} printed no JSON report${why ? `: ${why}` : ''}` });
      }
    });
  });
}

/**
 * Run fallow's dead-code and health analyses on `root` and map both to Construct violations.
 *
 * @param {string} root Project root.
 * @param {{env?: Record<string, string|undefined>, timeoutMs?: number, bin?: {command: string, args: string[]}|null, execFileImpl?: Function}} [opts]
 * @returns {Promise<{status: 'ok'|'unavailable'|'failed', violations: object[], message: string, durationMs: number, version: string|null}>}
 */
export async function runFallow(root, { env = process.env, timeoutMs, bin, execFileImpl = execFile } = {}) {
  const started = Date.now();
  const resolved = bin === undefined ? resolveFallowBin(root, { env }) : bin;
  const ms = timeoutMs ?? (Number(env.CONSTRUCT_FALLOW_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const done = (status, violations, message, version = null) => ({ status, violations, message, durationMs: Date.now() - started, version });
  if (!resolved) return done('unavailable', [], `fallow not installed: FALLOW-* checks skipped (${INSTALL_HINT})`);
  const [dc, health] = await Promise.all(['dead-code', 'health'].map((sub) => runOne(resolved, sub, root, { env, timeoutMs: ms, execFileImpl })));
  if (dc.unavailable || health.unavailable) return done('unavailable', [], `fallow not installed: FALLOW-* checks skipped (${INSTALL_HINT})`);
  const errors = [dc.error, health.error].filter(Boolean);
  const violations = [...(dc.doc ? mapDeadCode(dc.doc) : []), ...(health.doc ? mapHealth(health.doc) : [])];
  const version = str(dc.doc?.version) || str(health.doc?.version) || null;
  if (errors.length) return done('failed', violations, errors.join('; '), version);
  return done('ok', violations, `fallow ${version ?? ''}: ${violations.length} finding(s)`.replace('  ', ' '), version);
}

/**
 * The fallow stage of `construct validate`: respects `fallowSetting`, runs fallow, and returns its
 * violations plus at most one info line for the caller to print (to stderr, so `--format json` stays the
 * exact report). Never throws and never fails a validate: every FALLOW-* finding is a warning.
 *
 * @param {string} root Project root.
 * @param {{args?: string[], env?: Record<string, string|undefined>, timeoutMs?: number, bin?: object|null, execFileImpl?: Function}} [opts]
 * @returns {Promise<{violations: object[], notice: string|null, ran: boolean, durationMs: number}>}
 */
export async function fallowStage(root, { args = [], ...opts } = {}) {
  const setting = fallowSetting(root, args);
  if (!setting.enabled) return { violations: [], notice: null, ran: false, durationMs: 0 };
  try {
    const r = await runFallow(root, opts);
    const notice = r.status === 'ok' ? null : `ℹ️ ${r.message}`;
    return { violations: r.violations, notice, ran: r.status !== 'unavailable', durationMs: r.durationMs };
  } catch (e) {
    return { violations: [], notice: `ℹ️ fallow could not run: ${e.message}`, ran: false, durationMs: 0 };
  }
}
