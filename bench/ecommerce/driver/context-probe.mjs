#!/usr/bin/env node
// #925 experiment: replay single stuck turns of a real bench run against local Ollama with different context shapes,
// and score each answer deterministically (no model judge). Read-only on the source run; writes only its results.
//
//   packages/tools/dev/heavy.sh node bench/ecommerce/driver/context-probe.mjs [--run <runDir>] [--models a,b]
//       [--seeds 1,2,3,4,5] [--only V0,V4,C1] [--dry] [--out <json>] [--md <md>]
//
// Case 1 (turn-input/12.json): the builder resends the same PicksPage.tsx setCode that fails tsc TS2345.
//   Score: the parsed call is plan_add line.setCode on PicksPage.tsx; identical to the failing code (repeat); the emitted
//   file type-checks (copied project in /tmp/construct-probe-<pid>, node_modules symlinked, tsc errors of that file only).
// Case 2 (turn-input/1.json, the turn whose answer followed the wrong DetailPage suggestion): picks pages/ListPage.
// V9a/V9b, C9a/C9b: answers as an ordered list of registered atom sentences (packages/line-atoms), prompt-only vs an
//   Ollama `format` JSON Schema enum; scored by exact match against a reference written from the spec point text.
// English ("Smith translation") of code: TypeScript's transpileModule (types and JSX out) -> each function ->
//   packages/summarize/links.mjs summarizeCode (atomic-codemod's to-english, linked through packages/line-links).
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { smithLinks, summarizeCode } from '../../../packages/summarize/links.mjs';
import { listAtoms, toSmithEntry } from '../../../packages/line-atoms/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

// ---------- flags ----------
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RUN = path.resolve(opt('--run', path.join(os.homedir(), 'Repositories/construct/.claude/worktrees/og-final-1012/bench/lending/runs/lending-qwen-7b-r1')));
const MODELS = opt('--models', 'qwen2.5-coder:7b,qwen2.5-coder:1.5b').split(',');
const SEEDS = opt('--seeds', '1,2,3,4,5').split(',').map(Number);
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const DRY = argv.includes('--dry');
const OUT = path.resolve(REPO, opt('--out', 'bench/lending/results/context-probe-r1.json'));
const MD = path.resolve(REPO, opt('--md', 'bench/lending/CONTEXT-PROBE.md'));
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const LOG = path.join(RUN, 'logs');
const PROJ = path.join(RUN, 'project');
const PICKS = 'features/picks/pages/PicksPage.tsx';
const EXAMPLE_FIX = "Example fix for line 7: const pickedBooks = JSON.parse(localStorage.getItem('picks') ?? '[]');";
const NUM_PREDICT = 1500; // runaway guard only; a setCode answer is ~300 tokens

const ts = createRequire(path.join(PROJ, 'package.json'))('typescript');
const read = (f) => fs.readFileSync(f, 'utf8');
const readJson = (f) => JSON.parse(read(f));
const SYSTEM = read(path.join(LOG, 'system-prompt.txt'));

/** A turn-input as an Ollama request: the system message's content restored from system-prompt.txt. */
function turnInput(n) {
  const j = readJson(path.join(LOG, 'turn-input', `${n}.json`));
  j.messages = j.messages.map((m) => (m.role === 'system' && m.file ? { role: 'system', content: SYSTEM } : m));
  return j;
}

// ---------- English (Smith translation) of code ----------
const englishCache = new Map();
/** Code (TS/TSX) in English: each top-level function through atomic-codemod's to-english and summarize. */
async function englishOf(code) {
  if (englishCache.has(code)) return englishCache.get(code);
  const js = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const sf = ts.createSourceFile('x.js', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const out = [];
  for (const st of sf.statements) {
    if (!ts.isFunctionDeclaration(st)) continue;
    const s = await summarizeCode(st.getText(sf).replace(/^export\s+(default\s+)?/, ''));
    out.push(s.sentences.join(' '));
  }
  const text = out.length ? out.join(' ') : '(no function to put into words)';
  englishCache.set(code, text);
  return text;
}

/** Replace every JSON `"code": "<string>"` field in a text by the code's English. */
async function englishifyCodeFields(text) {
  const re = /"code":\s*"((?:[^"\\]|\\.)*)"/g;
  const parts = []; let last = 0; let m;
  while ((m = re.exec(text))) {
    let code; try { code = JSON.parse(`"${m[1]}"`); } catch { continue; }
    parts.push(text.slice(last, m.index), `"code":${JSON.stringify(`(code, in English) ${await englishOf(code)}`)}`);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.join('');
}

