// Training records and the held-out split (task t3-3a-records,
// docs/line/FLUENT-PLAN-2026-10-15.md "Wave 2 leaves"; gold/student are C2, verdict is C4's).
// No dependencies beyond node: builtins.
//
// Choices the contract left open:
// - All six keys must be present; `student` and `verdict` may be null (a gold-only record),
//   `gold` must be an object. The C2 bodies are not re-validated here (that is the gate's job).
// - The record is frozen shallowly; gold/student are kept by reference.
// - readRecords returns [] for a missing file and re-checks every line through record().
// - splitBySection orders sections by sha256(seed + '\0' + section) and moves whole sections
//   to held-out in that order, stopping where the held-out entry share is closest to the
//   fraction. This keeps the split deterministic and seed-driven, with the share near the
//   fraction even when section sizes vary (a per-section coin flip can miss by several points).

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const KEYS = ['entry', 'section', 'source', 'gold', 'student', 'verdict'];
const SOURCES = ['gold', 'corrected', 'codemod'];
const VERDICTS = ['same', 'equivalent', 'wrong'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function record(fields) {
  if (!isObject(fields)) throw new Error('A record must be an object with entry, section, source, gold, student and verdict.');
  const unknown = Object.keys(fields).filter((k) => !KEYS.includes(k));
  if (unknown.length) throw new Error(`The record has unknown field \`${unknown[0]}\`; only ${KEYS.join(', ')} are allowed.`);
  const missing = KEYS.filter((k) => !(k in fields) || fields[k] === undefined);
  if (missing.length) throw new Error(`The record is missing field \`${missing[0]}\`.`);
  const { entry, section, source, gold, student, verdict } = fields;
  if (typeof entry !== 'string' || !entry) throw new Error('The record field `entry` must be a non-empty string.');
  if (typeof section !== 'string' || !section) throw new Error('The record field `section` must be a non-empty string.');
  if (!SOURCES.includes(source)) throw new Error(`The record field \`source\` must be one of ${SOURCES.join(', ')}.`);
  if (!isObject(gold)) throw new Error('The record field `gold` must be a C2 answer object.');
  if (student !== null && !isObject(student)) throw new Error('The record field `student` must be a C2 answer object or null.');
  if (verdict !== null && !VERDICTS.includes(verdict)) throw new Error(`The record field \`verdict\` must be null or one of ${VERDICTS.join(', ')}.`);
  return Object.freeze({ entry, section, source, gold, student, verdict });
}

export function appendRecords(path, records) {
  if (!Array.isArray(records)) throw new Error('appendRecords takes an array of records.');
  const lines = records.map((r) => JSON.stringify(record(r)));
  if (!lines.length) return 0;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lines.join('\n') + '\n');
  return lines.length;
}

export function readRecords(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, i) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Line ${i + 1} of ${path} is not valid JSON.`);
      }
      return record(parsed);
    });
}

const rank = (seed, section) => createHash('sha256').update(`${seed}\0${section}`).digest('hex');

export function splitBySection(entries, { heldOut = 0.2, seed = 'line' } = {}) {
  if (!Array.isArray(entries)) throw new Error('splitBySection takes an array of entries.');
  if (typeof heldOut !== 'number' || !(heldOut >= 0 && heldOut <= 1)) throw new Error('The held-out fraction must be a number from 0 to 1.');
  const sizes = new Map();
  for (const e of entries) {
    if (!e || typeof e.section !== 'string' || !e.section) throw new Error('Every entry needs a non-empty string `section`.');
    sizes.set(e.section, (sizes.get(e.section) ?? 0) + 1);
  }
  const ordered = [...sizes.keys()]
    .map((s) => [rank(String(seed), s), s])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, s]) => s);
  const target = heldOut * entries.length;
  const chosen = new Set();
  let taken = 0;
  for (const s of ordered) {
    const next = taken + sizes.get(s);
    if (Math.abs(next - target) >= Math.abs(taken - target)) break;
    chosen.add(s);
    taken = next;
  }
  const train = [];
  const held = [];
  for (const e of entries) (chosen.has(e.section) ? held : train).push(e);
  return { train, heldOut: held, heldOutSections: [...chosen].sort() };
}
