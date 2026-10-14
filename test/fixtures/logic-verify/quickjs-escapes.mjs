// Hand-written sandbox-escape attempts for the isolated runner (vm child and QuickJS backends). Each is one unit
// `save` (TypeScript source); `marker` is a host file path the unit tries to write, so a run that escapes leaves it
// behind. `expect` is what a blocked attempt looks like in isolatedRun's result:
//   thrown:<Name>   the run threw that error inside the sandbox (nothing reached the host)
//   notFaked        the access was refused by the fakes (listed under notFaked, never executed)
//   error           the run was stopped (time limit, memory limit) and reported as an error
// `after` (optional) is a second, clean unit run right after the first, in the same process: what it returns shows
// whether anything leaked from the first run into later ones.
export const ESCAPES = (marker) => [
  { id: 'process', what: 'process.mainModule.require', expect: 'notFaked',
    src: `export function save() { return (process as any).mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); }` },
  { id: 'require', what: "require('node:fs') inside the module", expect: 'notFaked',
    src: `declare const require: any;\nexport function save() { return require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); }` },
  { id: 'import', what: "import fs from 'node:fs' and dynamic import('node:child_process')", expect: 'notFaked',
    src: `import fs from 'node:fs';\nexport async function save() { const cp: any = await import('node:child_process'); cp.execSync('touch ${marker}'); fs.writeFileSync(${JSON.stringify(marker)}, 'x'); }` },
  { id: 'globalThis.constructor', what: "globalThis.constructor.constructor('return process')()", expect: 'thrown:EvalError',
    src: `export function save() { const F = (globalThis as any).constructor.constructor; return F('return process')().mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); }` },
  { id: 'Function', what: "new Function / eval / async-function constructor", expect: 'thrown:EvalError',
    src: `export function save() { try { new Function('return 1')(); } catch (e) { try { (0, eval)('1'); } catch { return (async function () {}).constructor('return process')(); } } return 'ran'; }` },
  { id: 'fake.constructor', what: "a fake's own constructor: localStorage.getItem.constructor('return process')()", expect: 'thrown:EvalError',
    src: `export function save() { return (localStorage.getItem as any).constructor('return process')().mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); }` },
  { id: 'fake-error.constructor', what: 'the error a refused access throws, then its constructor chain', expect: 'notFaked',
    src: `export function save() { try { (globalThis as any).WebSocket; } catch (e: any) { return e.constructor.constructor('return process')().mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); } return 'no error'; }` },
  { id: 'prepareStackTrace', what: 'Error.prepareStackTrace call-site objects (a V8 vm escape route)', expect: 'thrown:EvalError',
    src: `export function save() { (Error as any).prepareStackTrace = (_e: any, s: any[]) => s; const st: any = new Error().stack; const f = Array.isArray(st) ? st.map((c: any) => c.getFunction?.()).find(Boolean) : null; return (f ?? (() => {})).constructor('return process')().mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); }` },
  { id: 'loop', what: 'an infinite loop', expect: 'error',
    src: 'export function save() { let n = 0; for (;;) { n++; } }' },
  { id: 'memory', what: 'a memory blow-up (arrays until the limit)', expect: 'error',
    src: 'export function save() { const a: number[][] = []; for (;;) a.push(new Array(1 << 16).fill(a.length)); }' },
  { id: 'stack', what: 'unbounded recursion', expect: 'thrown:RangeError',
    src: 'export function save(): number { const f = (n: number): number => f(n + 1) + 1; return f(0); }' },
  { id: 'pollution', what: 'prototype pollution (Object.prototype, Array.prototype.map, JSON.parse), then a clean run', expect: 'thrown:none',
    src: "export function save() { (Object.prototype as any).polluted = 'yes'; (Array.prototype as any).map = () => ['hacked']; (JSON as any).parse = () => 'hacked'; return 1; }",
    after: "export function save() { return `${String(({} as any).polluted)} ${[1, 2].map((x) => x * 2).join()} ${JSON.parse('[3]')[0]}`; }",
    afterExpect: 'undefined 2,4 3' },
  { id: 'timers', what: 'the host clock and timers (Date, setTimeout, Math.random) are fixed fakes', expect: 'thrown:none',
    src: 'export function save() { let fired = 0; setTimeout(() => { fired++; }, 10 ** 9); return `${new Date().toISOString()} ${Date.now()} ${Math.random()} ${fired}`; }',
    valueExpect: '2026-01-15T10:00:00.000Z 1768471200000 0.6011037519201636 0' },
];
