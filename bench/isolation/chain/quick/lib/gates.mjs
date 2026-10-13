// tsc gate and unit check for one task source (#942). In-process TypeScript, no files outside a construct-* temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');

/** Type-check one source (strict, noEmit). @returns {string[]} diagnostics, [] when clean. */
export function tscGate(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-chain-tsc-'));
  try {
    const file = path.join(dir, 'unit.ts');
    fs.writeFileSync(file, source);
    const program = ts.createProgram([file], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [], skipLibCheck: true });
    return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Run the task's check() on the transpiled source. @returns {Promise<boolean>} */
export async function unitCheck(source, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-chain-unit-'));
  try {
    const file = path.join(dir, 'unit.mjs');
    fs.writeFileSync(file, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    return !!check(await import(pathToFileURL(file).href));
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
