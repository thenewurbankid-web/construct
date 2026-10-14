#!/usr/bin/env node
// Readability sample for the owner: 10 functions picked deterministically from Smith's own corpus (SMITH_ROOTS, this
// repo only), 5 pages/components and 5 logic, each split short (<= 6 lines) and long (7-15 lines). For each: the code,
// Smith's English (hardened Smith, TS/TSX fed directly) and the 1.5b gloss (packages/engine/lsp/gloss.mjs).
//
//   node bench/smith-eval/readability.mjs --gloss [--dry]   # the gloss is off by default (owner 2026-10-14); --dry: the pick only
//
// Writes bench/smith-eval/READABILITY.md (the table only, a blank rating column) and readability.json (the same plus
// each gloss's guard verdict). Calls Ollama: run it through heavy.sh.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, SMITH_ROOTS, walk } from '../../packages/tools/smith-system1/sources.mjs';
import { normalizeCode, sha256 } from '../../packages/tools/smith-system1/lib.mjs';
import { tsFunctionsByName } from './oss-hardened.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MAX_LINES = 15;
export const SHORT_LINES = 6;

/** Every top-level function of the corpus with at most MAX_LINES lines, distinct by normalized code. */
export function candidates(roots = SMITH_ROOTS) {
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      let fns;
      try { fns = tsFunctionsByName(fs.readFileSync(path.join(REPO, file), 'utf8'), file); } catch { continue; }
      for (const [name, fn] of fns) {
        const lines = fn.code.split('\n').length;
        const key = normalizeCode(fn.code);
        if (lines > MAX_LINES || lines < 2 || seen.has(key)) continue;
        seen.add(key);
        const page = /^[A-Z]/.test(name.split('.').pop()) && /<[A-Za-z>]/.test(fn.code);
        out.push({ file, name, kind: fn.kind, code: fn.code, lines, group: page ? 'page' : 'logic', band: lines <= SHORT_LINES ? 'short' : 'long', h: sha256(`${file}#${name}\n${key}`) });
      }
    }
  }
  return out;
}

/** 10 picks: per group (page, logic) 3 long + 2 short, in sha256 order, at most one per file. */
export function pick(cands) {
  const out = [];
  const files = new Set();
  for (const [group, band, n] of [['page', 'long', 3], ['page', 'short', 2], ['logic', 'long', 3], ['logic', 'short', 2]]) {
    const pool = cands.filter((c) => c.group === group && c.band === band).sort((a, b) => (a.h < b.h ? -1 : 1));
    let k = 0;
    for (const c of pool) { if (k >= n) break; if (files.has(c.file)) continue; files.add(c.file); out.push(c); k += 1; }
  }
  return out;
}

const cell = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;');
const codeCell = (code) => `<pre>${code.split('\n').map((l) => cell(l).replace(/^( +)/, (m) => '&nbsp;'.repeat(m.length))).join('<br>')}</pre>`;

export function renderMarkdown(rows) {
  const L = ['| # | code | Smith | gloss (1.5b) | rating (1-5) |', '| --- | --- | --- | --- | --- |'];
  rows.forEach((r, i) => L.push(`| ${i + 1} | ${codeCell(r.code)} | ${cell(r.smith)} | ${r.gloss.dropped ? '(dropped)' : cell(r.gloss.gloss)} |  |`));
  return `${L.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--reguard')) { // re-apply the current guard to the saved glosses (no model call)
    const { introducedToken } = await import('../../packages/engine/lsp/gloss.mjs');
    const file = path.join(HERE, 'readability.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of j.rows) {
      const raw = r.gloss.gloss ?? r.gloss.rejected;
      const bad = raw ? introducedToken(raw, r.smith) : { kind: 'gloss', value: '(none)' };
      r.gloss = bad ? { gloss: null, dropped: true, reason: `introduces ${bad.kind} ${JSON.stringify(bad.value)} not in Smith's text`, rejected: raw } : { gloss: raw, dropped: false, reason: null, rejected: null };
    }
    j.dropped = j.rows.filter((r) => r.gloss.dropped).length;
    fs.writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
    fs.writeFileSync(path.join(HERE, 'READABILITY.md'), renderMarkdown(j.rows));
    for (const r of j.rows) console.log(`${r.name}: ${r.gloss.dropped ? `DROPPED (${r.gloss.reason})` : 'ok'}`);
    console.log(`gloss guard dropped ${j.dropped}/${j.rows.length}`);
    process.exit(0);
  }
  // The 1.5b gloss is off by default (owner 2026-10-14: readable text is Smith's plain style); --gloss runs it.
  if (!process.argv.includes('--gloss') && !process.argv.includes('--dry')) { console.error('The gloss is off by default; pass --gloss to run it (calls Ollama).'); process.exit(2); }
  const picks = pick(candidates());
  if (process.argv.includes('--dry')) { for (const p of picks) console.log(p.group, p.band, p.lines, `${p.file}#${p.name}`); process.exit(0); }
  const links = await import('../../packages/summarize/links.mjs');
  const { glossFor } = await import('../../packages/engine/lsp/gloss.mjs');
  const st = links.smithLinks();
  if (!st.codemod.ok) { console.error(`atomic-codemod is not linked: ${st.codemod.message}`); process.exit(1); }
  const rows = [];
  for (const p of picks) {
    const s = await links.summarizeCode(p.code, { kind: p.kind });
    const smith = s.sentences.join(' ');
    const g = await glossFor(s.sentences);
    rows.push({ file: p.file, name: p.name, group: p.group, band: p.band, lines: p.lines, code: p.code, smith, gloss: { gloss: g.gloss, dropped: g.dropped, reason: g.reason, rejected: g.rejected ?? null } });
    console.log(`${p.group}/${p.band} ${p.name}: ${g.dropped ? `DROPPED (${g.reason})` : 'ok'}`);
  }
  const dropped = rows.filter((r) => r.gloss.dropped).length;
  fs.writeFileSync(path.join(HERE, 'READABILITY.md'), renderMarkdown(rows));
  fs.writeFileSync(path.join(HERE, 'readability.json'), `${JSON.stringify({ smith: { atomicCodemod: st.codemod.head.slice(0, 7), smith: st.smith.ok ? st.smith.head.slice(0, 7) : null }, glossModel: 'qwen2.5-coder:1.5b', dropped, n: rows.length, rows }, null, 2)}\n`);
  console.log(`gloss guard dropped ${dropped}/${rows.length}`);
}
