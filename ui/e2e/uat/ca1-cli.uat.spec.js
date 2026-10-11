import fs from 'node:fs';
import path from 'node:path';
import { test, expect, cli, REPO } from './support/uat.js';

// UAT ca1 (docs/line/review.md, CLI), typed in ~/Repositories/construct:
// 1. validate the passing example: no findings, exit 0.
// 2. validate the LINE-DIR example: two LINE-DIR errors, each a plain-English sentence: billing imports from orders
//    (promote that item to the library), and the library's Button imports from orders (move what it needs into the
//    library).
// 3. every other folder under fixtures/: each message says what is wrong and how to fix it without other docs.
const FIXTURES = 'packages/core/profiles/line/fixtures';
const validate = (dir, ...more) => cli(['validate', '--profile', 'line', '--dir', `${FIXTURES}/${dir}`, ...more]);

test('ca1 step 1: the passing example has no findings and exits 0', () => {
  const r = validate('passing');
  expect(r.code, r.out).toBe(0);
});

test('ca1 step 2: the LINE-DIR example gives two plain-English LINE-DIR errors', () => {
  const r = validate('LINE-DIR', '--format', 'json');
  expect(r.code).toBe(1);
  const findings = JSON.parse(r.out).findings ?? JSON.parse(r.out).violations;
  const dir = findings.filter((f) => (f.rule ?? f.ruleId) === 'LINE-DIR');
  expect(dir).toHaveLength(2);
  // One feature uses another feature (fix: promote the item to the library); the library uses a feature (fix: move
  // what it needs into the library).
  expect(dir.map((f) => f.message).sort()).toEqual([
    expect.stringMatching(/^Feature "billing" imports .* from feature "orders"; a feature may use only the library, so promote that item to library\/ and import it from there\.$/),
    expect.stringMatching(/^The library file "library\/components\/Button\.tsx" imports .* from feature "orders"; the library must not depend on any feature, so move what it needs into the library\.$/),
  ]);
  // The text a person reads in the terminal says the same.
  const text = validate('LINE-DIR');
  expect(text.out).toContain('promote that item to library/');
  expect(text.out).toContain('move what it needs into the library');
});

test('ca1 step 3: every failing example tells what is wrong and how to fix it, in full sentences', () => {
  const dirs = fs.readdirSync(path.join(REPO, FIXTURES)).filter((d) => d !== 'passing');
  expect(dirs.length).toBeGreaterThan(3);
  for (const d of dirs) {
    const r = validate(d, '--format', 'json');
    expect(r.code, `${d}: exit code`).toBe(1);
    const body = JSON.parse(r.out);
    const findings = body.findings ?? body.violations;
    expect(findings.length, `${d}: has findings`).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.message, `${d}: a full sentence`).toMatch(/^[A-Z"].*[.]$/);
      expect(f.message, `${d}: says how to fix it`).toMatch(/\b(add|move|promote|import|use|remove|keep|pick|create|rename|put|point|write|go through|call|delete|set|base)\b/i);
    }
  }
});
