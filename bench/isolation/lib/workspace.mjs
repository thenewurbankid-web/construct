// Task workspaces for the isolation harness (#941): _shared + the r2 snapshot + the task's start/ overlay, plus a
// harness tsconfig. Shared by run.mjs and the block tests.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TASKS = join(HERE, 'tasks');
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');

export const loadTask = (id) => ({ ...JSON.parse(readFileSync(join(TASKS, id, 'task.json'), 'utf8')), dir: join(TASKS, id) });

export function makeWorkspace(ws, task, override) {
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  cpSync(join(TASKS, '_shared'), ws, { recursive: true });
  cpSync(join(TASKS, '_r2'), ws, { recursive: true });
  if (existsSync(join(task.dir, 'start'))) cpSync(join(task.dir, 'start'), ws, { recursive: true });
  if (override != null) writeFileSync(join(ws, task.target), override);
  writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
      jsx: 'react-jsx', types: [], paths: { 'next/link': ['./shims/next-link.tsx'] },
    },
    include: ['**/*.ts', '**/*.tsx'], exclude: ['.out'],
  }, null, 2));
}

export function runTsc(ws) {
  const r = spawnSync(process.execPath, [TSC, '-p', join(ws, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8', timeout: 120_000 });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.replace(ws + '/', '').replace(relative(process.cwd(), ws) + '/', ''));
  return { ok: r.status === 0 && lines.length === 0, errors: lines };
}
