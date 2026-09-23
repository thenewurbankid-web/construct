// #589's own root cause, generalized: SERVICE-001 was registered in DEFAULT_RULES at error
// severity since the rule engine's beginning, but no code anywhere ever produced that rule id --
// it could never fire, and a developer reading the rule list had no way to know. This is a
// static, grep-style regression guard (the same manual check #589's own report describes doing
// by hand) so a rule id can never again be registered with no detector behind it: for every rule
// id in DEFAULT_RULES that isn't 'off' and isn't a numeric threshold override (e.g.
// 'READ-002-max-loc'), its id string must appear, quoted, in at least one real detector source
// file (not the registry itself, not a code-generation comment, not CLI help prose, not docs).
//
// This is deliberately a source-text check, not a "run every rule and assert it fires" check:
// the whole point is to catch a rule that has NO code path producing it at all, which is exactly
// the class of bug #589 found -- and it needs no fixture, no opt-in wiring, no knowledge of what
// each rule actually checks, so it can never itself go stale the way a per-rule fixture list can.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../packages/core/config.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

// Files that legitimately mention a rule id in prose/comments without being the code that
// produces it: the registry itself (config.mjs), the eslint-boundaries exporter's own comment
// enumerating rules it deliberately does NOT cover (exportArchitectureRules.mjs), and the CLI's
// `--help`/usage text (usage.mjs), which quotes rule ids in human-readable descriptions.
const NON_DETECTOR_FILES = new Set([
  path.join(PACKAGES_DIR, 'core', 'config.mjs'),
  path.join(PACKAGES_DIR, 'core', 'exportArchitectureRules.mjs'),
  path.join(PACKAGES_DIR, 'core', 'usage.mjs'),
]);

// #589 (this ticket) fixed SERVICE-001 only, per its own scope. Auditing this registry surfaced
// three more rules in the exact same dead state (registered at a real severity, zero detector
// anywhere) -- filed as a follow-up, #597, rather than fixed here, since fixing them is a
// separate, unscoped change. Each entry here is asserted BELOW to still be genuinely missing, so
// this allowlist cannot silently outlive a real fix (or hide a fix that only partially works).
const KNOWN_GAPS = new Set(['PAGE-001', 'COMPONENT-001', 'PURE-001']);

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 'dist' (e.g. packages/cli/dist/construct.mjs, #525's esbuild bundle) is generated
      // output that mechanically re-includes config.mjs's whole registry text verbatim -- scanning
      // it made every registered rule id look like it has a real detector, exempted-file or not.
      if (entry.name === 'test' || entry.name === 'docs-site' || entry.name === 'dist') continue;
      listSourceFiles(full, out);
    } else if (entry.isFile() && (full.endsWith('.mjs') || full.endsWith('.ts')) && !full.endsWith('.test.mjs')) {
      out.push(full);
    }
  }
  return out;
}

const DETECTOR_SOURCES = listSourceFiles(PACKAGES_DIR)
  .filter((f) => !NON_DETECTOR_FILES.has(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n---\n');

/** Whether `id` appears as a quoted string (`'ID'` or `"ID"`) anywhere in the combined detector
 * source text -- the same shape every real rule in this codebase already uses to emit a
 * violation (`rule: 'ID'`, or a `['ID', ...]` table entry as PAGE-002/003/005 use). */
function hasDetector(id) {
  return new RegExp(`['"]${id}['"]`).test(DETECTOR_SOURCES);
}

function rulesRequiringADetector() {
  return Object.entries(DEFAULT_RULES)
    .filter(([, def]) => !def.numeric && def.severity !== 'off')
    .map(([id]) => id);
}

test('registry: every rule id with severity != off has a detector referenced in real source (regression guard for #589-style dead rules)', () => {
  const missing = rulesRequiringADetector().filter((id) => !hasDetector(id));
  const unexpected = missing.filter((id) => !KNOWN_GAPS.has(id));
  assert.deepEqual(unexpected, [], `rule(s) registered but with no detector anywhere: ${unexpected.join(', ')}`);
});

test('registry: SERVICE-001 specifically has a detector (#589)', () => {
  assert.equal(DEFAULT_RULES['SERVICE-001'].severity, 'error');
  assert.ok(hasDetector('SERVICE-001'), 'SERVICE-001 must appear in real detector source, not just the registry');
});

test('registry: KNOWN_GAPS names only rules that are still genuinely undetected -- a stale entry (one someone fixed but forgot to remove here) fails loudly instead of silently widening the exemption', () => {
  const stillMissing = rulesRequiringADetector().filter((id) => !hasDetector(id));
  for (const id of KNOWN_GAPS) {
    assert.ok(DEFAULT_RULES[id], `${id} is in KNOWN_GAPS but is no longer a registered rule -- remove it`);
    assert.ok(stillMissing.includes(id), `${id} is in KNOWN_GAPS but now has a detector -- remove it from KNOWN_GAPS`);
  }
});
