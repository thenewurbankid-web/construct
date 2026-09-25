// #647 (epic #616) -- the dataset bundle: `decision-trace.v1` records, exported ON REQUEST, so a decision model can be trained on
// ANOTHER machine (train-kit/, docs/TRAIN-ELSEWHERE.md). Nothing trains here and nothing leaves the machine by itself.
//
//   construct traces export --out <dir> [--since D] [--chooser id] [--yes]     preview first; writes only with --yes
//
//   <out>/dataset.jsonl   one `{ "split", "trace" }` per line, sorted by time then id, keys sorted (byte-for-byte reproducible)
//   <out>/schema.json     decision-trace.v1 and the bundle's own shape
//   <out>/manifest.json   counts, sha256 of every file, the dataset hash, Construct version, providers seen, chooser ids, split rule
//   <out>/README.md       what it is, the privacy statement, how to train
//
// Every record is RE-VALIDATED (`validateTrace`, which includes the path and secret check): a record that fails is DROPPED and
// COUNTED, never repaired. The train/validation/test split is 80/10/10 by a hash of the record id, so a record never changes side.
// A project with `traces: off` contributes nothing. The export is written to the export LEDGER in the state directory
// (`<state dir>/exports/<project key>/ledger.jsonl`), which is how a trained model coming back proves it was made from a dataset
// THIS project exported (decision-model-bundle.mjs) and which records were held out for its replay.
//
// Writes stay inside the chosen `--out` directory (fixed file names, no symbolic link followed, never inside the project).
// No network, no model, no clock of its own: the time of creation is injected by the caller. Every failure is `{ ok: false, code,
// message }`, never a throw.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDir, projectKey } from '../engine/processStore.mjs';
import { TRACE_VERSION, TRACE_SOURCES, OUTCOME_FIELDS, TRACE_LIMITS, validateTrace, serializeTrace } from './decision-trace.mjs';
import { readTraces, tracesEnabled } from './decision-trace-store.mjs';

/** The `schema` string of a dataset bundle's `manifest.json`. */
export const DATASET_BUNDLE_VERSION = 'construct.dataset-bundle.v1';
/** The files of a dataset bundle, in the order they are written. `manifest.json` is written last and hashes the others. */
export const DATASET_FILES = Object.freeze(['dataset.jsonl', 'schema.json', 'README.md', 'manifest.json']);
/** The split: a record goes to the side its id hashes to (`sha256("split.v1:" + id)`, first 8 hex digits, mod 100). */
export const SPLIT_RULE = Object.freeze({ salt: 'split.v1', modulus: 100, train: 80, validation: 10, test: 10 });

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const fail = (code, message) => ({ ok: false, code, message });
const errText = (e) => `${e?.code ? `${e.code}: ` : ''}${String(e?.message ?? e).split('\n')[0]}`.slice(0, 160);

/**
 * Which side of the split a record id belongs to. A pure function of the id (no random number, no order), so an export made
 * next week puts the same decision on the same side and a held-out record stays held out.
 *
 * @param {string} id A decision id (`dt-` and 24 hex characters).
 * @returns {'train' | 'validation' | 'test'} The side (80/10/10).
 *
 * @example
 * splitOf('dt-8b2cd80c7460594d1b4f5e11'); // => 'train' | 'validation' | 'test', the same one every time
 */
export function splitOf(id) {
  const n = parseInt(sha256(`${SPLIT_RULE.salt}:${id}`).slice(0, 8), 16) % SPLIT_RULE.modulus;
  if (n < SPLIT_RULE.train) return 'train';
  return n < SPLIT_RULE.train + SPLIT_RULE.validation ? 'validation' : 'test';
}

/**
 * The name a project goes by in a bundle: a hash of its state key (`<basename>-<hash of the path>`), so the bundle names neither
 * the folder nor where it is.
 *
 * @param {string} root The project root.
 * @returns {string} 16 hex characters.
 *
 * @example
 * hashedProjectKey('/work/web'); // => 'a3f9c2d1e8b04f17'
 */
export function hashedProjectKey(root) {
  return sha256(`project:${projectKey(root)}`).slice(0, 16);
}

/**
 * The JSON Schema text of a bundle's `schema.json`: the `decision-trace.v1` record, a dataset line and the two manifests.
 *
 * @returns {object} The schema document (deterministic).
 *
 * @example
 * datasetSchema().$id; // => 'construct.dataset-bundle.v1'
 */