// ---------- tool calls written as text ----------
/** Same as qwen-agent.mjs textToolCalls (copied: importing the driver pulls plan-cli and the engine, not needed here). */
function textToolCalls(content) {
  const out = [];
  const s = String(content ?? '');
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{') continue;
    let depth = 0; let str = false; let esc = false; let end = -1;
    for (let j = i; j < s.length; j += 1) {
      const c = s[j];
      if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '{') depth += 1; else if (c === '}') { depth -= 1; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    const j = parse(s.slice(i, end + 1));
    if (j && typeof j === 'object' && typeof j.name === 'string') out.push({ function: { name: j.name, arguments: j.arguments ?? j.parameters ?? {} } });
    i = end;
  }
  return out;
}

// ---------- project facts ----------
/** The exported props type and the exported function's signature line of a library page. */
function signatureOf(file) {
  const src = read(path.join(PROJ, file));
  const type = /export type \w+Props = \{[\s\S]*?\n\};/.exec(src)?.[0] ?? '';
  const fnLine = /export function [^\n]*\{/.exec(src)?.[0].replace(/\s*\{$/, '') ?? '';
  return `${type}\n${fnLine}`.trim();
}
const pointsOf = (feature) => read(path.join(PROJ, 'features', feature, 'spec.md')).split('\n').filter((l) => /^- [A-Z]+-\d+:/.test(l));
const pointText = (feature, id) => pointsOf(feature).find((l) => l.startsWith(`- ${id}:`))?.slice(2) ?? id;

// ---------- case 1 history ----------
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const callOf = (m) => (Array.isArray(m.tool_calls) && m.tool_calls.length ? m.tool_calls : textToolCalls(m.content))[0] ?? null;
const argsOf = (c) => (typeof c?.function?.arguments === 'string' ? parse(c.function.arguments) : c?.function?.arguments) ?? {};
const keyOf = (c) => { const { why: _w, ...a } = argsOf(c); return `${c?.function?.name}:${JSON.stringify(a)}`; };
const firstLine = (s) => String(s ?? '').split('\n')[0];

/**
 * V1 compaction: identical calls (args without `why`) collapsed to their last attempt + its answer + "(repeated N
 * times)"; tool outputs older than the last 2 turns cut to their sentence's first line; plan_status done steps -> a count.
 */
function compact(messages) {
  const [sys, seed, ...rest] = messages;
  const pairs = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push({ a: rest[i], t: rest[i + 1], key: keyOf(callOf(rest[i])), at: i });
  const count = new Map(); const lastAt = new Map();
  for (const p of pairs) { count.set(p.key, (count.get(p.key) ?? 0) + 1); lastAt.set(p.key, p.at); }
  const kept = pairs.filter((p) => lastAt.get(p.key) === p.at);
  const out = [sys, seed];
  kept.forEach((p, i) => {
    const n = count.get(p.key);
    const obj = parse(p.t.content) ?? { sentence: p.t.content };
    if (n > 1) obj.sentence = `(repeated ${n} times) ${obj.sentence}`;
    let tool;
    if (i < kept.length - 2) tool = { ok: obj.ok, ...(obj.code ? { code: obj.code } : {}), sentence: firstLine(obj.sentence) };
    else {
      tool = { ...obj };
      if (Array.isArray(tool.steps)) { const done = tool.steps.filter((s) => s.state === 'done').length; tool.steps = tool.steps.filter((s) => s.state !== 'done'); tool.doneSteps = done; }
    }
    out.push({ role: 'assistant', content: p.a.content }, { role: 'tool', content: JSON.stringify(tool) });
  });
  return { messages: out, repeats: Object.fromEntries([...count].filter(([, n]) => n > 1)) };
}

// ---------- atoms (V9) ----------
const ATOMS = listAtoms().map((a) => ({ ...toSmithEntry(a), smithId: toSmithEntry(a).id, id: a.id }));
const ATOM_SENTENCES = ATOMS.map((a) => a.english);
const PAGINATE = ATOMS.find((a) => a.id === 'client-pagination').english;
/** References written from the spec point text alone (not from acceptance files). */
const REFERENCE = {
  // PCK-1: read the picks kept in the browser, count them, show a link "My picks (n)" to /picks: no registered atom does any of it.
  case1: { atoms: [], needsMissing: true, gaps: ['Read a list kept in the browser (localStorage), empty when nothing is kept.', 'Count the items of a list.', 'Show a link whose label is a text followed by a count in brackets.'] },
  // BRW-1/BRW-2: six books at a time with "Page 1 of 3" and Previous/Next disabled at the ends = paginate; rendering each row is not an atom.
  case2: { atoms: [PAGINATE], needsMissing: true, gaps: ['Show each item of a list with its fields and a link to its own page.', 'Say "Available" or "On loan" from a yes/no field.'] },
};
const atomAsk = (pointLines) => [
  'Do not write code now. Say which logic atoms this needs, as an ordered list of sentences chosen ONLY from the list below: copy each sentence exactly, one per line, in the order the page uses them.',
  'If no sentence in the list fits a part of what is needed, write a line "MISSING: <one sentence saying what is needed>".',
  `What is needed:\n${pointLines.join('\n')}`,
  `The atoms (the only sentences you may choose):\n${ATOM_SENTENCES.map((s) => `- ${s}`).join('\n')}`,
].join('\n\n');
const ATOM_FORMAT = {
  type: 'object',
  properties: {
    steps: {
      type: 'array', minItems: 1, maxItems: 8,
      items: { oneOf: [
        { type: 'object', properties: { atom: { type: 'string', enum: ATOM_SENTENCES } }, required: ['atom'], additionalProperties: false },
        { type: 'object', properties: { missing: { type: 'string' } }, required: ['missing'], additionalProperties: false },
      ] },
    },
  },
  required: ['steps'],
};

// ---------- variants ----------
const T12 = turnInput(12);
const T1 = turnInput(1);
const BASE_OPTIONS = T12.options;
const C1x = compact(T12.messages);
const failing = (() => { // the last setCode on PicksPage in the history
  const calls = T12.messages.filter((m) => m.role === 'assistant').map(callOf).filter((c) => argsOf(c).args?.file === PICKS);
  return argsOf(calls[calls.length - 1]).args;
})();
const refusalIdx = C1x.messages.findIndex((m) => m.role === 'tool' && /TYPE_ERROR/.test(m.content) && /repeated/.test(m.content));
const refusalObj = parse(C1x.messages[refusalIdx].content);
const errLine = firstLine(refusalObj.detail); // features/picks/pages/PicksPage.tsx:7 TS2345 Argument of type ...
const caretLine = /^>\d+\|.*$/m.exec(refusalObj.sentence)?.[0] ?? '';
const repeatN = Math.max(...Object.values(C1x.repeats).filter((n) => n >= 3), 1);
const currentPicks = read(path.join(PROJ, PICKS));
const landed = 'features/book/pages/BookPage.tsx';
const landedCode = read(path.join(PROJ, landed));
const PCK1 = pointText('picks', 'PCK-1');

/** The context pack: current file + hash, ListPage props/signature, the picks points, a landed page; English optional. */
async function pack({ english = false, englishOnly = false } = {}) {
  const lines = ['Context for this fix:'];
  lines.push(`- The file you are editing, ${PICKS} (contentHash ${failing.contentHash}), now:\n\`\`\`tsx\n${currentPicks.trimEnd()}\n\`\`\``);
  if (english) lines.push(`  In English: ${await englishOf(currentPicks)}`);
  if (english || englishOnly) lines.push(`- What your last attempt does, in English: ${await englishOf(failing.code)}`);
  if (englishOnly) lines.push(`- library/pages/ListPage.tsx, in English: ${await englishOf(read(path.join(PROJ, 'library/pages/ListPage.tsx')))}`);
  else {
    lines.push(`- It renders library/pages/ListPage.tsx:\n\`\`\`tsx\n${signatureOf('library/pages/ListPage.tsx')}\n\`\`\``);
    if (english) lines.push(`  In English: ${await englishOf(read(path.join(PROJ, 'library/pages/ListPage.tsx')))}`);
  }
  lines.push(`- Points of picks:\n${pointsOf('picks').join('\n')}`);
  if (englishOnly) lines.push(`- A page that landed (${landed}), in English: ${await englishOf(landedCode)}`);
  else {
    lines.push(`- A page that landed (${landed}):\n\`\`\`tsx\n${landedCode.trimEnd()}\n\`\`\``);
    if (english) lines.push(`  In English: ${await englishOf(landedCode)}`);
  }
  return lines.join('\n');
}

const shortRefusal = () => [
  `Refused (TYPE_ERROR, repeated ${repeatN} times): ${errLine}`,
  caretLine,
  EXAMPLE_FIX,
  `Rule: send line.setCode with the whole file, line 7 changed, and contentHash ${failing.contentHash}; the same code again is refused.`,
].join('\n');
const englishRefusal = () => [
  `Refused (TYPE_ERROR, repeated ${repeatN} times): line 7 of ${PICKS} does not type-check: it passes a value that can be null (string | null) where only a string is allowed.`,
  caretLine,
  EXAMPLE_FIX,
  `Rule: send line.setCode with the whole file, line 7 changed, and contentHash ${failing.contentHash}; the same code again is refused.`,
].join('\n');

const clone = (x) => JSON.parse(JSON.stringify(x));
const withRefusal = (msgs, sentence, keepFields = true) => {
  const m = clone(msgs);
  const obj = keepFields ? { ...refusalObj, sentence } : { ok: false, code: 'TYPE_ERROR', sentence };
  m[refusalIdx] = { role: 'tool', content: JSON.stringify(obj) };
  return m;
};

const VARIANTS = {
  V0: { case: 1, what: 'control: turn-input/12 as sent', numCtx: 16384, build: async () => T12.messages },
  V1: { case: 1, what: 'compacted: repeats collapsed + (repeated N times), old tool outputs -> first line, done steps -> count', build: async () => C1x.messages },
  V2: { case: 1, what: 'V1 + context pack on the latest refusal (current file+hash, ListPage props, picks points, landed BookPage)', build: async () => withRefusal(C1x.messages, `${refusalObj.sentence}\n${await pack()}`) },
  V3: { case: 1, what: 'V2 + example fix line in the refusal', build: async () => withRefusal(C1x.messages, `${refusalObj.sentence}\n${EXAMPLE_FIX}\n${await pack()}`) },
  V4: { case: 1, what: 'V3 with the refusal shortened to error + example fix + one-line rule', build: async () => withRefusal(C1x.messages, `${shortRefusal()}\n${await pack()}`, false) },
  V5: { case: 1, what: 'best of V2-V4 + English (Smith translation) beside each code block of the pack', dependsOnBest: true },
  V7: { case: 1, what: 'best of V2-V4, then compare loop: its code in English beside the PCK-1 text, ask once more (2 calls)', dependsOnBest: true, compare: true },
  V8: { case: 1, what: 'V1 with every code block replaced by English; raw code only the edited file + error line; English refusal + example fix', build: async () => {
    const m = clone(C1x.messages);
    for (let i = 2; i < m.length; i += 1) {
      if (i === refusalIdx) continue;
      if (m[i].role === 'assistant') m[i].content = await englishifyCodeFields(m[i].content);
      else { const o = parse(m[i].content); if (o?.sentence) { o.sentence = await englishifyCodeFields(o.sentence); m[i].content = JSON.stringify(o); } }
    }
    m[refusalIdx] = { role: 'tool', content: JSON.stringify({ ok: false, code: 'TYPE_ERROR', sentence: `${englishRefusal()}\n${await pack({ englishOnly: true })}` }) };
    return m;
  } },
  'V8+V7': { case: 1, what: 'V8, then the compare loop (2 calls)', base: 'V8', compare: true },
  V9a: { case: 1, what: 'V8 context + ask for PCK-1 as an ordered list of registered atom sentences (prompt only, no tools)', atoms: true, build: async () => [...(await VARIANTS.V8.build()), { role: 'user', content: atomAsk([PCK1]) }] },
  V9b: { case: 1, what: 'V9a with Ollama `format` = JSON Schema enum of the atom sentences (enforced)', atoms: true, enforced: true, build: async () => VARIANTS.V9a.build() },
  V10: { case: 1, what: 'V4 with the trailing repeated plan_status pair dropped (the refusal is the last message)', build: async () => { const m = await VARIANTS.V4.build(); return m.slice(0, refusalIdx + 1); } },
};

// ---------- case 2 ----------
const seedUser = T1.messages[1].content;
const noWrongSuggestion = seedUser.replace(/ Step: line\.baseOn \{[^\n]*"pages\/DetailPage"[^\n]*\}/g, '');
const LIB_PAGES = ['ListPage', 'DetailPage', 'FormPage'];
const BRW12 = [pointText('browse', 'BRW-1'), pointText('browse', 'BRW-2')];
async function libBlock({ code = true, english = false }) {
  const parts = ['Library pages you can base the browse page on:'];
  for (const p of LIB_PAGES) {
    parts.push(`- pages/${p} (library/pages/${p}.tsx)${code ? '' : ', in English'}:`);
    if (code) parts.push(`\`\`\`tsx\n${signatureOf(`library/pages/${p}.tsx`)}\n\`\`\``);
    if (english || !code) parts.push(`${code ? '  In English: ' : '  '}${await englishOf(read(path.join(PROJ, `library/pages/${p}.tsx`)))}`);
  }
  parts.push(`The browse page must show:\n${BRW12.map((s) => `- ${s}`).join('\n')}`);
  return parts.join('\n');
}
const WORKED = [
  'A worked example of a page based on ListPage (another app):',
  'step: line.baseOn {"libraryId":"pages/ListPage","feature":"shop","name":"ProductsPage"}',
  'then features/shop/pages/ProductsPage.tsx:',
  '```tsx',
  '// @line-base pages/ListPage',
  "import { ListPage } from '../../../library/pages/ListPage';",
  "import products from '../../../library/fixtures/products.json';",
  '',
  'export function ProductsPage() {',
  '  return (',
  '    <ListPage title="Products">',
  '      {products.map((p) => <article key={p.id}><a href={`/products/${p.id}`}>{p.name}</a></article>)}',
  '    </ListPage>',
  '  );',
  '}',
  '```',
].join('\n');
const c2 = (user) => [T1.messages[0], { role: 'user', content: user }];
Object.assign(VARIANTS, {
  C0: { case: 2, what: 'control: turn-input/1 as sent (the DetailPage suggestion in place)', numCtx: 16384, build: async () => T1.messages },
  C1: { case: 2, what: 'wrong DetailPage suggestion removed + ListPage/DetailPage/FormPage props + BRW-1/BRW-2', numCtx: 16384, build: async () => c2(`${noWrongSuggestion}\n\n${await libBlock({})}`) },
  C2: { case: 2, what: 'C1 + one worked example of a ListPage-based page', numCtx: 16384, build: async () => c2(`${noWrongSuggestion}\n\n${await libBlock({})}\n\n${WORKED}`) },
  C3: { case: 2, what: 'C2 + English (Smith translation) of each library page', numCtx: 16384, build: async () => c2(`${noWrongSuggestion}\n\n${await libBlock({ english: true })}\n\n${WORKED}`) },
  C4: { case: 2, what: 'C1 with the library pages only as English (no code)', numCtx: 16384, build: async () => c2(`${noWrongSuggestion}\n\n${await libBlock({ code: false })}`) },
  C9a: { case: 2, what: 'C4 context + ask for BRW-1/BRW-2 as an ordered list of registered atom sentences (prompt only, no tools)', numCtx: 16384, atoms: true, build: async () => [...(await VARIANTS.C4.build()), { role: 'user', content: atomAsk(BRW12) }] },
  C9b: { case: 2, what: 'C9a with Ollama `format` = JSON Schema enum of the atom sentences (enforced)', numCtx: 16384, atoms: true, enforced: true, build: async () => VARIANTS.C9a.build() },
});
// ---------- L: a fresh small context per turn (short rules + ledger of distilled facts + step + last result + pack) ----------
const L_SYSTEM = [
  'You build a small lending-library web app in a Line project (Next.js app router, React 18, TypeScript strict, Tailwind). You change the project only with your tools: answer with exactly one tool call.',
  'Rules:',
  '- Send every change as plan_add {tool, args, why}: line.setCode {file, code, contentHash} writes the whole file (pass the contentHash to replace a file); line.baseOn {libraryId, feature, name} creates a feature item based on a library item.',
  '- Every feature page starts with `// @line-base pages/<ListPage|DetailPage|FormPage>`, then its `// @line-route` line.',
  '- A feature imports only from the library (`../../../library/...`) and its own folder, and only files that exist; never from another feature.',
  '- Code must type-check under strict TypeScript: handle values that can be null and type every parameter.',
  "- A component that uses state or the browser (useState, localStorage) needs 'use client'; right after the `// @line-` lines.",
].join('\n');
const LEDGER1 = [
  'Facts so far (each with where it comes from):',
  '- Features book, picks, request and loans exist, each with its spec.md. [plan steps 2, 5, 8, 11]',
  '- browse has no page yet; a step basing a DetailPage on it is approved and waits to run. [step 12]',
  '- features/book/pages/BookPage.tsx is based on DetailPage, served at /books/:id, and shows one book of library/fixtures/books.json by id. [steps 3, 4, 13]',
  '- features/picks/pages/PicksPage.tsx is based on ListPage, served at /picks, and renders ListPage titled "Picks" with nothing else. [steps 6, 7; read]',
  '- features/request/pages/RequestPage.tsx is based on ListPage, served at /request, and is empty. [steps 9, 10]',
  '- No feature has usecases, services or domains yet. [ls features/*]',
  '- The library has components Button, TextField, Card, Dialog, Select, Checkbox, Toast; pages ListPage, DetailPage, FormPage; library/fixtures/books.json with 15 books {id, title, author, genre, year, pages, summary, available}. [system prompt; ls library]',
  '- ListPage takes {title, toolbar?, children?, empty?}: it shows title as the heading, the toolbar above, the children as a grid, or `empty` when there are no children. [library/pages/ListPage.tsx]',
  `- Your last ${repeatN} attempts at PicksPage.tsx were refused with the same type error (below). [steps refused]`,
].join('\n');
const STEP1 = `Current step: ${PCK1} Write it in ${PICKS} with plan_add line.setCode (the whole file, contentHash ${failing.contentHash}).`;
async function packEnglish1() {
  return ['Context (English):',
    `- ${PICKS} now (contentHash ${failing.contentHash}):\n\`\`\`tsx\n${currentPicks.trimEnd()}\n\`\`\``,
    `- What your last attempt does: ${await englishOf(failing.code)}`,
    `- library/pages/ListPage.tsx: ${await englishOf(read(path.join(PROJ, 'library/pages/ListPage.tsx')))}`,
    `- A page that landed, ${landed}: ${await englishOf(landedCode)}`].join('\n');
}
const LEDGER2 = [
  'Facts so far (each with where it comes from):',
  '- Line seeded features book, picks, request and loans with their specs; BookPage (on DetailPage) at /books/:id, PicksPage (on ListPage) at /picks and RequestPage (on ListPage) at /request exist with no content yet. [seed steps 1-11]',
  '- browse has its spec (features/browse/spec.md) but no page and no route yet. [seed]',
  '- Library pages: ListPage {title, toolbar?, children?, empty?} shows a heading, a toolbar and the children as a grid; DetailPage {title, back?, children?, aside?} shows one item with a back link and side actions; FormPage {title, onSubmit, submitLabel, children?, aside?} shows a form with a submit button. [library/pages]',
  '- library/fixtures/books.json has 15 books {id, title, author, genre, year, pages, summary, available}. [system prompt]',
].join('\n');
const STEP2 = `Current step: browse has no page yet (its spec puts one at /). Create it with plan_add line.baseOn {"libraryId": "pages/<ListPage|DetailPage|FormPage>", "feature": "browse", "name": "<Name>"} on the library page that fits these points, then add its route:\n${BRW12.map((x) => `- ${x}`).join('\n')}`;
async function packEnglish2() {
  const out = ['Context (English):'];
  for (const p of LIB_PAGES) out.push(`- library/pages/${p}.tsx: ${await englishOf(read(path.join(PROJ, `library/pages/${p}.tsx`)))}`);
  return out.join('\n');
}
const pick = (names) => T12.tools.filter((t) => names.includes(t.function.name));
const L_TOOLS = pick(['plan_add']);
const L_FETCH_TOOLS = pick(['plan_add', 'plan_status', 'read_file', 'list_dir']);
const lMsgs = (user) => [{ role: 'system', content: L_SYSTEM }, { role: 'user', content: user }];
const L1 = async ({ withPack = true } = {}) => lMsgs([LEDGER1, STEP1, `Last result: ${englishRefusal()}`, ...(withPack ? [await packEnglish1()] : ['Read a file with read_file when you need its code.'])].join('\n\n'));
const L2 = async ({ withPack = true } = {}) => lMsgs([LEDGER2, STEP2, ...(withPack ? [await packEnglish2()] : ['Read a file with read_file when you need its code.'])].join('\n\n'));
Object.assign(VARIANTS, {
  L: { case: 1, what: 'fresh small context: short rules + ledger facts + current step + last refusal (English + example fix) + English pack; plan_add only', numCtx: 16384, tools: L_TOOLS, build: async () => L1() },
  'L+tools': { case: 1, what: 'L without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls)', numCtx: 16384, tools: L_FETCH_TOOLS, fetchLoop: true, build: async () => L1({ withPack: false }) },
  L9a: { case: 1, what: 'L context + ask for PCK-1 as registered atom sentences (prompt only, no tools)', numCtx: 16384, atoms: true, build: async () => [...(await L1()), { role: 'user', content: atomAsk([PCK1]) }] },
  L9b: { case: 1, what: 'L9a with the `format` JSON Schema enum (enforced)', numCtx: 16384, atoms: true, enforced: true, build: async () => VARIANTS.L9a.build() },
  CL: { case: 2, what: 'fresh small context: short rules + ledger facts (library pages in one sentence each) + current step with BRW-1/BRW-2 + English pack; plan_add only', numCtx: 16384, tools: L_TOOLS, build: async () => L2() },
  'CL+tools': { case: 2, what: 'CL without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls)', numCtx: 16384, tools: L_FETCH_TOOLS, fetchLoop: true, build: async () => L2({ withPack: false }) },
  CL9a: { case: 2, what: 'CL context + ask for BRW-1/BRW-2 as registered atom sentences (prompt only, no tools)', numCtx: 16384, atoms: true, build: async () => [...(await L2()), { role: 'user', content: atomAsk(BRW12) }] },
  CL9b: { case: 2, what: 'CL9a with the `format` JSON Schema enum (enforced)', numCtx: 16384, atoms: true, enforced: true, build: async () => VARIANTS.CL9a.build() },
});
const L_IDS = ['L', 'L+tools', 'L9a', 'L9b', 'CL', 'CL+tools', 'CL9a', 'CL9b'];

/** A fetch tool answered from the run's project/ (read-only), the way plan-cli would. */
function simulateTool(name, args, caseNo) {
  const rel = String(args?.path ?? '.').replace(/^\.\//, '');
  const abs = path.resolve(PROJ, rel);
  if (!abs.startsWith(PROJ)) return { ok: false, sentence: 'That path is outside the project.' };
  if (name === 'read_file') {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, sentence: `No file ${rel}.` };
    const code = read(abs);
    return { ok: true, path: rel, contentHash: crypto.createHash('sha256').update(code).digest('hex'), code };
  }
  if (name === 'list_dir') {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { ok: false, sentence: `No folder ${rel}.` };
    return { ok: true, path: rel, entries: fs.readdirSync(abs).filter((e) => !['node_modules', '.git', '.next', 'line'].includes(e)) };
  }
  if (name === 'plan_status') return { ok: true, sentence: caseNo === 1 ? `${LEDGER1}\n${STEP1}` : `${LEDGER2}\n${STEP2}` };
  return null;
}
for (const v of Object.values(VARIANTS)) v.numCtx ??= 32768;

// ---------- Ollama ----------
async function chat(model, messages, { numCtx, seed, tools = true, format }) {
  const body = { model, stream: false, messages, options: { ...BASE_OPTIONS, num_ctx: numCtx, temperature: 0.2, seed, num_predict: NUM_PREDICT }, ...(tools ? { tools: Array.isArray(tools) ? tools : T12.tools } : {}), ...(format ? { format } : {}) };
  const t0 = Date.now();
  const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
  const res = await r.json();
  if (!r.ok) throw new Error(res?.error ?? `HTTP ${r.status}`);
  const ms = (x) => Math.round((x ?? 0) / 1e6);
  return { content: res.message?.content ?? '', toolCalls: res.message?.tool_calls ?? null, promptTokens: res.prompt_eval_count ?? null, evalTokens: res.eval_count ?? null, latencyMs: ms(res.total_duration) - ms(res.load_duration), loadMs: ms(res.load_duration), wallMs: Date.now() - t0, doneReason: res.done_reason };
}

async function embed(texts) {
  const r = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'nomic-embed-text', input: texts }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j.embeddings;
}
const cos = (a, b) => { let d = 0; let x = 0; let y = 0; for (let i = 0; i < a.length; i += 1) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };

// ---------- tsc ----------
const PROBE_DIR = path.join('/tmp', `construct-probe-${process.pid}`);
function setupProbe() {
  fs.rmSync(PROBE_DIR, { recursive: true, force: true });
  const skip = new Set(['node_modules', '.git', '.next', 'line', 'tsconfig.tsbuildinfo']);
  fs.cpSync(PROJ, PROBE_DIR, { recursive: true, filter: (src) => !skip.has(path.relative(PROJ, src).split(path.sep)[0]) });
  fs.symlinkSync(path.join(PROJ, 'node_modules'), path.join(PROBE_DIR, 'node_modules'));
  fs.writeFileSync(path.join(PROBE_DIR, '.owner'), String(process.pid));
}
const tscCache = new Map();
function tscCheck(code) {
  if (tscCache.has(code)) return tscCache.get(code);
  const file = path.join(PROBE_DIR, PICKS);
  fs.writeFileSync(file, code);
  const r = spawnSync(process.execPath, [path.join(PROJ, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', '.'], { cwd: PROBE_DIR, encoding: 'utf8', maxBuffer: 1 << 26 });
  fs.writeFileSync(file, currentPicks);
  const errors = String(r.stdout).split('\n').filter((l) => l.startsWith(`${PICKS}(`));
  const res = { pass: errors.length === 0, errors: errors.slice(0, 3) };
  tscCache.set(code, res);
  return res;
}

// ---------- scoring ----------
const norm = (s) => String(s ?? '').replace(/[ \t]+$/gm, '').trim();
function firstCall(ans) {
  const calls = Array.isArray(ans.toolCalls) && ans.toolCalls.length ? ans.toolCalls : textToolCalls(ans.content);
  const c = calls[0]; if (!c) return null;
  return { name: c.function?.name, args: argsOf(c) };
}
/**
 * Lenient read of a case-1 answer the driver would NOT accept (a direct `line.setCode` call instead of plan_add, or a
 * call missing its closing braces): the PicksPage code it meant, or null. Reported apart from the strict score.
 */
function lenientCode(content) {
  const text = String(content ?? '').replace(/```(json)?/g, '');
  let calls = textToolCalls(text);
  for (let k = 1; !calls.length && k <= 3; k += 1) calls = textToolCalls(text + '}'.repeat(k));
  const c = calls[0]; if (!c) return null;
  const a = argsOf(c);
  if (c.function.name === 'plan_add' && a.args?.file === PICKS && typeof a.args?.code === 'string') return a.args.code;
  if (c.function.name === 'line.setCode' && a.file === PICKS && typeof a.code === 'string') return a.code;
  return null;
}
function lenientScore(content) {
  const code = lenientCode(content);
  if (code == null) return { codeRecovered: false, lenientTscPass: false, lenientUseful: false };
  const t = norm(code) === norm(failing.code) ? { pass: false } : tscCheck(code);
  const sk = /— add it here/.test(code) || norm(code) === norm(currentPicks);
  return { codeRecovered: true, lenientTscPass: t.pass, lenientUseful: t.pass && /My picks/.test(code) && !sk, lenientCode: code };
}
function scoreCase1(ans) {
  const c = firstCall(ans);
  const a = c?.args ?? {};
  const isSetCode = c?.name === 'plan_add' && a.tool === 'line.setCode' && a.args?.file === PICKS && typeof a.args?.code === 'string';
  if (!isSetCode) return { call: c ? `${c.name}${a.tool ? ` ${a.tool}` : ''}${a.fix ? ` fix ${a.fix}` : ''}` : 'none', setCode: false, repeat: false, tscPass: false, ...lenientScore(ans.content) };
  const repeat = norm(a.args.code) === norm(failing.code);
  const t = repeat ? { pass: false, errors: ['(same code as the failing attempt)'] } : tscCheck(a.args.code);
  const skeleton = /— add it here/.test(a.args.code) || norm(a.args.code) === norm(currentPicks);
  const pointShown = /My picks/.test(a.args.code);
  return { call: 'plan_add line.setCode PicksPage', setCode: true, repeat, tscPass: t.pass, skeleton, pointShown, usefulPass: t.pass && pointShown && !skeleton, tscErrors: t.errors, hashOk: a.args.contentHash === failing.contentHash, useClient: /'use client'|"use client"/.test(a.args.code), code: a.args.code };
}
function scoreCase2(ans) {
  const c = firstCall(ans);
  const a = c?.args ?? {};
  const lib = a.tool === 'line.baseOn' ? a.args?.libraryId : (a.tool === 'line.setCode' ? /@line-base (\S+)/.exec(a.args?.code ?? '')?.[1] : null);
  // Intent: the library page named, even when the call itself is malformed (e.g. `line.baseOn` called directly, not via plan_add).
  const intent = lib ?? (c?.name === 'line.baseOn' ? a.libraryId : null) ?? null;
  return { call: c ? `${c.name}${a.tool ? ` ${a.tool}` : ''}` : 'none', libraryId: lib ?? null, intentLibraryId: intent, feature: a.args?.feature ?? a.feature ?? null, listPagePick: c?.name === 'plan_add' && lib === 'pages/ListPage', listPageIntent: intent === 'pages/ListPage' };
}
function atomLines(ans, enforced) {
  if (enforced) {
    const j = parse(ans.content);
    const steps = Array.isArray(j?.steps) ? j.steps : null;
    const schemaOk = !!steps && steps.length >= 1 && steps.length <= 8 && steps.every((s) => s && ((typeof s.atom === 'string' && ATOM_SENTENCES.includes(s.atom) && Object.keys(s).length === 1) || (typeof s.missing === 'string' && Object.keys(s).length === 1)));
    return { schemaOk, parsed: !!steps, lines: (steps ?? []).map((s) => (typeof s?.atom === 'string' ? { atom: s.atom } : { missing: String(s?.missing ?? '') })) };
  }
  const lines = String(ans.content).split('\n').map((l) => l.trim().replace(/^(\d+[.)]|[-*•])\s*/, '').replace(/^["'`]+|["'`]+$/g, '').trim()).filter(Boolean);
  return { lines: lines.map((l) => (/^MISSING:/i.test(l) ? { missing: l.replace(/^MISSING:\s*/i, '') } : { atom: l })) };
}
async function scoreAtoms(ans, caseNo, enforced, { nearestFrom = null } = {}) {
  const { lines, schemaOk, parsed } = atomLines(ans, enforced);
  const atoms = lines.filter((l) => 'atom' in l).map((l) => l.atom);
  const valid = atoms.filter((s) => ATOM_SENTENCES.includes(s));
  const invalid = atoms.filter((s) => !ATOM_SENTENCES.includes(s));
  const missing = lines.filter((l) => 'missing' in l).map((l) => l.missing);
  const ref = REFERENCE[`case${caseNo}`];
  // A MISSING line that only restates a registered atom sentence is not a real gap.
  // ...or paraphrases one ("The page needs to <atom sentence>").
  const restates = (m) => ATOM_SENTENCES.some((s) => m.trim().toLowerCase().includes(s.toLowerCase().replace(/\.$/, '')));
  const missingAtoms = missing.filter(restates);
  const properMissing = missing.filter((m) => !restates(m));
  const refMatch = valid.length === atoms.length && JSON.stringify(valid) === JSON.stringify(ref.atoms) && (!ref.needsMissing || properMissing.length > 0);
  let nearest = nearestFrom ?? [];
  if (!nearestFrom && invalid.length) {
    try {
      const [atomVecs, invVecs] = [await embed(ATOM_SENTENCES), await embed(invalid.slice(0, 8))];
      nearest = invVecs.map((v, i) => { const sims = atomVecs.map((av) => cos(v, av)); const k = sims.indexOf(Math.max(...sims)); return { said: invalid[i].slice(0, 200), atom: ATOMS[k].id, cosine: Number(sims[k].toFixed(3)) }; });
    } catch (e) { nearest = [{ error: String(e.message ?? e) }]; }
  }
  return { answered: atoms.length, validAtoms: valid.length, validPct: atoms.length ? Math.round((100 * valid.length) / atoms.length) : (missing.length ? 100 : 0), atoms: valid.map((s) => ATOMS.find((a) => a.english === s).id), refMatch, missingUsed: properMissing.length > 0, missingRestatesAtom: missingAtoms.length, missing: missing.slice(0, 8).map((s) => s.slice(0, 200)), nearest, ...(enforced ? { schemaOk, parsed } : {}) };
}

// ---------- compare loop ----------
async function compareMessages(msgs, firstAns, firstScore) {
  return [...msgs,
    { role: 'assistant', content: firstAns.content, ...(firstAns.toolCalls ? { tool_calls: firstAns.toolCalls } : {}) },
    { role: 'tool', content: JSON.stringify({ ok: false, code: 'COMPARE', sentence: [
      'Not saved yet: compare what your code does with what the point asks, then send plan_add line.setCode again with the whole file (corrected where they differ) and the same contentHash.',
      `What your code does: ${await englishOf(firstScore.code)}`,
      `What the point asks: ${PCK1}`,
    ].join('\n') }) }];
}

// ---------- run ----------
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
function pickBest(rows) { // best of V2-V4 per model: tscPass, then fewer repeats, then fewer prompt tokens
  const by = (v) => rows.filter((r) => r.variant === v);
  const stat = (v) => ({ v, pass: by(v).filter((r) => r.score.tscPass).length, rep: by(v).filter((r) => r.score.repeat).length, tok: mean(by(v).map((r) => r.promptTokens)) });
  return ['V2', 'V3', 'V4'].map(stat).sort((a, b) => b.pass - a.pass || a.rep - b.rep || a.tok - b.tok)[0].v;
}

async function main() {
  const meta = {
    experiment: '#925 isolated context probe', at: new Date().toISOString(), sourceRun: RUN, models: MODELS, seeds: SEEDS,
    options: { ...BASE_OPTIONS, temperature: 0.2, num_predict: NUM_PREDICT, seed: 'per sample' },
    ollamaVersion: (await fetch(`${OLLAMA}/api/version`).then((r) => r.json()).catch(() => ({}))).version ?? null,
    smithLinks: (() => { const s = smithLinks(); return { smith: s.smith.message, codemod: s.codemod.message }; })(),
    english: 'TypeScript transpileModule (types and JSX removed) -> each function -> packages/summarize/links.mjs summarizeCode (atomic-codemod to-english via packages/line-links)',
    case1: { turnInput: 'logs/turn-input/12.json', failingCode: failing.code, contentHash: failing.contentHash, repeats: C1x.repeats, refusalIndexInCompacted: refusalIdx },
    case2: { turnInput: 'logs/turn-input/1.json (its answer is the DetailPage baseOn; turn-input/2.json already contains it)' },
    atoms: { candidates: ATOMS.map((a) => ({ id: a.id, english: a.english })), reference: REFERENCE },
    variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, { case: v.case, what: v.what, numCtx: v.numCtx }])),
  };
  const want = (v) => !ONLY || ONLY.has(v);
  if (argv.includes('--rescore')) { // recompute scores from the saved answers (no model call, no tsc), then rewrite JSON + MD
    const j = readJson(OUT);
    for (const r of j.samples) {
      const v = VARIANTS[r.variant];
      if (r.score?.error) continue;
      if (v.atoms) r.score = await scoreAtoms({ content: r.said }, v.case, !!v.enforced, { nearestFrom: r.score.nearest ?? [] });
      else if (v.case === 2 && !v.fetchLoop) r.score = scoreCase2({ content: r.said });
      else if (v.case === 1 && !r.score?.setCode) {
        if (!fs.existsSync(PROBE_DIR)) setupProbe();
        Object.assign(r.score, lenientScore(r.said));
      } else if (v.case === 1 && r.score?.setCode) {
        const sk = /— add it here/.test(r.score.code) || norm(r.score.code) === norm(currentPicks);
        Object.assign(r.score, { skeleton: sk, pointShown: /My picks/.test(r.score.code), usefulPass: r.score.tscPass && /My picks/.test(r.score.code) && !sk });
      }
    }
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
    j.summary = summarize(j.samples);
    fs.writeFileSync(OUT, `${JSON.stringify(j, null, 1)}\n`);
    fs.writeFileSync(MD, markdown(j.meta, j.summary, j.prompts));
    console.log('rescored', j.samples.length);
    return;
  }
  if (DRY) {
    for (const [k, v] of Object.entries(VARIANTS)) {
      if (!v.build || !want(k)) continue;
      const m = await v.build();
      console.log(k, 'messages', m.length, 'chars', JSON.stringify(m).length, '| last:', JSON.stringify(m[m.length - 1].content).slice(0, 160));
      if (argv.includes('--dump')) m.slice(1).forEach((x, i) => console.log(`--- ${i + 1} ${x.role}\n${x.role === 'tool' ? (parse(x.content)?.sentence ?? x.content) : x.content}`));
    }
    console.log('english(failing):', await englishOf(failing.code));
    return;
  }
  setupProbe();
  const sanity = { skeleton: tscCheck(currentPicks), failing: tscCheck(failing.code), exampleFix: tscCheck(failing.code.replace("localStorage.getItem('picks'))", "localStorage.getItem('picks') ?? '[]')")) };
  tscCache.clear();
  meta.tscSanity = sanity;
  console.log('tsc sanity', JSON.stringify({ skeleton: sanity.skeleton.pass, failing: sanity.failing.pass, exampleFix: sanity.exampleFix.pass }));
  const prev = argv.includes('--append') && fs.existsSync(OUT) ? readJson(OUT) : null;
  const rows = prev ? prev.samples.filter((r) => !want(r.variant)) : []; const prompts = prev?.prompts ?? {};
  if (prev) { const keepMeta = prev.meta; Object.assign(keepMeta, { variants: meta.variants, appendedAt: meta.at, tscSanityAppend: meta.tscSanity }); for (const k of Object.keys(meta)) delete meta[k]; Object.assign(meta, keepMeta); }
  const save = () => fs.writeFileSync(OUT, `${JSON.stringify({ meta, summary: summarize(rows), prompts, samples: rows }, null, 1)}\n`);
  const run1 = async (model, id, msgs, extra = {}) => {
    const v = VARIANTS[id];
    prompts[`${id}@${model}`] ??= { last: msgs[msgs.length - 1].content, chars: JSON.stringify(msgs).length };
    for (const seed of SEEDS) {
      let ans; let error = null;
      try { ans = await chat(model, msgs, { numCtx: v.numCtx, seed, tools: v.atoms ? false : (v.tools ?? true), format: v.enforced ? ATOM_FORMAT : undefined }); } catch (e) { error = String(e.message ?? e); }
      let score; let second = null;
      if (error) score = { error };
      else if (v.atoms) score = await scoreAtoms(ans, v.case, !!v.enforced);
      else if (v.case === 2) score = scoreCase2(ans);
      else score = scoreCase1(ans);
      if (!error && extra.compareOf) { /* unreachable: compare variants use runCompare */ }
      const row = { case: v.case, variant: id, model, seed, promptTokens: ans?.promptTokens ?? null, evalTokens: ans?.evalTokens ?? null, latencyMs: ans?.latencyMs ?? null, wallMs: ans?.wallMs ?? null, loadMs: ans?.loadMs ?? null, doneReason: ans?.doneReason ?? null, score, said: String(ans?.content ?? '').slice(0, 3000), ...(second ? { second } : {}) };
      rows.push(row);
      console.log(`${model} ${id} seed ${seed}: in ${row.promptTokens} ${row.latencyMs} ms ${JSON.stringify({ ...score, code: undefined, said: undefined, nearest: undefined, tscErrors: undefined })}`);
      save();
    }
  };
  const runCompare = async (model, id, baseId, baseMsgs) => {
    const v = VARIANTS[id];
    prompts[`${id}@${model}`] ??= { last: '(per sample: the base answer, then a COMPARE tool message with the English of that answer and the PCK-1 text)' };
    for (const seed of SEEDS) {
      const first = rows.find((r) => r.variant === baseId && r.model === model && r.seed === seed);
      let row;
      if (!first || !first.score.setCode || first.score.error) {
        row = { case: 1, variant: id, model, seed, promptTokens: first?.promptTokens ?? null, latencyMs: first?.latencyMs ?? null, firstPromptTokens: first?.promptTokens ?? null, secondCall: false, score: first?.score ?? { error: 'no base sample' } };
      } else {
        const firstAns = { content: first.said, toolCalls: null };
        const msgs = await compareMessages(baseMsgs, firstAns, first.score);
        let ans; let error = null;
        try { ans = await chat(model, msgs, { numCtx: v.numCtx, seed }); } catch (e) { error = String(e.message ?? e); }
        const score = error ? { error } : scoreCase1(ans);
        score.changedFromFirst = !error && score.setCode ? norm(score.code) !== norm(first.score.code) : null;
        row = { case: 1, variant: id, model, seed, promptTokens: ans?.promptTokens ?? null, firstPromptTokens: first.promptTokens, latencyMs: (first.latencyMs ?? 0) + (ans?.latencyMs ?? 0), secondLatencyMs: ans?.latencyMs ?? null, secondCall: true, firstScore: { setCode: first.score.setCode, repeat: first.score.repeat, tscPass: first.score.tscPass }, score, said: String(ans?.content ?? '').slice(0, 3000), compareSentence: parse(msgs[msgs.length - 1].content).sentence };
      }
      rows.push(row);
      console.log(`${model} ${id} seed ${seed}: in ${row.promptTokens} ${row.latencyMs} ms ${JSON.stringify({ ...row.score, code: undefined, tscErrors: undefined })}`);
      save();
    }
  };
  const runFetch = async (model, id, msgs0) => {
    const v = VARIANTS[id];
    prompts[`${id}@${model}`] ??= { last: msgs0[msgs0.length - 1].content, chars: JSON.stringify(msgs0).length };
    for (const seed of SEEDS) {
      let msgs = msgs0; let lat = 0; let fetches = 0; let ans = null; let error = null; const fetched = [];
      for (let k = 0; k < 4; k += 1) {
        try { ans = await chat(model, msgs, { numCtx: v.numCtx, seed, tools: v.tools }); } catch (e) { error = String(e.message ?? e); break; }
        lat += ans.latencyMs ?? 0;
        const c = firstCall(ans);
        const out = c ? simulateTool(c.name, c.args, v.case) : null;
        if (!out) break;
        fetches += 1; fetched.push(`${c.name} ${c.args?.path ?? ''}`.trim());
        msgs = [...msgs, { role: 'assistant', content: ans.content, ...(ans.toolCalls ? { tool_calls: ans.toolCalls } : {}) }, { role: 'tool', content: JSON.stringify(out) }];
      }
      const score = error ? { error } : (v.case === 2 ? scoreCase2(ans) : scoreCase1(ans));
      const row = { case: v.case, variant: id, model, seed, promptTokens: ans?.promptTokens ?? null, latencyMs: lat, fetches, fetched, score, said: String(ans?.content ?? '').slice(0, 3000) };
      rows.push(row);
      console.log(`${model} ${id} seed ${seed}: in ${row.promptTokens} ${row.latencyMs} ms fetches ${fetches} ${JSON.stringify({ ...score, code: undefined, tscErrors: undefined })}`);
      save();
    }
  };
  try {
    for (const model of MODELS) {
      for (const id of L_IDS) if (ONLY && want(id)) await (VARIANTS[id].fetchLoop ? runFetch : run1)(model, id, await VARIANTS[id].build());
      if (ONLY && [...ONLY].every((id) => L_IDS.includes(id))) continue;
      const built = {};
      for (const id of ['V0', 'V1', 'V2', 'V3', 'V4']) if (want(id)) { built[id] = await VARIANTS[id].build(); await run1(model, id, built[id]); }
      const best = want('V2') && want('V3') && want('V4') ? pickBest(rows.filter((r) => r.model === model)) : 'V4';
      meta[`bestOfV2toV4@${model}`] = best;
      const bestMsgs = built[best] ?? await VARIANTS[best].build();
      if (want('V5')) {
        const sentence = best === 'V4' ? `${shortRefusal()}\n${await pack({ english: true })}` : best === 'V3' ? `${refusalObj.sentence}\n${EXAMPLE_FIX}\n${await pack({ english: true })}` : `${refusalObj.sentence}\n${await pack({ english: true })}`;
        await run1(model, 'V5', withRefusal(C1x.messages, sentence, best !== 'V4'));
      }
      if (want('V7')) await runCompare(model, 'V7', best, bestMsgs);
      if (want('V8')) { built.V8 = await VARIANTS.V8.build(); await run1(model, 'V8', built.V8); }
      if (want('V8+V7') && built.V8) await runCompare(model, 'V8+V7', 'V8', built.V8);
      for (const id of ['V9a', 'V9b', 'V10', 'C0', 'C1', 'C2', 'C3', 'C4', 'C9a', 'C9b']) if (want(id)) await run1(model, id, await VARIANTS[id].build());
    }
  } finally {
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
  }
  save();
  fs.writeFileSync(MD, markdown(meta, summarize(rows), prompts));
  console.log(`wrote ${path.relative(REPO, OUT)} and ${path.relative(REPO, MD)}`);
}

function summarize(rows) {
  const keys = [...new Set(rows.map((r) => `${r.variant}|${r.model}`))];
  return keys.map((k) => {
    const [variant, model] = k.split('|');
    const rs = rows.filter((r) => r.variant === variant && r.model === model);
    const v = VARIANTS[variant];
    const n = rs.length; const cnt = (f) => rs.filter(f).length;
    const base = { case: v.case, variant, model, n, promptTokens: mean(rs.map((r) => r.promptTokens).filter((x) => x != null)), latencyMs: mean(rs.map((r) => r.latencyMs).filter((x) => x != null)), errors: cnt((r) => r.score?.error) };
    if (v.atoms) return { ...base, validPct: mean(rs.map((r) => r.score.validPct ?? 0)), refMatch: cnt((r) => r.score.refMatch), missingUsed: cnt((r) => r.score.missingUsed), missingRestatesAtom: cnt((r) => r.score.missingRestatesAtom > 0), answered: mean(rs.map((r) => r.score.answered ?? 0)), ...(v.enforced ? { schemaOk: cnt((r) => r.score.schemaOk) } : {}), atomsPicked: [...new Set(rs.flatMap((r) => r.score.atoms ?? []))] };
    if (v.case === 2) return { ...base, listPagePick: cnt((r) => r.score.listPagePick), listPageIntent: cnt((r) => r.score.listPageIntent), picked: rs.map((r) => (r.score.listPagePick ? 'ListPage' : `${r.score.call}${r.score.intentLibraryId ? ` (${r.score.intentLibraryId.replace('pages/', '')})` : ''}`)) };
    return { ...base, setCode: cnt((r) => r.score.setCode), repeat: cnt((r) => r.score.repeat), tscPass: cnt((r) => r.score.tscPass), usefulPass: cnt((r) => r.score.usefulPass), lenientUseful: cnt((r) => r.score.usefulPass || r.score.lenientUseful), skeleton: cnt((r) => r.score.skeleton), fetches: mean(rs.map((r) => r.fetches ?? 0)), missingImport: cnt((r) => (r.score.tscErrors ?? []).some((e) => /TS2307/.test(e))), calls: rs.map((r) => (r.score.setCode ? (r.score.repeat ? 'repeat' : (r.score.tscPass ? 'pass' : 'fail')) : r.score.call)) };
  });
}

function markdown(meta, summary, prompts) {
  const short = (m) => m.replace('qwen2.5-coder:', '');
  const c1 = summary.filter((s) => s.case === 1 && !VARIANTS[s.variant].atoms);
  const c2 = summary.filter((s) => s.case === 2 && !VARIANTS[s.variant].atoms);
  const at = summary.filter((s) => VARIANTS[s.variant].atoms);
  const L = [];
  L.push('# Context probe r1 (#925)', '', '<!-- CONCLUSION -->', '');
  L.push(`Source run: \`${path.basename(RUN)}\` (read-only). Ollama ${meta.ollamaVersion}; models ${meta.models.join(', ')}; temperature 0.2, seeds ${meta.seeds.join(',')}, num_predict ${NUM_PREDICT}. Harness: \`bench/ecommerce/driver/context-probe.mjs\`; raw samples: \`bench/lending/results/context-probe-r1.json\`.`, '');
  L.push(`English = "Smith translation": ${meta.english}. ${meta.smithLinks.codemod}`, '');
  L.push(`tsc sanity on the copied project: skeleton ${meta.tscSanity.skeleton.pass ? 'passes' : 'fails'}, failing attempt ${meta.tscSanity.failing.pass ? 'passes' : 'fails'}, example fix ${meta.tscSanity.exampleFix.pass ? 'passes' : 'fails'}.`, '');
  L.push('## Case 1: PicksPage TS2345 loop (turn 12)', '', '| variant | model | what changed | num_ctx | setCode x/5 | repeat x/5 | tsc-pass x/5 | useful pass x/5 | lenient useful x/5 | skeleton resent x/5 | imports a missing module x/5 | prompt tokens | latency ms |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of c1) L.push(`| ${s.variant} | ${short(s.model)} | ${VARIANTS[s.variant].what}${VARIANTS[s.variant].dependsOnBest ? ` (best = ${meta[`bestOfV2toV4@${s.model}`]})` : ''} | ${VARIANTS[s.variant].numCtx} | ${s.setCode}/${s.n} | ${s.repeat}/${s.n} | ${s.tscPass}/${s.n} | ${s.usefulPass}/${s.n} | ${s.lenientUseful}/${s.n} | ${s.skeleton}/${s.n} | ${s.missingImport}/${s.n} | ${s.promptTokens} | ${s.latencyMs} |`);
  L.push('', 'L+tools / CL+tools: latency sums every call of the fetch loop (up to 4); prompt tokens are the last call\'s.');
  L.push('', 'Compare-loop rows (V7, V8+V7): prompt tokens are the second call\'s; latency is both calls together.', '');
  L.push('## Case 2: base page for browse (turn 1)', '', '| variant | model | what changed | ListPage pick (valid plan_add) x/5 | ListPage intent x/5 | answers | prompt tokens | latency ms |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of c2) L.push(`| ${s.variant} | ${short(s.model)} | ${VARIANTS[s.variant].what} | ${s.listPagePick}/${s.n} | ${s.listPageIntent}/${s.n} | ${s.picked.join('; ')} | ${s.promptTokens} | ${s.latencyMs} |`);
  L.push('', '## Atom sentences (V9a/V9b, C9a/C9b)', '', `Candidates: all ${ATOMS.length} registered atoms (packages/line-atoms, \`toSmithEntry(...).english\`). Reference from the spec point text: PCK-1 = no registered atom, MISSING only; BRW-1/BRW-2 = [client-pagination] plus MISSING for the row rendering.`, '');
  L.push('| variant | model | atom lines (mean) | valid-atom % | reference match x/5 | real MISSING x/5 | MISSING restating an atom x/5 | schema-valid x/5 | atoms picked | prompt tokens | latency ms |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of at) L.push(`| ${s.variant} | ${short(s.model)} | ${s.answered} | ${s.validPct} | ${s.refMatch}/${s.n} | ${s.missingUsed}/${s.n} | ${s.missingRestatesAtom}/${s.n} | ${s.schemaOk ?? '-'}${s.schemaOk != null ? `/${s.n}` : ''} | ${s.atomsPicked.join(', ') || '-'} | ${s.promptTokens} | ${s.latencyMs} |`);
  L.push('', `Atom gaps (what the points need that the registry lacks): PCK-1: ${REFERENCE.case1.gaps.join(' ')} BRW-1: ${REFERENCE.case2.gaps.join(' ')}`, '');
  L.push('<!-- WINNER -->', '');
  return `${L.join('\n')}\n`;
}

await main();
