// #647 (epic #616) -- verifying a model bundle that was trained ELSEWHERE and comes back as a folder. The whole point: it is
// DATA, and this module refuses everything that is not.
//
//   allowed files (and nothing else)   manifest.json  checksums.txt  eval-report.json  MODEL_CARD.md  features.json  prototypes.json  model.onnx
//   refused                            any other name (a script, a pickle, a .py, an executable, an archive), a symbolic link, a
//                                      sub-folder, a name with a path in it, a file over its size cap, a file that starts like an
//                                      executable, a pickle or an archive, a checksum that does not match, a manifest that
//                                      disagrees with the files, a schema version that is not ours, a dataset hash this project
//                                      never exported
//   never                              executes, imports, unpickles, unzips or evals anything in the folder
//
// Files are opened with O_NOFOLLOW, sized before they are read, and read ONCE into memory: everything is verified on those bytes
// and the same bytes are what gets stored, so a file changing between the check and the copy cannot slip through. Every failure is
// `{ ok: false, code, message }` (never a throw, never a stack trace) and the message holds no absolute path.
// Decision record: docs/TRAIN-ELSEWHERE.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TRACE_VERSION } from './decision-trace.mjs';
import { DATASET_BUNDLE_VERSION } from './decision-dataset.mjs';
import { validateFeaturesModel, FEATURE_VERSION } from './decision-features.mjs';
import { PROVIDER_NAME_PATTERN } from './decision-plugin.mjs';

/** The `schema` string of a model bundle's `manifest.json`. */
export const MODEL_BUNDLE_VERSION = 'construct.model-bundle.v1';
/** The only file names a model bundle may hold. */
export const MODEL_ALLOWED_FILES = Object.freeze(['manifest.json', 'checksums.txt', 'eval-report.json', 'MODEL_CARD.md', 'features.json', 'prototypes.json', 'model.onnx']);
/** Size caps in bytes, per file; the whole bundle is capped at `total`. */
export const MODEL_SIZE_CAPS = Object.freeze({ 'manifest.json': 64 * 1024, 'checksums.txt': 16 * 1024, 'eval-report.json': 1024 * 1024, 'MODEL_CARD.md': 256 * 1024, 'features.json': 8 * 1024 * 1024, 'prototypes.json': 8 * 1024 * 1024, 'model.onnx': 128 * 1024 * 1024, total: 200 * 1024 * 1024 });
/** The model kinds a manifest may declare and the file that IS the model; only `features` can be loaded by this version. */
export const MODEL_KINDS = Object.freeze({ features: 'features.json', prototypes: 'prototypes.json', onnx: 'model.onnx' });
/** A model version: what the registry and a trace record next to the provider name. */
export const MODEL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const fail = (code, message, problems) => ({ ok: false, code, message, ...(problems ? { problems } : {}) });
const shown = (name) => JSON.stringify(String(name).replace(/[^\x20-\x7e]/g, '?').slice(0, 40));
const HEX64 = /^[0-9a-f]{64}$/;
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a file starts with when it is code or a container, not data: a script, an ELF/Mach-O/PE executable, an archive, a pickle. */
function executableSniff(buf) {
  if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) return 'a script (#!)';
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'an ELF executable';
  if (buf.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(buf.readUInt32BE(0))) return 'a Mach-O executable';
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'a Windows executable';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5)) return 'a zip archive (a torch or pickle container)';
  if (buf.length >= 2 && buf[0] === 0x80 && buf[1] >= 2 && buf[1] <= 5) return 'a Python pickle';
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'a gzip archive';
  return null;
}

/** Read one plain file safely: no link followed, a regular file, under its cap. */
function readPlainFile(dir, name) {
  const target = path.join(dir, name);
  let fd;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (e) {
    return e?.code === 'ELOOP' ? fail('MODEL_SYMLINK', `${shown(name)} is a symbolic link; a model bundle holds plain files only.`) : fail('MODEL_UNREADABLE', `${shown(name)} could not be read (${e?.code ?? 'error'}).`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return fail('MODEL_FILE_NOT_ALLOWED', `${shown(name)} is not a plain file.`);
    const cap = MODEL_SIZE_CAPS[name];
    if (st.size > cap) return fail('MODEL_TOO_LARGE', `${shown(name)} is ${st.size} bytes; the cap for it is ${cap}.`);
    const buf = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = fs.readSync(fd, buf, read, st.size - read, read);
      if (n <= 0) break;
      read += n;
    }
    return { ok: true, data: read === st.size ? buf : buf.subarray(0, read) };
  } finally {
    fs.closeSync(fd);
  }
}