export function datasetSchema() {
  const str = (extra = {}) => ({ type: 'string', ...extra });
  const bool = { type: 'boolean' };
  const trace = {
    $id: TRACE_VERSION,
    type: 'object',
    additionalProperties: false,
    required: ['version', 'id', 'at', 'chooser', 'summary', 'options', 'chosen', 'by'],
    properties: {
      version: { const: TRACE_VERSION },
      id: str({ pattern: '^dt-[0-9a-f]{24}$', description: 'a hash of chooser, summary, chosen, by and the provider name' }),
      at: str({ description: 'ISO time, supplied by the recorder' }),
      chooser: { type: 'object', required: ['id', 'question'], properties: { id: str(), question: str() } },
      summary: { type: 'object', description: `the fixed-size, path-free question as it was OFFERED (at most ${TRACE_LIMITS.summaryBytes} bytes); chosen is null`, required: ['id', 'question', 'options'], properties: { id: str(), question: str(), options: { type: 'array', minItems: TRACE_LIMITS.minOptions, maxItems: TRACE_LIMITS.maxOptions, items: { type: 'object', required: ['id', 'enabled'], properties: { id: str(), label: str(), enabled: bool, why: str() } } }, chosen: { type: 'null' } } },
      options: { type: 'array', items: str(), description: 'the option ids of the summary, in order' },
      chosen: str({ description: 'one of options, or "exit"' }),
      by: { enum: [...TRACE_SOURCES] },
      provider: { type: 'object', required: ['name', 'version'], properties: { name: str(), version: str() } },
      suggestion: { type: 'object', required: ['option', 'reason'], properties: { option: str(), reason: str(), score: { type: 'number', minimum: 0, maximum: 1 } } },
      outcome: { type: 'object', properties: Object.fromEntries(OUTCOME_FIELDS.map((f) => [f, bool])) },
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: DATASET_BUNDLE_VERSION,
    title: 'Construct dataset bundle',
    description: 'dataset.jsonl holds one line per decision: { split, trace }, keys sorted. manifest.json lists every other file with its sha256.',
    line: { type: 'object', additionalProperties: false, required: ['split', 'trace'], properties: { split: { enum: ['train', 'validation', 'test'] }, trace: { $ref: TRACE_VERSION } } },
    trace,
    manifest: {
      type: 'object',
      required: ['schema', 'createdAt', 'constructVersion', 'traceVersion', 'split', 'counts', 'chooserIds', 'providers', 'projects', 'datasetHash', 'files'],
      properties: {
        schema: { const: DATASET_BUNDLE_VERSION },
        createdAt: str(),
        constructVersion: str(),
        traceVersion: { const: TRACE_VERSION },
        split: { type: 'object', description: 'the rule that put each record on a side' },
        counts: { type: 'object', description: 'records, per split, dropped (failed re-validation), per chooser' },
        chooserIds: { type: 'array', items: str() },
        providers: { type: 'array', items: { type: 'object', properties: { name: str(), version: str() } } },
        projects: { type: 'array', description: 'hashed project keys with their record counts; no name, no path' },
        datasetHash: str({ pattern: '^[0-9a-f]{64}$', description: 'sha256 of dataset.jsonl' }),
        files: { type: 'object', description: 'name -> { sha256, bytes } for dataset.jsonl, schema.json and README.md' },
      },
    },
    modelManifest: {
      description: 'What a model bundle coming back must carry (construct model import): manifest.json with schema construct.model-bundle.v1, the datasetHash of a bundle THIS project exported, and the sha256 of every file.',
    },
  };
}

/** The fixed fields a dataset line's trace carries, for the preview. */
const TRACE_FIELDS = Object.freeze(['version', 'id', 'at', 'chooser', 'summary', 'options', 'chosen', 'by', 'provider', 'suggestion', 'outcome']);

const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;

/**
 * Normalise a `--since` value: a date (`2026-09-01`, midnight UTC) or an ISO time (`2026-09-01T09:00:00Z`).
 *
 * @param {string | undefined} value The flag value.
 * @returns {{ ok: true, since: string | null } | { ok: false, code: string, message: string }} The ISO time to compare with, or `SINCE_INVALID`.
 *
 * @example
 * parseSince('2026-09-01'); // => { ok: true, since: '2026-09-01T00:00:00.000Z' }
 */
export function parseSince(value) {
  if (value === undefined) return { ok: true, since: null };
  const text = String(value);
  const ms = isoDate.test(text) ? Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text) : NaN;
  if (Number.isNaN(ms)) return fail('SINCE_INVALID', '--since must be a date such as 2026-09-01 or an ISO time such as 2026-09-01T09:00:00Z.');
  return { ok: true, since: new Date(ms).toISOString() };
}

