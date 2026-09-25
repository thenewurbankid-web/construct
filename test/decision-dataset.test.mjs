// #647 -- `construct traces export`: the dataset bundle for training the decision model ELSEWHERE. Preview first (writes nothing),
// then a deterministic bundle: dataset.jsonl (re-validated, a failing record dropped and counted, never repaired), an 80/10/10 split
// by a hash of the record id, schema.json, manifest.json with the sha256 of every file, README.md; a per-project opt-out; the export
// ledger in the state directory; writes that stay inside the chosen folder; a fuzz with planted secrets and paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeTrainKitTraces, FIXTURE_NOW, NOUN_CHOOSER, SHAPE_CHOOSER } from '../test-utils/trainKitFixture.mjs';
import { buildDatasetBundle, exportDataset, renderExport, splitOf, hashedProjectKey, parseSince, readExportLedger, findExport, datasetSchema, DATASET_FILES, DATASET_BUNDLE_VERSION } from '../packages/core/decision-dataset.mjs';
import { buildTrace, traceId, validateTrace } from '../packages/core/decision-trace.mjs';
import { readTraces, TRACE_FILE, traceDir } from '../packages/core/decision-trace-store.mjs';
import { looksLikePath, looksLikeSecret } from '../packages/core/redaction.mjs';

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const VERSION = '9.9.9-test';

async function setup({ yml } = {}) {
  const root = makeTempDir('og647-project-');
  const stateDir = makeTempDir('og647-state-');
  if (yml !== undefined) fs.writeFileSync(path.join(root, 'architecture.yml'), yml);
  await writeTrainKitTraces(root, stateDir);
  const out = path.join(makeTempDir('og647-out-'), 'bundle');
  return { root, stateDir, out, opts: (extra = {}) => ({ out, stateDir, now: FIXTURE_NOW, constructVersion: VERSION, ...extra }) };
}
const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

test('PREVIEW is the default: it reports records per chooser, fields, date range, hashed keys and writes nothing (no folder, no ledger)', async () => {
  const { root, stateDir, out, opts } = await setup();
  const before = listing(stateDir);
  const r = exportDataset(root, opts());
  assert.equal(r.ok, true);
  assert.equal(r.written, false);
  assert.equal(fs.existsSync(out), false, 'the output folder was not created');
  assert.deepEqual(listing(stateDir), before, 'nothing was added to the state directory, the ledger included');
  assert.deepEqual(readExportLedger(root, { stateDir }), []);
  const p = r.preview;
  assert.equal(p.records, 120);
  assert.deepEqual(Object.keys(p.byChooser), [NOUN_CHOOSER, SHAPE_CHOOSER]);
  assert.equal(p.byChooser[NOUN_CHOOSER].records, 90);
  assert.equal(p.split.train + p.split.validation + p.split.test, 120);
  assert.deepEqual(p.fields, ['version', 'id', 'at', 'chooser', 'summary', 'options', 'chosen', 'by', 'provider', 'suggestion', 'outcome']);
  assert.deepEqual(p.dateRange, { from: '2026-09-01T09:00:00.000Z', to: '2026-09-01T10:59:00.000Z' });
  assert.deepEqual(p.projects, [{ keyHash: hashedProjectKey(root), records: 120, optedOut: false }]);
  assert.match(p.projects[0].keyHash, /^[0-9a-f]{16}$/);
  assert.equal(p.containsPathOrSecret, false);
  const text = renderExport(r);
  assert.match(text, /^PREVIEW: nothing is written/);
  assert.match(text, /No path and no secret is in it/);
  assert.match(text, /Records: 120/);
  assert.equal(text.includes(root) || text.includes(path.basename(root)), false, 'the preview names neither the project folder nor its path');
});