const isText = (buf) => !buf.includes(0) && new TextDecoder('utf-8', { fatal: true }).decode(buf) !== undefined;

/**
 * Validate a model manifest (the parsed JSON of `manifest.json`): schema and version strings, a provider-safe `name`, a version,
 * the model kind, the dataset hash and the `files` table (allowed names only, each with a sha256). Does not look at any file.
 *
 * @param {unknown} manifest The parsed JSON.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }} `ok`, or the first typed problem (`MODEL_MANIFEST_INVALID`, `MODEL_SCHEMA_MISMATCH`, `MODEL_PATH_TRAVERSAL`).
 *
 * @example
 * validateModelManifest({ schema: 'nope' }).code; // => 'MODEL_SCHEMA_MISMATCH'
 */
export function validateModelManifest(manifest) {
  if (!isPlainObject(manifest)) return fail('MODEL_MANIFEST_INVALID', 'manifest.json must be a JSON object.');
  if (manifest.schema !== MODEL_BUNDLE_VERSION) return fail('MODEL_SCHEMA_MISMATCH', `manifest.json schema must be "${MODEL_BUNDLE_VERSION}" (this Construct reads that one).`);
  if (manifest.traceVersion !== TRACE_VERSION) return fail('MODEL_SCHEMA_MISMATCH', `The model was trained on "${String(manifest.traceVersion).slice(0, 30)}", not ${TRACE_VERSION}.`);
  if (manifest.datasetSchema !== DATASET_BUNDLE_VERSION) return fail('MODEL_SCHEMA_MISMATCH', `The model names the dataset schema "${String(manifest.datasetSchema).slice(0, 40)}", not ${DATASET_BUNDLE_VERSION}.`);
  const problems = [];
  if (typeof manifest.name !== 'string' || !PROVIDER_NAME_PATTERN.test(manifest.name) || manifest.name === 'rules' || manifest.name === 'off') problems.push('name must be a provider name (lowercase letters, digits and . _ -, at most 40 characters, not rules or off)');
  if (typeof manifest.version !== 'string' || !MODEL_VERSION_PATTERN.test(manifest.version)) problems.push('version must be letters, digits and . _ - (at most 32 characters)');
  if (!Object.hasOwn(MODEL_KINDS, manifest.kind)) problems.push(`kind must be one of ${Object.keys(MODEL_KINDS).join(', ')}`);
  if (typeof manifest.datasetHash !== 'string' || !HEX64.test(manifest.datasetHash)) problems.push('datasetHash must be the 64-character sha256 of the dataset the model was trained on');
  if (manifest.featureVersion !== undefined && manifest.featureVersion !== FEATURE_VERSION) problems.push(`featureVersion must be ${FEATURE_VERSION}`);
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) problems.push('createdAt must be an ISO time');
  if (!isPlainObject(manifest.files)) problems.push('files must map each file name to { sha256, bytes }');
  else {
    for (const [name, entry] of Object.entries(manifest.files)) {
      if (/[\\/]/.test(name) || name.includes('..') || name.startsWith('.')) return fail('MODEL_PATH_TRAVERSAL', `manifest.json lists ${shown(name)}, which is a path, not a file name.`);
      if (!MODEL_ALLOWED_FILES.includes(name) || name === 'manifest.json' || name === 'checksums.txt') problems.push(`files lists ${shown(name)}, which a manifest may not list`);
      else if (!isPlainObject(entry) || typeof entry.sha256 !== 'string' || !HEX64.test(entry.sha256)) problems.push(`files.${name} needs a sha256`);
    }
  }
  if (problems.length) return fail('MODEL_MANIFEST_INVALID', `manifest.json is not valid: ${problems.slice(0, 4).join('; ')}.`, problems);
  return { ok: true };
}

/** Parse `checksums.txt` (sha256sum format, `<64 hex>  <name>`); a name with a path in it is refused. */
function parseChecksums(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) return fail('MODEL_CHECKSUM_INVALID', 'checksums.txt has a line that is not "<sha256>  <file name>".');
    const name = m[2];
    if (/[\\/]/.test(name) || name.includes('..') || name.startsWith('.') || !MODEL_ALLOWED_FILES.includes(name)) return fail(/[\\/]|\.\./.test(name) ? 'MODEL_PATH_TRAVERSAL' : 'MODEL_FILE_NOT_ALLOWED', `checksums.txt lists ${shown(name)}, which is not an allowed file name.`);
    if (map.has(name)) return fail('MODEL_CHECKSUM_INVALID', `checksums.txt lists ${shown(name)} twice.`);
    map.set(name, m[1]);
  }
  return { ok: true, map };
}

