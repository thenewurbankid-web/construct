import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDiagnostics, typescriptDiagnostics } from '../src/engine/diagnostics.mjs';
import { createFeature } from '../src/generators.mjs';

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-engine-diagnostics-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  createFeature(dir, 'billing');
  return dir;
}

test('clean TS source has no TypeScript diagnostics', () => {
  const dir = tmpProject();
  const file = path.join(dir, 'a.ts');
  assert.deepEqual(typescriptDiagnostics(file, 'export const n: number = 1;\n'), []);
});

test('semantic type error is reported with 1-based line/column range', () => {
  const dir = tmpProject();
  const file = path.join(dir, 'a.ts');
  const d = typescriptDiagnostics(file, 'export const n: number = 1;\nexport const s: string = n;\n');
  assert.equal(d.length, 1);
  assert.equal(d[0].source, 'typescript');
  assert.equal(d[0].code, 'TS2322');
  assert.equal(d[0].severity, 'error');
  assert.equal(d[0].line, 2);
  assert.ok(d[0].column >= 1 && d[0].endColumn > d[0].column);
});

test('syntax error is reported (and short-circuits the semantic pass)', () => {
  const dir = tmpProject();
  const d = typescriptDiagnostics(path.join(dir, 'a.ts'), 'export const = ;\n');
  assert.ok(d.length >= 1);
  assert.ok(d.every((x) => x.source === 'typescript' && x.severity === 'error'));
});

test('diagnoses the supplied source, not what is on disk, and never writes', () => {
  const dir = tmpProject();
  const file = path.join(dir, 'a.ts');
  fs.writeFileSync(file, 'export const s: string = 1;\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.deepEqual(typescriptDiagnostics(file, 'export const s: string = "ok";\n'), []);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('collectDiagnostics merges TypeScript and architecture rule violations, sorted by position', () => {
  const dir = tmpProject();
  const rel = 'features/billing/pages/BillingPage.tsx';
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, rel),
    `export function BillingPage() {\n  const n = 0;\n  const s: string = n;\n  return <p>{s}</p>;\n}\n`,
  );
  const d = collectDiagnostics(dir, rel);
  const sources = new Set(d.map((x) => x.source));
  assert.ok(sources.has('typescript') || sources.has('architecture'), `got ${JSON.stringify(d)}`);
  for (let i = 1; i < d.length; i += 1) assert.ok(d[i - 1].line <= d[i].line);
  for (const x of d) {
    assert.ok(['error', 'warning', 'info'].includes(x.severity));
    assert.ok(x.line >= 1 && x.endLine >= x.line);
  }
  assert.ok(d.some((x) => x.code === 'TS2322'));
});

test('a rule violation is mapped to a whole-line marker', () => {
  const dir = tmpProject();
  const rel = 'features/billing/pages/BillingPage.tsx';
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  // pages must not import a service directly through a hook-free path — any PAGE-* rule works.
  fs.writeFileSync(path.join(dir, rel), `import { fetchThing } from '../services/BillingService';\nexport function BillingPage() {\n  return <p>{String(fetchThing)}</p>;\n}\n`);
  const arch = collectDiagnostics(dir, rel).filter((x) => x.source === 'architecture');
  assert.ok(arch.length >= 1, 'expected an architecture violation for a page importing a service');
  assert.equal(arch[0].column, 1);
  assert.equal(arch[0].endLine, arch[0].line);
  assert.match(arch[0].code, /^[A-Z]+-\d+/);
});
