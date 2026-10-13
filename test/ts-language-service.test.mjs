// #941: projectLanguageService exposes tsFileMove's contained, cached language-service host for read-only analyses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectLanguageService, clearMoveCache } from '../packages/engine/tsFileMove.mjs';

const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `construct-tsls-${process.pid}-`));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler' } }));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/a.ts'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'export const x = answer;\n');
  return dir;
};

test('projectLanguageService proposes a missing import from inside the project', () => {
  clearMoveCache();
  const dir = project();
  try {
    const r = projectLanguageService(dir);
    assert.equal(r.ok, true);
    const fix = r.service.getCombinedCodeFix({ type: 'file', fileName: path.join(dir, 'b.ts') }, 'fixMissingImport', {}, { importModuleSpecifierPreference: 'relative' });
    assert.match(fix.changes.flatMap((c) => c.textChanges.map((t) => t.newText)).join(''), /import \{ answer \} from ["']\.\/lib\/a["']/);
  } finally { clearMoveCache(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reads stay contained: a file outside the project is invisible unless named in readRoots', () => {
  clearMoveCache();
  const dir = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), `construct-tsls-out-${process.pid}-`));
  try {
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const s = 1;\n');
    const file = path.join(outside, 'secret.ts');
    const closed = projectLanguageService(dir).service.getProgram();
    assert.equal(closed.getSourceFile(file), undefined);
    assert.equal(projectLanguageService(dir).service.getEmitOutput, projectLanguageService(dir).service.getEmitOutput); // same cached service
    const open = projectLanguageService(dir, { readRoots: [outside] });
    assert.equal(open.ok, true);
    assert.notEqual(open.service, projectLanguageService(dir).service, 'a different readRoots set gets its own cached service');
  } finally { clearMoveCache(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a project without tsconfig.json is refused, not thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `construct-tsls-none-${process.pid}-`));
  try { assert.equal(projectLanguageService(dir).ok, false); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
