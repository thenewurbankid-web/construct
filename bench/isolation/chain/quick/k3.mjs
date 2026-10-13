// K3 (#942): can qwen2.5-coder:1.5b pick the right Trace step when its only context is Line facts?
// Each case is the lending-r2 snapshot (project/) plus a few overlay files. The scope facts are built by Line's own
// blocks, not written by hand: moduleScope (packages/engine/line/scope/moduleScope.mjs:51) for what each feature
// declares and exports, and stubProblems (packages/engine/line/path/stubs.mjs:96) for whether a function is an open
// stub. The model answers {step, target, reason_id} through an Ollama `format` schema whose enums are closed per case.
// decide() is the same rule order as plain code, so the expected answers are checked, not just asserted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleScope } from '../../../../packages/engine/line/scope/moduleScope.mjs';
import { stubProblems, placeholderBody } from '../../../../packages/engine/line/path/stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT = path.join(HERE, 'project');

export const STEPS = Object.freeze(['complete_stub', 'reuse', 'add_to_scope', 'create', 'create_module']);
export const REASONS = Object.freeze(['STUB_OPEN', 'STABLE_ID_FINISHED', 'EXPORTED_BY_OTHER_FEATURE', 'HOME_MODULE_EXISTS', 'NO_MODULE']);

const stub = (name, sig) => `export function ${name}${sig} ${placeholderBody(`${name}`)}\n`;
const BOOK = `type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };\n`;

/** The 8 fixed decisions. `need` is the stable id `<feature>/<kind>/<name>` the role must produce; `from` the asking feature. */
export const CASES = Object.freeze([
  { id: 'k3-1', from: 'book', need: 'book/domains/formatAvailability', expect: { step: 'complete_stub', target: 'book/domains/formatAvailability', reason_id: 'STUB_OPEN' },
    files: { 'features/book/domains/formatAvailability.ts': stub('formatAvailability', '(available: boolean): string') } },
  { id: 'k3-2', from: 'picks', need: 'picks/services/removePick', expect: { step: 'complete_stub', target: 'picks/services/removePick', reason_id: 'STUB_OPEN' },
    files: { 'features/picks/services/removePick.ts': 'export function removePick(ids: string[], id: string): string[] {\n  return ids;\n}\n' } },
  { id: 'k3-3', from: 'browse', need: 'browse/domains/sortByTitle', expect: { step: 'reuse', target: 'browse/domains/sortByTitle', reason_id: 'STABLE_ID_FINISHED' },
    files: { 'features/browse/domains/sortByTitle.ts': `${BOOK}export function sortByTitle(books: Book[]): Book[] {\n  return [...books].sort((a, b) => a.title.localeCompare(b.title));\n}\n` } },
  { id: 'k3-4', from: 'book', need: 'book/domains/formatPages', expect: { step: 'reuse', target: 'book/domains/formatPages', reason_id: 'STABLE_ID_FINISHED' },
    files: {
      'features/book/domains/formatPages.ts': 'export function formatPages(pages: number): string {\n  return `${pages} pages`;\n}\n',
      'features/book/domains/formatAuthor.ts': stub('formatAuthor', '(author: string): string'),
    } },
  { id: 'k3-5', from: 'book', need: 'picks/services/addPick', expect: { step: 'add_to_scope', target: 'picks/services/addPick', reason_id: 'EXPORTED_BY_OTHER_FEATURE' },
    files: {
      'features/picks/services/addPick.ts': 'export function addPick(ids: string[], id: string): string[] {\n  return ids.includes(id) ? ids : [...ids, id];\n}\n',
      'features/picks/index.ts': "export { addPick } from './services/addPick';\n",
    } },
  { id: 'k3-6', from: 'request', need: 'picks/services/listPicks', expect: { step: 'add_to_scope', target: 'picks/services/listPicks', reason_id: 'EXPORTED_BY_OTHER_FEATURE' },
    files: {
      'features/picks/services/listPicks.ts': 'export function listPicks(ids: string[]): string[] {\n  return [...ids];\n}\n',
      'features/picks/index.ts': "export { listPicks } from './services/listPicks';\n",
      'features/request/services/sendRequest.ts': stub('sendRequest', '(ids: string[]): string'),
    } },
  { id: 'k3-7', from: 'browse', need: 'browse/domains/pageOf', expect: { step: 'create', target: 'browse/domains/pageOf', reason_id: 'HOME_MODULE_EXISTS' },
    files: { 'features/browse/domains/sortByTitle.ts': `${BOOK}export function sortByTitle(books: Book[]): Book[] {\n  return [...books].sort((a, b) => a.title.localeCompare(b.title));\n}\n` } },
  { id: 'k3-8', from: 'request', need: 'request/services/requestLoan', expect: { step: 'create_module', target: 'module:request/services', reason_id: 'NO_MODULE' },
    files: { 'features/request/domains/formatBranch.ts': 'export function formatBranch(branch: string): string {\n  return `Pickup at ${branch}`;\n}\n' } },
]);

