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
export const TYPED_CONTRACTS = join(HERE, '..', '..', 'packages', 'core', 'typed-contracts');
export const TYPED_CONTRACTS_NAME = '@line/construct-core/typed-contracts';
/** Smith's src/index.ts from $SMITH_SOURCE_DIR (the pinned clone, packages/line-links/smith.json), or null. */
export function smithCore() {
  const dir = process.env.SMITH_SOURCE_DIR?.replace(/^~/, process.env.HOME ?? '~');
  const f = dir ? join(dir, 'src', 'index.ts') : null;
  return f && existsSync(f) ? f : null;
}

export const loadTask = (id) => ({ ...JSON.parse(readFileSync(join(TASKS, id, 'task.json'), 'utf8')), dir: join(TASKS, id) });

// `overlays`: extra task folders copied after _r2 (r3's fixer arms add `_scope`: the picks feature's index.ts, the
// one import path Line's cross-feature rule allows into another feature).
export function makeWorkspace(ws, task, override, { overlays = [] } = {}) {
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  cpSync(join(TASKS, '_shared'), ws, { recursive: true });
  cpSync(join(TASKS, '_r2'), ws, { recursive: true });
  for (const o of overlays) cpSync(join(TASKS, o), ws, { recursive: true });
  if (existsSync(join(task.dir, 'start'))) cpSync(join(task.dir, 'start'), ws, { recursive: true });
  if (override != null) writeFileSync(join(ws, task.target), override);
  // #943: the typed-contracts factories (defineService, ...) the feature services are written with, copied from
  // packages/core at workspace build time (never a source copy in the repo) and imported by their package name.
  cpSync(TYPED_CONTRACTS, join(ws, 'typed-contracts'), { recursive: true, filter: (src) => !/\/examples(\/|$)|tsconfig\.json$/.test(src) });
  // #943 L-norm: Smith's runtime (ifIt, and, or, ...) from the pinned clone, so plug()'s atom calls can resolve
  const smith = smithCore();
  if (smith) { mkdirSync(join(ws, 'smith-core'), { recursive: true }); cpSync(smith, join(ws, 'smith-core', 'index.ts')); }
  writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
      allowImportingTsExtensions: true,
      jsx: 'react-jsx', types: [], paths: { 'next/link': ['./shims/next-link.tsx'], [TYPED_CONTRACTS_NAME]: ['./typed-contracts/index.ts'], ...(smith ? { '@smith/core': ['./smith-core/index.ts'] } : {}) },
    },
    include: ['**/*.ts', '**/*.tsx'], exclude: ['.out'],
  }, null, 2));
}

export function runTsc(ws) {
  const r = spawnSync(process.execPath, [TSC, '-p', join(ws, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8', timeout: 120_000 });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.replace(ws + '/', '').replace(relative(process.cwd(), ws) + '/', ''));
  return { ok: r.status === 0 && lines.length === 0, errors: lines };
}