/**
 * @typedef {{ key: string, decisions: import('./decision-trace.mjs').DecisionTrace[], enabled?: boolean }} DatasetProject
 * One project's contribution: its hashed key (`hashedProjectKey`), its decisions with outcomes merged (`readTraces`), and
 * whether it allows export (`traces` is not `off`).
 */

/**
 * Build the dataset bundle IN MEMORY from decisions: filter by chooser and time, re-validate every record (a failing one is
 * dropped and counted), deduplicate by id, split, serialise, hash. Pure and deterministic: the same decisions, options and `now`
 * give the same bytes. Nothing is read or written here.
 *
 * @param {DatasetProject[]} projects The contributing projects; one with `enabled: false` contributes nothing.
 * @param {{ now: string, constructVersion: string, chooser?: string | null, since?: string | null }} options `now`: the creation time (ISO), injected by the caller; the Construct version; optional chooser id and earliest time.
 * @returns {{ ok: true, files: Record<string, string>, manifest: object, preview: object, records: { split: string, trace: object }[] } | { ok: false, code: string, message: string, preview: object }} The files (name to text), the manifest, the preview and the records; or `DATASET_EMPTY` (nothing to export) with the preview that explains why.
 *
 * @example
 * const built = buildDatasetBundle([{ key: hashedProjectKey(root), decisions }], { now: '2026-09-25T10:00:00.000Z', constructVersion: '0.9.0' });
 * built.manifest.counts.records; // => 50
 */