test('--yes writes exactly the four bundle files; the manifest hashes the others and the dataset hash is the sha256 of dataset.jsonl', async () => {
  const { root, out, stateDir, opts } = await setup();
  const r = exportDataset(root, opts({ write: true }));
  assert.equal(r.ok, true);
  assert.equal(r.written, true);
  assert.deepEqual(fs.readdirSync(out).sort(), [...DATASET_FILES].sort());
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema, DATASET_BUNDLE_VERSION);
  assert.equal(manifest.createdAt, FIXTURE_NOW, 'the clock is injected');
  assert.equal(manifest.constructVersion, VERSION);
  assert.equal(manifest.traceVersion, 'decision-trace.v1');
  assert.equal(manifest.datasetHash, sha(fs.readFileSync(path.join(out, 'dataset.jsonl'))));
  for (const name of ['dataset.jsonl', 'schema.json', 'README.md']) {
    const bytes = fs.readFileSync(path.join(out, name));
    assert.deepEqual(manifest.files[name], { sha256: sha(bytes), bytes: bytes.length, ...(name === 'dataset.jsonl' ? { records: 120 } : {}) }, name);
  }
  assert.deepEqual(manifest.chooserIds, [NOUN_CHOOSER, SHAPE_CHOOSER]);
  assert.deepEqual(manifest.providers, [{ name: 'rules', version: '1' }]);
  assert.deepEqual(manifest.projects, [{ keyHash: hashedProjectKey(root), records: 120 }]);
  assert.equal(manifest.split.train + manifest.split.validation + manifest.split.test, 100);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'schema.json'), 'utf8')).$id, DATASET_BUNDLE_VERSION);
  assert.match(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), /How to train/);
  assert.match(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), new RegExp(manifest.datasetHash));
  for (const name of DATASET_FILES) assert.equal(fs.statSync(path.join(out, name)).mode & 0o077, 0, `${name} is private`);
  assert.equal(readExportLedger(root, { stateDir }).length, 1);
  const again = exportDataset(root, opts({ write: true }));
  assert.equal(again.ok, true, 'exporting again into the same bundle folder overwrites the earlier bundle');
});

