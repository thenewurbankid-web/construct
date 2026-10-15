// t1-3c-entries: C1 reference entries for section 'Array', each with the
// catalog atoms whose `js` uses the same member (candidates for a request).
// Contract: docs/line/FLUENT-PLAN-2026-10-15.md, "Wave 2 leaves" and C1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REFERENCE_URL = new URL('../../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url);
const CATALOG_URL = new URL('../../../line-smith/src/atoms/catalog.json', import.meta.url);

let reference = null;
let catalog = null;

function loadReference() {
  if (!reference) reference = JSON.parse(readFileSync(REFERENCE_URL, 'utf8')).entries;
  return reference;
}

function loadCatalog() {
  if (!catalog) catalog = JSON.parse(readFileSync(CATALOG_URL, 'utf8')).atoms;
  return catalog;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The regex a catalog `js` string must match to use the entry's member, or
 * null when the entry has no plain member (symbol keys, index access).
 * Overload suffixes in the key (`Array.from #2`) are ignored.
 */
export function memberPattern(entry) {
  const key = entry.key.replace(/\s+#\d+$/, '');
  if (key.includes('[')) return null;
  const member = key.slice(key.lastIndexOf('.') + 1);
  switch (entry.kind) {
    case 'static':
      return new RegExp(`(?<![\\w$.])${escapeRegExp(key)}\\(`);
    case 'construct':
      return /\bnew Array\(/;
    case 'call':
      return /(?<!new )(?<![\w$.])Array\(/;
    case 'method':
      return new RegExp(`\\.${escapeRegExp(member)}\\(`);
    case 'property':
      return new RegExp(`\\.${escapeRegExp(member)}(?![\\w$(])`);
    default:
      return null;
  }
}

/** Catalog atoms whose `js` uses the same member as the entry: [{atom, fluent, js}]. */
export function existingAtoms(entry) {
  const pattern = memberPattern(entry);
  if (!pattern) return [];
  return loadCatalog()
    .filter((a) => Array.isArray(a.js) && a.js.some((js) => pattern.test(js)))
    .map((a) => ({ atom: a.atom, fluent: a.fluent, js: a.js }));
}

/** C1 entries whose section is 'Array', each with `candidates` from existingAtoms. */
export function arrayEntries() {
  return loadReference()
    .filter((e) => e.section === 'Array')
    .map((e) => ({ ...e, candidates: existingAtoms(e) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const entries = arrayEntries();
  const withCandidates = entries.filter((e) => e.candidates.length > 0);
  console.log(`Array entries: ${entries.length}`);
  console.log(`with candidates: ${withCandidates.length}`);
  for (const e of entries.slice(0, 10)) {
    const atoms = e.candidates.map((c) => c.atom).join(', ') || '(none)';
    console.log(`  ${e.key}  [${e.kind}]  -> ${atoms}`);
  }
}