export function buildDatasetBundle(projects, options) {
  const { now, constructVersion, chooser = null, since = null } = options;
  const seen = new Set();
  const records = [];
  const dropped = { count: 0, byCode: {} };
  const projectRows = [];
  for (const project of projects) {
    const row = { key: project.key, records: 0, optedOut: project.enabled === false };
    projectRows.push(row);
    if (row.optedOut) continue;
    for (const d of project.decisions) {
      if (chooser && d.chooser?.id !== chooser) continue;
      if (since && !(String(d.at) >= since)) continue;
      const checked = validateTrace(d);
      if (!checked.valid) {
        dropped.count += 1;
        for (const code of new Set(checked.errors.map((e) => e.code))) dropped.byCode[code] = (dropped.byCode[code] ?? 0) + 1;
        continue;
      }
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      row.records += 1;
      records.push({ split: splitOf(d.id), trace: d });
    }
  }
  records.sort((a, b) => (a.trace.at < b.trace.at ? -1 : a.trace.at > b.trace.at ? 1 : a.trace.id < b.trace.id ? -1 : a.trace.id > b.trace.id ? 1 : 0));

  const counts = { records: records.length, train: 0, validation: 0, test: 0, dropped: dropped.count, droppedByCode: Object.fromEntries(Object.entries(dropped.byCode).sort()), byChooser: {} };
  const providers = new Map();
  for (const { split, trace } of records) {
    counts[split] += 1;
    const c = (counts.byChooser[trace.chooser.id] ??= { records: 0, train: 0, validation: 0, test: 0 });
    c.records += 1;
    c[split] += 1;
    if (trace.provider) providers.set(`${trace.provider.name}@${trace.provider.version}`, trace.provider);
  }
  counts.byChooser = Object.fromEntries(Object.entries(counts.byChooser).sort(([a], [b]) => (a < b ? -1 : 1)));
  const dateRange = records.length ? { from: records[0].trace.at, to: records.reduce((m, r) => (r.trace.at > m ? r.trace.at : m), records[0].trace.at) } : null;
  const preview = {
    records: counts.records,
    byChooser: counts.byChooser,
    split: { train: counts.train, validation: counts.validation, test: counts.test },
    dropped: { count: dropped.count, byCode: counts.droppedByCode },
    fields: [...TRACE_FIELDS],
    dateRange,
    projects: projectRows.map((p) => ({ keyHash: p.key, records: p.records, optedOut: p.optedOut })),
    filters: { chooser, since },
    containsPathOrSecret: false,
  };
  if (!records.length) {
    const opted = projectRows.filter((p) => p.optedOut).length;
    return { ...fail('DATASET_EMPTY', `Nothing to export: no valid decision trace matches${opted ? ` (${opted} project(s) have traces: off and contribute nothing)` : ''}.`), preview };
  }

  const datasetText = `${records.map((r) => serializeTrace(r)).join('\n')}\n`;
  const datasetHash = sha256(datasetText);
  const schemaText = `${JSON.stringify(datasetSchema(), null, 2)}\n`;
  const readmeText = renderBundleReadme({ datasetHash, counts, dateRange, constructVersion });
  const file = (text, extra = {}) => ({ sha256: sha256(text), bytes: Buffer.byteLength(text), ...extra });
  const manifest = {
    schema: DATASET_BUNDLE_VERSION,
    createdAt: now,
    constructVersion,
    traceVersion: TRACE_VERSION,
    split: { ...SPLIT_RULE, rule: 'sha256("split.v1:" + record id), first 8 hex digits as a number, mod 100: below 80 train, below 90 validation, else test' },
    counts,
    chooserIds: Object.keys(counts.byChooser),
    providers: [...providers.values()].sort((a, b) => (`${a.name}@${a.version}` < `${b.name}@${b.version}` ? -1 : 1)),
    dateRange,
    projects: projectRows.filter((p) => !p.optedOut).map((p) => ({ keyHash: p.key, records: p.records })),
    datasetHash,
    files: { 'dataset.jsonl': file(datasetText, { records: records.length }), 'schema.json': file(schemaText), 'README.md': file(readmeText) },
  };
  preview.datasetHash = datasetHash;
  return { ok: true, files: { 'dataset.jsonl': datasetText, 'schema.json': schemaText, 'README.md': readmeText, 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` }, manifest, preview, records };
}

function renderBundleReadme({ datasetHash, counts, dateRange, constructVersion }) {
  return [
    '# Construct dataset bundle',
    '',
    `Made by Construct ${constructVersion} with \`construct traces export\`. Dataset hash (sha256 of dataset.jsonl): \`${datasetHash}\`.`,
    '',
    `${counts.records} decision records (${counts.train} train, ${counts.validation} validation, ${counts.test} test)${dateRange ? ` from ${dateRange.from} to ${dateRange.to}` : ''}, ${counts.dropped} dropped on re-validation.`,
    '',
    '## What it is',
    '',
    'Each line of `dataset.jsonl` is one closed choice a person (or a model) made in a Construct chain: `{ "split", "trace" }`, where the trace is a',
    '`decision-trace.v1` record (`schema.json`): the question as it was offered with its option ids, the option chosen, who chose, what a rules',
    'provider suggested, and what happened afterwards. `manifest.json` has the counts, the sha256 of every file and the split rule',
    '(80/10/10 by a hash of the record id, so a record never changes side).',
    '',
    '## Privacy',
    '',
    'Every record was checked again before it was written: a record holding an absolute path, a `~/`, `./` or `../` path or a secret-shaped',
    'string was dropped, not repaired. The project is named only by a hash. No source file, no path and no credential is in this bundle. It still',
    'describes what the project\'s people asked for, so treat it like the project: move it only over a channel you trust, encrypted (see',
    'train-kit/README.md, "Transport").',
    '',
    '## How to train',
    '',
    'Copy this folder to the training machine and run the kit there (it needs Python 3 and nothing else):',
    '',
    '    train-kit/train.sh <this folder> <output folder>',
    '',
    'It writes a model bundle (`features.json`, `eval-report.json`, `MODEL_CARD.md`, `checksums.txt`, `manifest.json`). Copy that folder back and run',
    '`construct model import <folder>` in the project. The import verifies it against the dataset hash above, replays the held-out test records',
    'against the rules baseline and registers the model DISABLED. See docs/TRAIN-ELSEWHERE.md.',
    '',
  ].join('\n');
}

const ledgerFile = (root, options = {}) => path.join(options.stateDir ?? resolveStateDir(options.env ?? process.env), 'exports', projectKey(root), 'ledger.jsonl');

/**
 * The exports this project has written (the LEDGER), oldest first. A model bundle coming back is accepted only when the dataset
 * hash it claims is in here. A line that cannot be read is skipped. Never throws.
 *
 * @param {string} root The project root.
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory (default `resolveStateDir`).
 * @returns {{ datasetHash: string, createdAt: string, constructVersion: string, counts: object, chooserIds: string[], testIds: string[] }[]} The ledger entries.
 *
 * @example
 * readExportLedger(root).map((e) => e.datasetHash);
 */
export function readExportLedger(root, options = {}) {
  try {
    const out = [];
    for (const line of fs.readFileSync(ledgerFile(root, options), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (typeof e?.datasetHash === 'string' && /^[0-9a-f]{64}$/.test(e.datasetHash) && Array.isArray(e.testIds)) out.push(e);
      } catch {
        // a torn line is skipped
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The ledger entry of one dataset hash, or `null`.
 *
 * @param {string} root The project root.
 * @param {string} datasetHash A dataset hash (64 hex characters).
 * @param {{ stateDir?: string, env?: Record<string, string | undefined> }} [options] The state directory.
 * @returns {ReturnType<typeof readExportLedger>[number] | null} The entry, or `null` when this project never exported that dataset.
 *
 * @example
 * findExport(root, manifest.datasetHash)?.testIds.length; // => 5
 */
export function findExport(root, datasetHash, options = {}) {
  return readExportLedger(root, options).find((e) => e.datasetHash === datasetHash) ?? null;
}

function recordExport(root, manifest, records, options) {
  if (findExport(root, manifest.datasetHash, options)) return { ok: true, already: true };
  const entry = {
    datasetHash: manifest.datasetHash,
    createdAt: manifest.createdAt,
    constructVersion: manifest.constructVersion,
    counts: { records: manifest.counts.records, train: manifest.counts.train, validation: manifest.counts.validation, test: manifest.counts.test },
    chooserIds: manifest.chooserIds,
    testIds: records.filter((r) => r.split === 'test').map((r) => r.trace.id),
  };
  try {
    const file = ledgerFile(root, options);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${serializeTrace(entry)}\n`, { mode: 0o600 });
    return { ok: true, already: false };
  } catch (e) {
    return fail('LEDGER_WRITE_FAILED', `The export ledger could not be written (${errText(e)}); nothing was left half-done except the bundle folder.`);
  }
}

/** Refuse an out directory that is not safe to write: inside the project, a file, a link, or already holding other files. */
function checkOutDir(root, out) {
  const resolved = path.resolve(out);
  const projectRoot = path.resolve(root);
  if (resolved === projectRoot || resolved.startsWith(projectRoot + path.sep)) return fail('OUT_INSIDE_PROJECT', 'The output folder must be outside the project: a bundle inside it would show up in git status and be walked by the enforcers.');
  let st = null;
  try {
    st = fs.lstatSync(resolved);
  } catch {
    // does not exist yet: it is created below
  }
  if (st) {
    if (st.isSymbolicLink()) return fail('OUT_SYMLINK', 'The output folder is a symbolic link; name the real folder.');
    if (!st.isDirectory()) return fail('OUT_NOT_DIRECTORY', 'The output path exists and is not a folder.');
    const others = fs.readdirSync(resolved).filter((n) => !DATASET_FILES.includes(n));
    if (others.length) return fail('OUT_NOT_EMPTY', 'The output folder already holds other files; name an empty or new folder (only an earlier bundle of this kind is overwritten).');
  }
  return { ok: true, dir: resolved };
}

/** Write the bundle's fixed files into `dir`: each is removed if it is a plain file, refused if it is a link, created exclusively, mode 0600. */
function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of DATASET_FILES) {
    const target = path.join(dir, name);
    if (path.dirname(target) !== dir) return fail('OUT_ESCAPE', 'A bundle file would leave the output folder.');
    let st = null;
    try {
      st = fs.lstatSync(target);
    } catch {
      // not there yet
    }
    if (st?.isSymbolicLink() || (st && !st.isFile())) return fail('OUT_SYMLINK', `${name} in the output folder is not a plain file.`);
    if (st) fs.rmSync(target);
    fs.writeFileSync(target, files[name], { flag: 'wx', mode: 0o600 });
  }
  return { ok: true };
}

/**
 * Export a project's decision traces as a dataset bundle. WITHOUT `write` it is a PREVIEW: it reads the traces, builds the bundle
 * in memory and reports exactly what would be included (records per chooser, the fields, the date range, hashed project keys) and
 * writes NOTHING, not even the ledger. With `write: true` it writes the four files into `out` and records the export in the
 * ledger. A project with `traces: off` contributes nothing.
 *
 * @param {string} root The project root.
 * @param {{ out: string, write?: boolean, chooser?: string | null, since?: string | null, now: string, constructVersion: string, stateDir?: string, env?: Record<string, string | undefined> }} options The output folder, whether to write, the filters, the injected creation time, the Construct version, the state directory.
 * @returns {{ ok: true, written: boolean, out: string, preview: object, manifest: object } | { ok: false, code: string, message: string, preview?: object }} What was (or would be) exported, or the typed reason it was not.
 *
 * @example
 * const preview = exportDataset(root, { out: '/tmp/bundle', now: new Date().toISOString(), constructVersion: '0.9.0' });
 * const done = exportDataset(root, { out: '/tmp/bundle', write: true, now, constructVersion: '0.9.0' });
 */
export function exportDataset(root, options) {
  try {
    if (typeof options?.out !== 'string' || !options.out.trim()) return fail('OUT_REQUIRED', 'Say where the bundle goes: --out <folder>.');
    const since = parseSince(options.since ?? undefined);
    if (!since.ok) return since;
    const enabled = tracesEnabled(root);
    const read = enabled ? readTraces(root, options) : { decisions: [], error: undefined };
    if (read.error) return fail('TRACES_UNREADABLE', `The traces could not be read: ${read.error}`);
    const built = buildDatasetBundle([{ key: hashedProjectKey(root), decisions: read.decisions, enabled }], { now: options.now, constructVersion: options.constructVersion, chooser: options.chooser ?? null, since: since.since });
    if (!built.ok) return built;
    const dir = checkOutDir(root, options.out);
    if (!dir.ok) return { ...dir, preview: built.preview };
    if (!options.write) return { ok: true, written: false, out: dir.dir, preview: built.preview, manifest: built.manifest };
    const wrote = writeFiles(dir.dir, built.files);
    if (!wrote.ok) return wrote;
    const ledger = recordExport(root, built.manifest, built.records, options);
    if (!ledger.ok) return ledger;
    return { ok: true, written: true, out: dir.dir, preview: built.preview, manifest: built.manifest };
  } catch (e) {
    return fail('EXPORT_FAILED', `The export failed (${errText(e)}).`);
  }
}

/**
 * The plain-text preview or result of an export: what is included, and the statement that no path or secret is in it.
 *
 * @param {Extract<ReturnType<typeof exportDataset>, { ok: true }>} result A successful `exportDataset` result.
 * @returns {string} The text.
 *
 * @example
 * console.log(renderExport(exportDataset(root, { out, now, constructVersion })));
 */
export function renderExport(result) {
  const p = result.preview;
  const lines = [result.written ? `Wrote a dataset bundle to ${result.out}` : `PREVIEW: nothing is written. This is what a dataset bundle would hold (add --yes to write it to ${result.out}).`, ''];
  lines.push(`Records: ${p.records} (train ${p.split.train}, validation ${p.split.validation}, test ${p.split.test}); dropped on re-validation: ${p.dropped.count}${p.dropped.count ? ` (${Object.entries(p.dropped.byCode).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`);
  lines.push('Per chooser:');
  for (const [id, c] of Object.entries(p.byChooser)) lines.push(`  ${id.padEnd(38)} ${String(c.records).padStart(5)}  (train ${c.train}, validation ${c.validation}, test ${c.test})`);
  lines.push(`Fields of every record: ${p.fields.join(', ')} (plus split)`);
  lines.push(`Date range: ${p.dateRange ? `${p.dateRange.from} to ${p.dateRange.to}` : 'none'}${p.filters.since ? `; since ${p.filters.since}` : ''}${p.filters.chooser ? `; chooser ${p.filters.chooser}` : ''}`);
  lines.push(`Projects (key hashed): ${p.projects.map((x) => `${x.keyHash} (${x.records} records${x.optedOut ? ', traces: off' : ''})`).join(', ')}`);
  lines.push('No path and no secret is in it: every record was checked again and a failing one is dropped, never repaired.');
  if (p.datasetHash) lines.push(`Dataset hash: ${p.datasetHash}`);
  if (result.written) lines.push('', 'Files: dataset.jsonl, schema.json, manifest.json, README.md. The export is recorded in this project\'s ledger, so the model trained from it can be imported.');
  return lines.join('\n');
}
