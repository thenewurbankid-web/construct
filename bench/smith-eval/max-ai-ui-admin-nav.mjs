#!/usr/bin/env node
// The full chain on a real app, read-only: max-ai-ui's src/features/admin-navigation (domain, hook, controller,
// component, page). For each top-level function: Smith (hardened, canonical, raw TS/TSX), the 1.5b gloss
// (gloss.mjs, only with --gloss: off by default, owner 2026-10-14), the compact facts a fill would get with it as the target (facts.mjs compileFacts over the feature
// folder), and atomicGate (gate.mjs). The app is only parsed and read: nothing is written there, nothing run.
//
//   node bench/smith-eval/max-ai-ui-admin-nav.mjs [--app DIR] [--gloss]
//
// Writes bench/smith-eval/MAX-AI-UI-ADMIN-NAV.md and max-ai-ui-admin-nav.json. With --gloss it calls Ollama: run it
// through heavy.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { smithLinks, summarizeCode, toEnglishRaw } from '../../packages/summarize/links.mjs';
import { compileFacts } from '../../packages/engine/lsp/facts.mjs';
import { buildFeatureIndex } from '../../packages/engine/lsp/featureFacts.mjs';
import { atomicGate } from '../../packages/engine/lsp/gate.mjs';
import { smithOfFunction } from '../../packages/engine/lsp/smith.mjs';
import { glossFor } from '../../packages/engine/lsp/gloss.mjs';
import { GAP_RE } from './oss-hardened.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP = path.resolve(argv.includes('--app') ? argv[argv.indexOf('--app') + 1] : path.join(os.homedir(), 'Repositories/max-ai-ui'));
const DIR = 'src/features/admin-navigation';
const CANON = { canonical: true };

const sentencesOf = async (code) => (await summarizeCode(code, { kind: 'function', toEnglishOptions: CANON })).sentences ?? [];
const links = smithLinks();
if (!links.codemod.ok) { console.error(links.codemod.message); process.exit(1); }

const index = await buildFeatureIndex(APP, DIR, { smith: async (code) => (await sentencesOf(code)).slice(1) });
const rows = [];
for (const u of index.units) {
  const sentences = await sentencesOf(u.code);
  const english = sentences.join(' ');
  const raw = await toEnglishRaw(u.code, { kind: 'function', toEnglishOptions: CANON });
  const unhandled = raw.ok ? (raw.result.unhandled ?? []).map((x) => `${x.kind}:${x.type}`) : [`unreadable: ${raw.reason}`];
  const gaps = english.match(GAP_RE) ?? [];
  const gloss = !argv.includes('--gloss') ? { dropped: true, reason: 'off (pass --gloss)', gloss: null } : await glossFor(sentences);
  const src = fs.readFileSync(path.join(APP, u.file), 'utf8');
  const facts = compileFacts({ index, target: { name: u.name, file: u.file }, step: { kind: 'setCode', file: u.file, contentHash: crypto.createHash('sha256').update(src).digest('hex').slice(0, 16), point: `Fill ${u.id}: ${u.doc ?? '(no doc comment)'}` } });
  const gate = await atomicGate({ rel: u.file, source: src, fn: u.name, layer: u.layer, smith: (code, o) => smithOfFunction(code, { ...o, raw: true, canonical: true }) });
  rows.push({ id: u.id, name: u.name, file: u.file, layer: u.layer, lines: u.lines, code: u.code, smith: { sentences: sentences.length, chars: english.length, gaps: gaps.length, unhandled, english }, gloss: { text: gloss.gloss, dropped: gloss.dropped, reason: gloss.reason, rejected: gloss.rejected ?? null }, facts: { tokens: facts.tokens, text: facts.text }, gate: { pass: gate.pass, exempt: gate.exempt, failed: gate.failed, checks: gate.checks.map((c) => c.line) } });
  console.log(`${u.id}: smith ${sentences.length}/${english.length}c gaps ${gaps.length}; gloss ${gloss.dropped ? 'dropped' : 'ok'}; facts ${facts.tokens}t; gate ${gate.pass ? 'pass' : `FAIL ${gate.failed.join(',')}`}`);
}

const fence = (s, lang = '') => `\`\`\`${lang}\n${s}\n\`\`\``;
const L = ['# Smith chain on max-ai-ui admin-navigation', ''];
L.push(`App: \`${DIR}\` of max-ai-ui (read-only: parsed and read, nothing written or run). Smith: atomic-codemod ${links.codemod.head.slice(0, 7)} (canonical mode, raw TS/TSX), smith ${links.smith.ok ? links.smith.head.slice(0, 7) : '-'}. Gloss: qwen2.5-coder:1.5b (packages/engine/lsp/gloss.mjs). Facts: packages/engine/lsp/facts.mjs compileFacts over the feature folder (max-ai-ui is not a Line project, so no moduleScope: the scope is the ${index.feature.files.length} non-test files of the folder, read with the TS language service against the app's tsconfig). Gate: packages/engine/lsp/gate.mjs atomicGate, layer from the folder (domain, hooks, controllers, components, pages).`, '');
for (const r of rows) {
  L.push(`## ${r.id}`, '', `\`${r.file}\`, ${r.layer}`, '');
  L.push(r.lines <= 10 ? fence(r.code, 'tsx') : `Code: ${r.lines} lines.`, '');
  L.push(`**Smith** (${r.smith.sentences} sentences, ${r.smith.chars} characters, ${r.smith.gaps} gaps${r.smith.unhandled.length ? `; unhandled: ${r.smith.unhandled.join(', ')}` : ''}):`, '', `> ${r.smith.english.length > 400 ? `${r.smith.english.slice(0, 400)}… (${r.smith.chars} characters)` : r.smith.english}`, '');
  L.push(`**Gloss** (${r.gloss.dropped ? `dropped: ${r.gloss.reason}` : 'kept'}):`, '', `> ${r.gloss.text ?? (r.gloss.rejected ? `(rejected) ${r.gloss.rejected}` : '-')}`, '');
  L.push(`**Facts** (${r.facts.tokens} tokens):`, '', fence(r.facts.text), '');
  L.push(`**Gate**: ${r.gate.pass ? 'pass' : `fail (${r.gate.failed.join(', ')})`}${r.gate.exempt ? ', template-exempt from Smith' : ''}`, '', ...r.gate.checks.map((c) => `- ${c}`), '');
}
L.push('## Summary', '', '| function | layer | Smith sentences | Smith chars | gaps | gloss | facts tokens | gate | failed checks |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) L.push(`| ${r.name} | ${r.layer} | ${r.smith.sentences} | ${r.smith.chars} | ${r.smith.gaps} | ${r.gloss.dropped ? 'dropped' : 'kept'} | ${r.facts.tokens} | ${r.gate.pass ? 'pass' : 'fail'} | ${r.gate.failed.join(', ') || '-'} |`);
fs.writeFileSync(path.join(HERE, 'MAX-AI-UI-ADMIN-NAV.md'), `${L.join('\n')}\n`);
fs.writeFileSync(path.join(HERE, 'max-ai-ui-admin-nav.json'), `${JSON.stringify({ app: DIR, smith: { atomicCodemod: links.codemod.head, smith: links.smith.head ?? null, canonical: true }, rows }, null, 2)}\n`);
console.log('wrote bench/smith-eval/MAX-AI-UI-ADMIN-NAV.md');