/**
 * @typedef {{ ok: true, manifest: object, kind: string, modelFile: string, loadable: boolean, files: Record<string, Buffer>, model: object | null, evalReport: object, sizes: Record<string, number>, notes: string[] }} VerifiedModel
 * A verified bundle: the manifest, the kind and its model file, whether this version can load it (`features` only), the bytes of
 * every file (verified, and what gets stored), the validated features model when loadable, the parsed eval report and the notes.
 */

/**
 * Verify a model bundle folder WITHOUT executing, importing or extracting anything in it, and read it into memory. Order: the
 * folder is a real folder, every entry is an allowed plain file (no link, no sub-folder, no other name), sizes are under their
 * caps, files are read once through O_NOFOLLOW, none starts like an executable, an archive or a pickle, text files are text,
 * `checksums.txt` matches the bytes and lists every file, `manifest.json` is valid and agrees with the bytes, the schema
 * versions are ours, the dataset hash is one THIS project exported (`findExport`), the model file parses as its kind (a
 * `features.json` is validated; `.onnx` and `prototypes.json` are only size-, hash- and sniff-checked), and `eval-report.json` is
 * JSON that agrees on the dataset hash.
 *
 * @param {string} dir The bundle folder.
 * @param {{ findExport: (datasetHash: string) => object | null }} options `findExport` answers whether this project exported a dataset (the ledger); a bundle for an unknown dataset is refused.
 * @returns {VerifiedModel | { ok: false, code: string, message: string, problems?: string[] }} The verified bundle, or the typed reason it is refused (`MODEL_DIR_NOT_FOUND`, `MODEL_SYMLINK`, `MODEL_FILE_NOT_ALLOWED`, `MODEL_TOO_LARGE`, `MODEL_EXECUTABLE`, `MODEL_NOT_TEXT`, `MODEL_MISSING_FILE`, `MODEL_CHECKSUM_INVALID`, `MODEL_CHECKSUM_MISMATCH`, `MODEL_CHECKSUM_MISSING`, `MODEL_PATH_TRAVERSAL`, `MODEL_MANIFEST_INVALID`, `MODEL_MANIFEST_MISMATCH`, `MODEL_SCHEMA_MISMATCH`, `MODEL_DATASET_UNKNOWN`, `MODEL_FEATURES_INVALID`, `MODEL_REPORT_INVALID`, `MODEL_UNREADABLE`).
 *
 * @example
 * const v = verifyModelBundle(dir, { findExport: (h) => findExport(root, h) });
 * if (v.ok) v.manifest.name; // => 'features-lr'
 */
