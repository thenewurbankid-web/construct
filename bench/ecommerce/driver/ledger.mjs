// #932 the builder's ledger, as the turn builder (turn.mjs) reads it: facts, decisions and open questions, each one
// English sentence with its cites. Every tool result is distilled into it (one sentence + cites) instead of staying in
// the message history. This is an adapter with the interface of the central research ledger being built on branch
// line/research-loop (packages/engine/line/research/: `ledgerView(ctx, budget)`); when that module is on the branch,
// loadLedger() uses it, else this local one. Deterministic, no model call.
//
//   createLedger()                 {entries, add(entry), distil(name, args, out)}
//   distil(name, args, out)        a tool call and its answer -> {kind, text, cites} (one sentence)
//   ledgerView(ctx, budget)        the ledger as text under `budget` tokens: newest first kept, printed oldest first,
//                                  identical sentences once with "(xN)"
//   loadLedger()                   the central module when present, else this one
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHARS_PER_TOKEN } from './compact.mjs';

/** @typedef {{kind: 'fact'|'decision'|'question', text: string, cites: string[], n?: number}} LedgerEntry */

const first = (s, n = 220) => { const l = String(s ?? '').split('\n').find((x) => x.trim()) ?? ''; return l.length > n ? `${l.slice(0, n - 3)}...` : l; };
const fileOf = (args) => {
  const a = args?.args && typeof args.args === 'object' ? args.args : args ?? {};
  return [a.file, a.page, a.path, a.libraryId ? `library/${a.libraryId}` : null].find((x) => typeof x === 'string' && x) ?? null;
};

/**
 * One tool call and its answer as one ledger sentence with cites (files, the tool, the refusal code, step ids).
 * @param {string} name @param {any} args @param {any} out
 * @returns {LedgerEntry}
 */
export function distil(name, args, out) {
  const tool = name === 'plan_add' ? String(args?.tool ?? 'plan_add') : name;
  const file = fileOf(args);
  const cites = [tool, ...(file ? [file] : []), ...(out?.code ? [out.code] : []), ...(out?.stepId ? [out.stepId] : [])];
  if (out?.ok === false) {
    const said = String(out.sentence ?? '');
    const fix = /Example fix for line \d+[^\n]*/.exec(said)?.[0];
    const why = first(said.replace(/^Stop: [^\n]*\n/, ''));
    return { kind: 'fact', text: `${tool}${file ? ` on ${file}` : ''} was refused (${out.code}): ${why.replace(/^Refused \([A-Z_]+\):\s*/, '')}${fix ? ` ${fix}` : ''}`, cites };
  }
  if (name === 'read_file') return { kind: 'fact', text: `Read ${file}${out?.contentHash ? ` (contentHash ${out.contentHash})` : ''}.`, cites };
  if (name === 'list_dir') return { kind: 'fact', text: `${file ?? '.'} has ${first(out?.sentence ?? JSON.stringify(out?.entries ?? []), 160)}`, cites };
  if (name === 'plan_status') return { kind: 'fact', text: `Plan: ${Object.entries(out?.counts ?? {}).map(([k, v]) => `${v} ${k}`).join(', ') || 'no steps'}; current feature ${out?.work?.current ?? '-'} (${out?.work?.count ?? 0} open items).`, cites: ['plan_status'] };
  if (name === 'plan_run_next' || (name === 'plan_add' && out?.stepId)) return { kind: 'decision', text: first(out?.sentence ?? `${tool} ok`), cites };
  return { kind: 'fact', text: `${tool}: ${first(out?.sentence ?? 'ok')}`, cites };
}

/**
 * A ledger in memory. `add` keeps an identical sentence once and counts it.
 * @returns {{entries: LedgerEntry[], add: (e: LedgerEntry) => void, distil: (name: string, args: any, out: any) => LedgerEntry}}
 */
export function createLedger() {
  /** @type {LedgerEntry[]} */
  const entries = [];
  const add = (e) => {
    const same = entries.findIndex((x) => x.kind === e.kind && x.text === e.text);
    if (same >= 0) { const [x] = entries.splice(same, 1); entries.push({ ...x, n: (x.n ?? 1) + 1 }); } else entries.push({ ...e, n: 1 });
  };
  return { entries, add, distil: (name, args, out) => { const e = distil(name, args, out); add(e); return e; } };
}

/**
 * The ledger as the model reads it, under `budget` tokens: the newest entries that fit, printed oldest first, grouped
 * by kind (Decisions, Facts, Open questions), each with its cites.
 * @param {{ledger: {entries: LedgerEntry[]}}} ctx @param {number} budget Tokens.
 * @returns {string}
 */
export function ledgerView(ctx, budget) {
  const line = (e) => `- ${e.text}${(e.n ?? 1) > 1 ? ` (x${e.n})` : ''} [${e.cites.join(', ')}]`;
  const kept = [];
  let chars = 0;
  for (const e of [...(ctx.ledger?.entries ?? [])].reverse()) {
    const l = line(e);
    if ((chars + l.length + 1) / CHARS_PER_TOKEN > budget) break;
    kept.unshift(e); chars += l.length + 1;
  }
  const group = (kind, title) => { const xs = kept.filter((e) => e.kind === kind); return xs.length ? [`${title}:`, ...xs.map(line)] : []; };
  const out = [...group('decision', 'Decisions'), ...group('fact', 'Facts'), ...group('question', 'Open questions')];
  return out.length ? out.join('\n') : 'Ledger: empty (nothing done yet).';
}

/**
 * The central research ledger (packages/engine/line/research/index.mjs, branch line/research-loop) when it is on this
 * branch, else this adapter.
 * @returns {Promise<{createLedger: typeof createLedger, ledgerView: typeof ledgerView}>}
 */
export async function loadLedger() {
  const central = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/engine/line/research/index.mjs');
  if (fs.existsSync(central)) {
    try {
      const m = await import(pathToFileURL(central).href);
      // Only when it has this adapter's shape (add, distil, entries); line/research-loop's createLedger(file) does not
      // yet, so merging that branch needs a small bridge here.
      const probe = typeof m.createLedger === 'function' ? (() => { try { return m.createLedger(); } catch { return null; } })() : null;
      if (typeof m.ledgerView === 'function' && probe && typeof probe.add === 'function' && typeof probe.distil === 'function' && Array.isArray(probe.entries)) return { createLedger: m.createLedger, ledgerView: m.ledgerView };
    } catch { /* fall back to the adapter */ }
  }
  return { createLedger, ledgerView };
}