/** Copy the snapshot plus the case's overlay into a fresh temp folder; returns its root. */
export function materialize(c) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-chain-k3-'));
  fs.cpSync(PROJECT, root, { recursive: true });
  for (const [rel, body] of Object.entries(c.files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const featuresOf = (root) => fs.readdirSync(path.join(root, 'features'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const LOGIC = ['domains', 'services', 'usecases', 'expressions'];

/**
 * The scope facts for one case, in Line's vocabulary only. Built from moduleScope + stubProblems on disk.
 * @returns {{facts: string[], candidates: string[], state: object}}
 */
export function buildFacts(root, c) {
  const [needFeature, needKind, needName] = c.need.split('/');
  const facts = [`need ${c.need}`, `asking_feature ${c.from}`];
  const fns = [];
  const exportsBy = {};
  const modules = new Set();
  for (const f of featuresOf(root)) {
    const s = moduleScope(root, f);
    exportsBy[f] = s.exports.map((e) => e.name);
    for (const [kind, items] of Object.entries(s.declares)) {
      if (!LOGIC.includes(kind)) continue;
      modules.add(`module:${f}/${kind}`);
      for (const it of items) {
        const src = fs.readFileSync(path.join(root, it.file), 'utf8');
        const problems = stubProblems(src, it.name).map((p) => p.code);
        fns.push({ id: `${f}/${kind}/${it.name}`, feature: f, name: it.name, problems });
      }
    }
  }
  for (const f of featuresOf(root)) facts.push(`feature ${f} index_exports [${exportsBy[f].join(', ')}]`);
  for (const m of [...modules].sort()) facts.push(`${m} exists`);
  for (const fn of fns) facts.push(`function ${fn.id} stub_check ${fn.problems.length ? fn.problems.join(',') : 'PASS'}`);
  const imports = moduleScope(root, c.from).imports.features.map((i) => i.feature);
  facts.push(`feature ${c.from} imports_features [${imports.join(', ')}]`);
  const candidates = [...new Set([c.need, ...fns.map((f) => f.id), `module:${needFeature}/${needKind}`, ...modules])].sort();
  return { facts, candidates, state: { fns, exportsBy, modules: [...modules], needFeature, needKind, needName } };
}

/** Line's order as code: complete the stub, else reuse by stable id, else add the other feature's export to scope, else create in the existing module, else create the module. */
export function decide(c, { state }) {
  const fn = state.fns.find((f) => f.id === c.need);
  if (fn && fn.problems.length) return { step: 'complete_stub', target: c.need, reason_id: 'STUB_OPEN' };
  if (fn && state.needFeature === c.from) return { step: 'reuse', target: c.need, reason_id: 'STABLE_ID_FINISHED' };
  if (fn && state.exportsBy[state.needFeature].includes(state.needName)) return { step: 'add_to_scope', target: c.need, reason_id: 'EXPORTED_BY_OTHER_FEATURE' };
  const mod = `module:${state.needFeature}/${state.needKind}`;
  if (state.modules.includes(mod)) return { step: 'create', target: c.need, reason_id: 'HOME_MODULE_EXISTS' };
  return { step: 'create_module', target: mod, reason_id: 'NO_MODULE' };
}

export const SYSTEM = [
  'You choose one Trace step. Line rules, in order:',
  '1. If function <need> exists and its stub_check is not PASS: step complete_stub, target <need>, reason_id STUB_OPEN.',
  '2. Else if function <need> exists with stub_check PASS and its feature is asking_feature: step reuse, target <need>, reason_id STABLE_ID_FINISHED.',
  '3. Else if function <need> exists with stub_check PASS in another feature whose index_exports lists its name: step add_to_scope, target <need>, reason_id EXPORTED_BY_OTHER_FEATURE.',
  '4. Else if module:<feature>/<kind> of <need> exists: step create, target <need>, reason_id HOME_MODULE_EXISTS.',
  '5. Else: step create_module, target module:<feature>/<kind> of <need>, reason_id NO_MODULE.',
  'A stable id is <feature>/<kind>/<name>. Answer with JSON only.',
].join('\n');

const EXAMPLE = 'Example. Facts: need loans/domains/formatDue; asking_feature loans; module:loans/domains exists; function loans/domains/formatDue stub_check OPEN. Answer: {"step":"complete_stub","target":"loans/domains/formatDue","reason_id":"STUB_OPEN"}';

export const userPrompt = (facts) => `${EXAMPLE}\n\nFacts:\n${facts.join('\n')}\n\nAnswer:`;

export const schemaFor = (candidates) => ({
  type: 'object',
  properties: { step: { type: 'string', enum: [...STEPS] }, target: { type: 'string', enum: candidates }, reason_id: { type: 'string', enum: [...REASONS] } },
  required: ['step', 'target', 'reason_id'],
});
