// Line logic verification, step 7 (spec I, wiring): every unit of an import folder against the folder before the
// import, as UnitVerdicts and one step summary. Import v2's verifyImport (importVerify.mjs) calls it and returns the
// result as its `logic` check, which the Cockpit Import agent's Checks list shows as one more row.
//
// One function per unit: the logic map's units of the folder's code files now (buildLogicMap), grouped by file and
// function (module-level units have no function to verify). The before side is the import baseline's sources
// (<folder>/line/import-baseline.json, importLoopDisk.mjs `save('baseline')`) written to a temporary root with the
// project's tsconfig.json and package.json, so pairBefore finds moved and renamed units by canonical form.
//
// The layers are not chosen here: each unit goes through verifyPair, whose RUNNERS registry (by layer name, in
// escalation.mjs order) and classifyBefore (purity.mjs's classifyUnit as soon as that file exists) decide. Step 2
// (purity.mjs) and step 4 (RUNNERS.isolated's effect runner) therefore join without a change here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLogicMap } from '../logicMap.mjs';
import { verifyPair } from './verifyPair.mjs';
import { summarizeStep } from './verdict.mjs';

/** @typedef {import('./contract.mjs').UnitVerdict} UnitVerdict */
/** @typedef {import('./contract.mjs').UnitRef} UnitRef */
/** @typedef {import('./contract.mjs').StepSummary} StepSummary */

/** Where the import baseline lives inside the folder (importLoopDisk.mjs BASELINE_FILE). */
export const IMPORT_BASELINE_FILE = 'line/import-baseline.json';
export const MAX_IMPORT_UNITS = 200;

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const NOT_UNITS = /(?:\.d\.ts|\.(?:test|spec)\.[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'line', '__line_characterization__']);

/** The folder's code files (project-relative): no tests, declarations, Line state or generated tests. */
export function folderCodeFiles(projectRoot, folder) {
  const out = [];
  const visit = (abs) => {
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(p); } else if (CODE.test(e.name) && !NOT_UNITS.test(e.name)) out.push(path.relative(projectRoot, p).split(path.sep).join('/'));
    }
  };
  visit(path.join(projectRoot, folder));
  return out.sort();
}

/**
 * One UnitRef per function with logic in the given files (the first logic-map unit of each file and function).
 * @param {string} root
 * @param {string[]} files
 * @returns {UnitRef[]}
 */
export function functionUnits(root, files) {
  const seen = new Set();
  /** @type {UnitRef[]} */
  const out = [];
  for (const u of buildLogicMap(root, files).units) {
    const k = `${u.file}#${u.fn}`;
    if (u.fn === '<module>' || seen.has(k)) continue;
    seen.add(k);
    out.push({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, file: u.file, fn: u.fn, line: u.line });
  }
  return out;
}

/** The import baseline's sources, or null when the folder has none (no Import v2 baseline yet). */
export function readImportBaseline(projectRoot, folder) {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(projectRoot, folder, IMPORT_BASELINE_FILE), 'utf8'));
    return b && typeof b.sources === 'object' && b.sources ? /** @type {Record<string, string>} */ (b.sources) : null;
  } catch { return null; }
}

/**
 * The before root: the baseline's sources at their project-relative paths, plus the project's tsconfig.json and
 * package.json (the characterizer's analysis reads them). The caller removes it.
 * @param {string} projectRoot
 * @param {Record<string, string>} sources
 * @returns {string}
 */
export function materializeBefore(projectRoot, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lv-before-'));
  for (const [rel, text] of Object.entries(sources)) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  for (const f of ['tsconfig.json', 'package.json']) {
    if (!sources[f] && fs.existsSync(path.join(projectRoot, f))) fs.copyFileSync(path.join(projectRoot, f), path.join(root, f));
  }
  return root;
}

/**
 * Verify every function unit of an import folder against the folder before the import.
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.folder
 * @param {Record<string, string>} args.sources  The baseline's sources per project-relative file.
 * @param {import('./contract.mjs').EscalationLevel[]} [args.levels]
 * @param {(unit: UnitRef) => import('./contract.mjs').TransformId[]|null} [args.transformsOf]  The closed-set
 *   transforms the import applied to a unit; default null for every unit (nobody says how it was edited, so a unit is
 *   tested at best, never proven).
 * @param {number} [args.maxUnits]
 * @returns {Promise<{verdicts: UnitVerdict[], summary: StepSummary, left: number}>} `left`: units over maxUnits, not run.
 */
export async function verifyImportUnits({ projectRoot, folder, sources, levels = ['L0', 'L1'], transformsOf = () => null, maxUnits = MAX_IMPORT_UNITS }) {
  const units = functionUnits(projectRoot, folderCodeFiles(projectRoot, folder));
  const run = units.slice(0, maxUnits);
  const beforeRoot = materializeBefore(projectRoot, sources);
  try {
    /** @type {UnitVerdict[]} */
    const verdicts = [];
    for (const unit of run) verdicts.push(await verifyPair({ beforeRoot, afterRoot: projectRoot, unit, transforms: transformsOf(unit), levels }));
    return { verdicts, summary: summarizeStep('import', verdicts), left: units.length - run.length };
  } finally {
    fs.rmSync(beforeRoot, { recursive: true, force: true });
  }
}

/**
 * The `logic` check of verifyImport: one sentence ("Logic verification: N proven, M tested, K unverified."), one
 * detail line per unit, and the verdicts themselves. Fails on a unit whose behaviour changed (its exact location in
 * the detail); unverified units do not fail it, they are counted.
 * @param {string} projectRoot
 * @param {string} folder
 * @param {{levels?: any[], transformsOf?: any, maxUnits?: number}} [o]
 * @returns {Promise<{id: 'logic', state: 'pass'|'fail'|'skipped', sentence: string, detail?: string, summary?: StepSummary, units?: UnitVerdict[]}>}
 */
export async function logicCheck(projectRoot, folder, o = {}) {
  const sources = readImportBaseline(projectRoot, folder);
  if (!sources || !Object.keys(sources).length) return { id: 'logic', state: 'skipped', sentence: `Logic was not verified unit by unit: ${folder} has no import baseline (Line Import v2 writes it when the import starts).` };
  let r;
  try {
    r = await verifyImportUnits({ projectRoot, folder, sources, ...o });
  } catch (err) {
    return { id: 'logic', state: 'skipped', sentence: 'Logic could not be verified unit by unit.', detail: String(/** @type {Error} */ (err)?.message ?? err) };
  }
  if (!r.verdicts.length) return { id: 'logic', state: 'skipped', sentence: `There are no functions with logic in ${folder} to verify.` };
  const left = r.left ? ` ${r.left} more unit${r.left === 1 ? ' was' : 's were'} not verified (limit ${o.maxUnits ?? MAX_IMPORT_UNITS}).` : '';
  const order = { changed: 0, unverified: 1, 'not-extracted': 2, tested: 3, proven: 4 };
  const lines = [...r.verdicts].sort((a, b) => order[a.status] - order[b.status]).map((v) => `${v.status} ${v.unit.file}#${v.unit.fn} (${v.layer}): ${v.sentence}`);
  return {
    id: 'logic', state: r.summary.counts.changed ? 'fail' : 'pass', sentence: `Logic verification: ${r.summary.sentence}${left}`,
    detail: lines.join('\n'), summary: r.summary, units: r.verdicts,
  };
}