export function verifyModelBundle(dir, options) {
  try {
    const resolved = path.resolve(String(dir ?? ''));
    let st;
    try {
      st = fs.lstatSync(resolved);
    } catch {
      return fail('MODEL_DIR_NOT_FOUND', 'The model folder does not exist.');
    }
    if (st.isSymbolicLink()) return fail('MODEL_SYMLINK', 'The model folder is a symbolic link; name the real folder.');
    if (!st.isDirectory()) return fail('MODEL_DIR_NOT_FOUND', 'The model path is not a folder.');

    const entries = fs.readdirSync(resolved, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (e.isSymbolicLink()) return fail('MODEL_SYMLINK', `${shown(e.name)} is a symbolic link; a model bundle holds plain files only.`);
      if (!MODEL_ALLOWED_FILES.includes(e.name)) return fail('MODEL_FILE_NOT_ALLOWED', `${shown(e.name)} is not allowed in a model bundle (allowed: ${MODEL_ALLOWED_FILES.join(', ')}). Only plain data is imported; nothing else is opened.`);
      if (!e.isFile()) return fail('MODEL_FILE_NOT_ALLOWED', `${shown(e.name)} is not a plain file.`);
    }
    const names = entries.map((e) => e.name);
    let total = 0;
    for (const name of names) total += fs.lstatSync(path.join(resolved, name)).size;
    if (total > MODEL_SIZE_CAPS.total) return fail('MODEL_TOO_LARGE', `The bundle is ${total} bytes; the cap is ${MODEL_SIZE_CAPS.total}.`);

    const files = {};
    for (const name of names) {
      const r = readPlainFile(resolved, name);
      if (!r.ok) return r;
      const sniff = executableSniff(r.data);
      if (sniff) return fail('MODEL_EXECUTABLE', `${shown(name)} starts like ${sniff}; only plain data is imported.`);
      if (name !== 'model.onnx') {
        try {
          if (!isText(r.data)) return fail('MODEL_NOT_TEXT', `${shown(name)} holds binary data; it must be text.`);
        } catch {
          return fail('MODEL_NOT_TEXT', `${shown(name)} is not valid UTF-8 text.`);
        }
      }
      files[name] = r.data;
    }
    for (const required of ['manifest.json', 'checksums.txt', 'eval-report.json', 'MODEL_CARD.md']) if (!files[required]) return fail('MODEL_MISSING_FILE', `The bundle has no ${required}.`);

    const parsed = parseChecksums(files['checksums.txt'].toString('utf8'));
    if (!parsed.ok) return parsed;
    for (const name of names) {
      if (name === 'checksums.txt') continue;
      if (!parsed.map.has(name)) return fail('MODEL_CHECKSUM_MISSING', `checksums.txt does not list ${shown(name)}.`);
      if (parsed.map.get(name) !== sha256(files[name])) return fail('MODEL_CHECKSUM_MISMATCH', `${shown(name)} does not match its checksum: the file changed after the bundle was made.`);
    }
    for (const listed of parsed.map.keys()) if (!files[listed]) return fail('MODEL_CHECKSUM_MISSING', `checksums.txt lists ${shown(listed)}, which is not in the bundle.`);

    let manifest;
    try {
      manifest = JSON.parse(files['manifest.json'].toString('utf8'));
    } catch {
      return fail('MODEL_MANIFEST_INVALID', 'manifest.json is not JSON.');
    }
    const valid = validateModelManifest(manifest);
    if (!valid.ok) return valid;
    const modelFile = MODEL_KINDS[manifest.kind];
    if (!files[modelFile]) return fail('MODEL_MISSING_FILE', `The manifest says this is a "${manifest.kind}" model, so the bundle needs ${modelFile}.`);
    for (const [name, entry] of Object.entries(manifest.files)) {
      if (!files[name]) return fail('MODEL_MANIFEST_MISMATCH', `manifest.json lists ${shown(name)}, which is not in the bundle.`);
      if (entry.sha256 !== sha256(files[name])) return fail('MODEL_MANIFEST_MISMATCH', `manifest.json has another sha256 for ${shown(name)} than the file has.`);
    }
    for (const name of names) if (name !== 'manifest.json' && name !== 'checksums.txt' && !Object.hasOwn(manifest.files, name)) return fail('MODEL_MANIFEST_MISMATCH', `manifest.json does not list ${shown(name)}.`);

    if (!options.findExport(manifest.datasetHash)) return fail('MODEL_DATASET_UNKNOWN', 'The model claims a dataset this project never exported (its dataset hash is not in the export ledger). Only a model trained on a bundle made by `construct traces export --yes` here is imported.');

    let evalReport;
    try {
      evalReport = JSON.parse(files['eval-report.json'].toString('utf8'));
    } catch {
      return fail('MODEL_REPORT_INVALID', 'eval-report.json is not JSON.');
    }
    if (!isPlainObject(evalReport) || (evalReport.datasetHash !== undefined && evalReport.datasetHash !== manifest.datasetHash)) return fail('MODEL_REPORT_INVALID', 'eval-report.json is not an object for the same dataset hash as the manifest.');

    const notes = [];
    let model = null;
    let loadable = false;
    if (manifest.kind === 'features') {
      let json;
      try {
        json = JSON.parse(files['features.json'].toString('utf8'));
      } catch {
        return fail('MODEL_FEATURES_INVALID', 'features.json is not JSON.');
      }
      const checked = validateFeaturesModel(json);
      if (!checked.ok) return fail('MODEL_FEATURES_INVALID', `features.json is not a valid structured-feature model: ${checked.errors.slice(0, 3).join('; ')}.`, checked.errors);
      model = json;
      loadable = true;
    } else if (manifest.kind === 'prototypes') {
      try {
        JSON.parse(files['prototypes.json'].toString('utf8'));
      } catch {
        return fail('MODEL_FEATURES_INVALID', 'prototypes.json is not JSON.');
      }
      notes.push('prototypes.json is verified and stored, but this version has no loader for it (the embedding classifier is #645): it is not replayed and cannot be enabled yet.');
    } else {
      notes.push('model.onnx is verified (size, checksum, not an executable or archive) and stored, but this version has NO ONNX loader: it is not replayed and cannot be enabled yet.');
    }
    return { ok: true, manifest, kind: manifest.kind, modelFile, loadable, files, model, evalReport, sizes: Object.fromEntries(names.map((n) => [n, files[n].length])), notes };
  } catch (e) {
    return fail('MODEL_VERIFY_FAILED', `The bundle could not be verified (${String(e?.code ?? e?.message ?? e).split('\n')[0].slice(0, 80)}).`);
  }
}