test('every line is a { split, trace } that passes validateTrace and sits on the side its id hashes to; the split counts match the manifest', async () => {
  const { root, out, opts } = await setup();
  exportDataset(root, opts({ write: true }));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const counts = { train: 0, validation: 0, test: 0 };
  const seen = new Set();
  let previous = '';
  for (const line of fs.readFileSync(path.join(out, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const { split, trace } = JSON.parse(line);
    assert.deepEqual(Object.keys(JSON.parse(line)), ['split', 'trace'], 'keys sorted');
    assert.equal(validateTrace(trace).valid, true);
    assert.equal(split, splitOf(trace.id));
    assert.equal(seen.has(trace.id), false, 'no duplicate id');
    seen.add(trace.id);
    assert.ok(`${trace.at} ${trace.id}` >= previous, 'sorted by time then id');
    previous = `${trace.at} ${trace.id}`;
    counts[split] += 1;
  }
  assert.deepEqual(counts, { train: manifest.counts.train, validation: manifest.counts.validation, test: manifest.counts.test });
  assert.equal(seen.size, 120);
});

test('the split is a pure function of the id: pinned values, and about 80/10/10 over many ids', () => {
  assert.deepEqual(['dt-000000000000000000000000', 'dt-8b2cd80c7460594d1b4f5e11', 'dt-ffffffffffffffffffffffff', 'dt-4f71d8ff08f9168d9408399a'].map(splitOf), ['train', 'train', 'train', 'validation']);
  const n = { train: 0, validation: 0, test: 0 };
  for (let i = 0; i < 5000; i += 1) n[splitOf(`dt-${sha(String(i)).slice(0, 24)}`)] += 1;
  assert.ok(n.train > 3800 && n.train < 4200, `train ${n.train}`);
  assert.ok(n.validation > 380 && n.validation < 620, `validation ${n.validation}`);
  assert.ok(n.test > 380 && n.test < 620, `test ${n.test}`);
  assert.equal(splitOf('dt-8b2cd80c7460594d1b4f5e11'), splitOf('dt-8b2cd80c7460594d1b4f5e11'));
});

test('a record never changes side when more records arrive, and the export is byte-for-byte the same for the same inputs and clock', async () => {
  const { root, stateDir, opts } = await setup();
  const outA = path.join(makeTempDir('og647-a-'), 'b');
  const outB = path.join(makeTempDir('og647-b-'), 'b');
  exportDataset(root, opts({ write: true, out: outA }));
  exportDataset(root, opts({ write: true, out: outB }));
  for (const name of DATASET_FILES) assert.deepEqual(fs.readFileSync(path.join(outA, name)), fs.readFileSync(path.join(outB, name)), name);
  const sideOf = (dir) => Object.fromEntries(fs.readFileSync(path.join(dir, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const { split, trace } = JSON.parse(l); return [trace.id, split]; }));
  const first = sideOf(outA);
  // an ordering of the same decisions does not matter either
  const { decisions } = readTraces(root, { stateDir });
  const shuffled = [...decisions].reverse();
  const built = buildDatasetBundle([{ key: hashedProjectKey(root), decisions: shuffled }], { now: FIXTURE_NOW, constructVersion: VERSION });
  assert.equal(built.files['dataset.jsonl'], fs.readFileSync(path.join(outA, 'dataset.jsonl'), 'utf8'));
  // and a later export with a subset keeps every remaining record on its side
  const later = buildDatasetBundle([{ key: 'k', decisions: decisions.slice(0, 40) }], { now: '2027-01-01T00:00:00.000Z', constructVersion: VERSION });
  for (const r of later.records) assert.equal(first[r.trace.id], r.split);
});

test('a record that fails re-validation is DROPPED and COUNTED, never repaired: a path, a secret, a wrong id, a wrong version', async () => {
  const { root, stateDir } = await setup();
  const { decisions } = readTraces(root, { stateDir });
  const good = decisions.slice(0, 5);
  const plant = (mutate, { fixId = false } = {}) => {
    const t = structuredClone(decisions[10]);
    mutate(t);
    if (fixId) t.id = traceId(t);
    return t;
  };
  const bad = [
    plant((t) => { t.summary.question = 'What does "x" mean in /etc/passwd?'; }, { fixId: true }),
    plant((t) => { t.summary.options[0].why = 'see ~/notes/plan.md'; }, { fixId: true }),
    plant((t) => { t.summary.options[1].label = 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789'; }, { fixId: true }),
    plant((t) => { t.chooser.question = 'password=hunter2hunter2'; }, { fixId: true }),
    plant((t) => { t.chosen = 'state'; }),
    plant((t) => { t.version = 'decision-trace.v2'; }),
  ];
  const built = buildDatasetBundle([{ key: 'k', decisions: [...good, ...bad] }], { now: FIXTURE_NOW, constructVersion: VERSION });
  assert.equal(built.ok, true);
  assert.equal(built.manifest.counts.records, 5);
  assert.equal(built.manifest.counts.dropped, 6);
  assert.ok(built.manifest.counts.droppedByCode.TRACE_REDACTION_PATH >= 2);
  assert.ok(built.manifest.counts.droppedByCode.TRACE_REDACTION_SECRET >= 2);
  assert.ok(built.manifest.counts.droppedByCode.TRACE_ID_MISMATCH >= 1);
  assert.equal(built.files['dataset.jsonl'].includes('/etc/passwd'), false);
  assert.equal(built.files['dataset.jsonl'].includes('ghp_'), false);
  assert.equal(built.preview.dropped.count, 6);
  const text = renderExport({ ok: true, written: false, out: 'x', preview: built.preview });
  assert.match(text, /dropped on re-validation: 6/);
});

test('traces: off contributes nothing: DATASET_EMPTY, no folder, no ledger, even though traces were recorded before', async () => {
  const { root, stateDir, out, opts } = await setup({ yml: 'version: 1\ntraces: off\n' });
  assert.equal(readTraces(root, { stateDir }).decisions.length, 0, 'recording is off, nothing was recorded through the store');
  // the earlier records exist on disk from before the switch: write them raw to prove the export still refuses them
  const other = await setup();
  fs.mkdirSync(traceDir(root, { stateDir }), { recursive: true });
  fs.copyFileSync(path.join(traceDir(other.root, { stateDir: other.stateDir }), TRACE_FILE), path.join(traceDir(root, { stateDir }), TRACE_FILE));
  assert.equal(readTraces(root, { stateDir }).decisions.length, 120, 'reading is not gated by the switch');
  for (const write of [false, true]) {
    const r = exportDataset(root, opts({ write }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DATASET_EMPTY');
    assert.match(r.message, /traces: off/);
    assert.equal(r.preview.projects[0].optedOut, true);
  }
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(readExportLedger(root, { stateDir }), []);
  const two = buildDatasetBundle([{ key: 'a', decisions: [], enabled: false }, { key: 'b', decisions: readTraces(other.root, { stateDir: other.stateDir }).decisions.slice(0, 10), enabled: true }], { now: FIXTURE_NOW, constructVersion: VERSION });
  assert.deepEqual(two.manifest.projects, [{ keyHash: 'b', records: 10 }], 'an opted-out project is not even named in the manifest');
});

test('the export ledger lives in the state directory: one entry per dataset, with the test ids, written only by --yes', async () => {
  const { root, stateDir, opts } = await setup();
  exportDataset(root, opts());
  assert.equal(readExportLedger(root, { stateDir }).length, 0);
  const r = exportDataset(root, opts({ write: true }));
  exportDataset(root, opts({ write: true }));
  const ledger = readExportLedger(root, { stateDir });
  assert.equal(ledger.length, 1, 'the same dataset is recorded once');
  const [entry] = ledger;
  assert.equal(entry.datasetHash, r.manifest.datasetHash);
  assert.equal(entry.testIds.length, r.manifest.counts.test);
  assert.ok(entry.testIds.every((id) => splitOf(id) === 'test'));
  assert.deepEqual(entry.chooserIds, [NOUN_CHOOSER, SHAPE_CHOOSER]);
  assert.equal(findExport(root, r.manifest.datasetHash, { stateDir })?.createdAt, FIXTURE_NOW);
  assert.equal(findExport(root, '0'.repeat(64), { stateDir }), null);
  assert.ok(path.resolve(traceDir(root, { stateDir })).startsWith(stateDir));
  assert.equal(fs.existsSync(path.join(root, 'exports')), false);
  assert.deepEqual(fs.readdirSync(root), [], 'nothing was written into the project');
  const dir = path.join(stateDir, 'exports');
  assert.ok(fs.existsSync(dir), 'under <state>/exports/<project key>/ledger.jsonl');
});

test('--since and --chooser filter the export; a bad --since is a typed failure', async () => {
  const { root, opts } = await setup();
  const only = exportDataset(root, opts({ chooser: SHAPE_CHOOSER }));
  assert.equal(only.preview.records, 30);
  assert.deepEqual(Object.keys(only.preview.byChooser), [SHAPE_CHOOSER]);
  const since = exportDataset(root, opts({ since: '2026-09-01T10:00:00Z' }));
  assert.equal(since.preview.records, 60);
  assert.equal(since.preview.dateRange.from, '2026-09-01T10:00:00.000Z');
  assert.equal(exportDataset(root, opts({ since: '2026-09-02' })).code, 'DATASET_EMPTY');
  assert.deepEqual(parseSince('2026-09-01'), { ok: true, since: '2026-09-01T00:00:00.000Z' });
  for (const bad of ['yesterday', '2026-13-45', '01/02/2026', '']) assert.equal(parseSince(bad).code, 'SINCE_INVALID', bad);
  assert.equal(exportDataset(root, opts({ since: 'soon' })).code, 'SINCE_INVALID');
  assert.equal(exportDataset(root, opts({ out: '' })).code, 'OUT_REQUIRED');
});

test('writes stay inside the chosen folder: not inside the project, no link followed, no foreign files touched, typed failures', async () => {
  const { root, opts } = await setup();
  assert.equal(exportDataset(root, opts({ write: true, out: path.join(root, 'bundle') })).code, 'OUT_INSIDE_PROJECT');
  assert.equal(exportDataset(root, opts({ write: true, out: root })).code, 'OUT_INSIDE_PROJECT');
  assert.deepEqual(fs.readdirSync(root), [], 'nothing was written into the project');

  const busy = makeTempDir('og647-busy-');
  fs.writeFileSync(path.join(busy, 'keep.txt'), 'mine');
  assert.equal(exportDataset(root, opts({ write: true, out: busy })).code, 'OUT_NOT_EMPTY');
  assert.equal(fs.readFileSync(path.join(busy, 'keep.txt'), 'utf8'), 'mine');

  const file = path.join(makeTempDir('og647-file-'), 'f');
  fs.writeFileSync(file, 'x');
  assert.equal(exportDataset(root, opts({ write: true, out: file })).code, 'OUT_NOT_DIRECTORY');

  const real = makeTempDir('og647-real-');
  const link = path.join(makeTempDir('og647-link-'), 'l');
  fs.symlinkSync(real, link);
  assert.equal(exportDataset(root, opts({ write: true, out: link })).code, 'OUT_SYMLINK');
  assert.deepEqual(fs.readdirSync(real), []);

  // a bundle file that is a link to a file elsewhere is never written through
  const victim = path.join(makeTempDir('og647-victim-'), 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  const out = path.join(makeTempDir('og647-out2-'), 'b');
  fs.mkdirSync(out);
  fs.symlinkSync(victim, path.join(out, 'dataset.jsonl'));
  const r = exportDataset(root, opts({ write: true, out }));
  assert.equal(r.code, 'OUT_SYMLINK');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
});

test('FUZZ: planted secrets and paths in any string of a record never reach dataset.jsonl, the manifest, the schema or the README', async () => {
  const { root, stateDir } = await setup();
  const { decisions } = readTraces(root, { stateDir });
  const planted = [
    '/etc/passwd', '/home/alice/.ssh/id_rsa', 'C:\\Users\\bob\\secrets.txt', '~/project/.env', './config/keys.json', '../../outside/file',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'sk-live-abcdefghijklmnop1234', 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abcdefghij',
    '-----BEGIN RSA PRIVATE KEY-----', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc', 'Bearer abcdefghijklmnopqrstuvwxyz', 'api_key=abcdefgh12345678',
    'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2', 'password: supersecret99',
  ];
  const slots = [
    (t, s) => { t.summary.question = `What is ${s}?`; },
    (t, s) => { t.summary.options[0].label = s; },
    (t, s) => { t.summary.options[1].why = `because ${s}`; },
    (t, s) => { t.chooser.question = `q ${s}`; },
    (t, s) => { t.suggestion.reason = s; },
    (t, s) => { t.summary.extra = { nested: [s] }; },
    (t, s) => { t.summary[`key ${s}`] = 1; },
    (t, s) => { t.provider.name = s; },
  ];
  const clean = decisions.slice(0, 20);
  const dirty = [];
  let i = 30;
  for (const s of planted) {
    for (const slot of slots) {
      const t = structuredClone(decisions[i % 60]);
      i += 1;
      if (!t.suggestion) t.suggestion = { option: t.options[0], reason: 'first' };
      slot(t, s);
      t.id = traceId(t);
      dirty.push(t);
    }
  }
  const built = buildDatasetBundle([{ key: 'k', decisions: [...clean, ...dirty] }], { now: FIXTURE_NOW, constructVersion: VERSION });
  assert.equal(built.ok, true);
  assert.equal(built.manifest.counts.records, 20, 'only the clean records survive');
  assert.equal(built.manifest.counts.dropped, dirty.length);
  const everything = Object.values(built.files).join('\n');
  for (const s of planted) assert.equal(everything.includes(s), false, `${s} leaked`);
  // and nothing left in the file looks like a path or a secret in any string
  const scan = (v) => {
    if (typeof v === 'string') { assert.equal(looksLikeSecret(v), null, v.slice(0, 40)); assert.equal(looksLikePath(v), false, v.slice(0, 40)); } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { scan(k); if (k !== 'id' && k !== 'at') scan(x); }
  };
  for (const line of built.files['dataset.jsonl'].split('\n').filter(Boolean)) scan(JSON.parse(line));
  // the raw store refuses a planted line too: it is skipped when read
  const dir = traceDir(root, { stateDir });
  fs.appendFileSync(path.join(dir, TRACE_FILE), `${JSON.stringify(dirty[0])}\n`);
  assert.equal(readTraces(root, { stateDir }).decisions.length, 120);
});

test('buildTrace-made records are accepted as they are: the same trace goes through unchanged', () => {
  const summary = { id: 'q', question: 'Which?', options: [{ id: 'a', label: 'A', enabled: true, why: '' }, { id: 'b', label: 'B', enabled: true, why: '' }], chosen: null };
  const { trace } = buildTrace({ summary, chosen: 'a' }, { at: '2026-09-25T10:00:00.000Z' });
  const built = buildDatasetBundle([{ key: 'k', decisions: [trace] }], { now: FIXTURE_NOW, constructVersion: VERSION });
  assert.deepEqual(JSON.parse(built.files['dataset.jsonl']).trace, trace);
  assert.equal(datasetSchema().$id, DATASET_BUNDLE_VERSION);
});
