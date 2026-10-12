#!/usr/bin/env node
// #892: grow and edit the intent gold labels (data/intent-gold.jsonl) fast.
//   node trace/tools/jev/intent-label.mjs add "<request>" [--project dir] [--intent verb.object] [--slot kind:name|none] [--layers ui,workflow] [--uncertain "why"] [--yes]
//   node trace/tools/jev/intent-label.mjs from-last [same flags]     the latest `ask` (data/ask-log.jsonl) as a gold row
//   node trace/tools/jev/intent-label.mjs edit <id> [--intent ..] [--slot ..] [--layers ..] [--request ..] [--uncertain ..|--sure]
//   node trace/tools/jev/intent-label.mjs rm <id>
//   node trace/tools/jev/intent-label.mjs list [--intent verb.object]     rows, then the count per intent
// `add` / `from-last` print static's guess first. Flags you leave out take static's value; with no label flag and no
// --yes it asks for each label on a terminal (Enter keeps static's guess) and only prints the command to run otherwise.
// --gold <file> works with every command (tests use it).
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { readGold, writeGold, readRequest, goldFromFlags, nextId, assertGold, GOLD_FILE, DEFAULT_PROJECT, CATALOG } from './intentGold.mjs';
import { lastAsk, ASK_LOG } from './ask.mjs';

const show = (g) => (g ? `intent ${g.intent} | slot ${g.slot ?? 'none'} | layers ${g.layers.join(',') || '-'}` : 'none');

/**
 * Parse argv into a command, positionals and flags.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const flags = {}; const pos = [];
  const bool = new Set(['yes', 'sure', 'json']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (bool.has(k)) flags[k] = true; else { flags[k] = argv[i + 1] ?? ''; i++; } } else pos.push(a);
  }
  return { cmd: pos[0], args: pos.slice(1), flags };
}

const labelFlags = (f) => ['intent', 'slot', 'layers'].some((k) => f[k] !== undefined);

/** Ask each label on a terminal, static's guess as the default. @param {any} guess */
async function prompt(guess) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const intent = (await rl.question(`intent [${guess?.intent ?? 'unknown'}]: `)).trim() || undefined;
    const slot = (await rl.question(`slot (kind:name or none) [${guess?.slot ?? 'none'}]: `)).trim() || undefined;
    const layers = (await rl.question(`layers (comma list) [${guess?.layers?.join(',') ?? ''}]: `)).trim() || undefined;
    const uncertain = (await rl.question('uncertain? (why, or Enter for sure): ')).trim() || undefined;
    return { intent, slot, layers, uncertain };
  } finally { rl.close(); }
}

/**
 * Run one command; returns the lines it prints (tests call this).
 * @param {string[]} argv
 * @param {{interactive?: boolean, askLog?: string}} [o]
 * @returns {Promise<{lines: string[], code: number}>}
 */
export async function run(argv, o = {}) {
  const { cmd, args, flags } = parseArgs(argv);
  const file = flags.gold || GOLD_FILE;
  const lines = [];
  const say = (s) => lines.push(s);
  const rows = readGold(file);
  if (cmd === 'add' || cmd === 'from-last') {
    let request = args.join(' ');
    let project = flags.project || DEFAULT_PROJECT;
    if (cmd === 'from-last') {
      const last = lastAsk(o.askLog ?? ASK_LOG);
      if (!last) { say('No ask yet: run node trace/tools/jev/ask.mjs "<request>" first.'); return { lines, code: 1 }; }
      request = last.request; project = flags.project || last.project;
    }
    if (!request) { say('Give the request: intent-label.mjs add "<request>"'); return { lines, code: 1 }; }
    const { staticLabels, d } = readRequest(project, request);
    say(`request   ${request}`); say(`project   ${project}`); say(`slot form ${d.request}`);
    say(`static    ${show(staticLabels)}`);
    const slotChoices = Object.keys(d.slots).filter((s) => d.tokens.some((t) => t.slot === s)).map((s) => `${d.slots[s].kind}:${(d.bindings[s] && typeof d.bindings[s] === 'object' ? d.bindings[s].name ?? d.bindings[s].id : d.bindings[s]) ?? s}`);
    say(`slots     ${slotChoices.join(' | ') || 'none'}`);
    let f = flags;
    if (!labelFlags(flags) && !flags.yes) {
      if (!o.interactive) {
        say(`Not saved. Accept static's guess with --yes, or correct it: --intent ${staticLabels?.intent ?? 'add.component'} --slot ${staticLabels?.slot ?? 'none'} --layers ${staticLabels?.layers.join(',') || 'ui'}`);
        return { lines, code: 0 };
      }
      console.log(lines.splice(0).join('\n'));
      f = { ...flags, ...Object.fromEntries(Object.entries(await prompt(staticLabels)).filter(([, v]) => v !== undefined)) };
    }
    let gold;
    try { gold = goldFromFlags(f, staticLabels); } catch (err) { say(`Not saved: ${/** @type {Error} */ (err).message}`); return { lines, code: 1 }; }
    const dup = rows.find((r) => r.request === request && r.project === project);
    if (dup) { say(`Not saved: ${dup.id} already holds this request (use edit ${dup.id}).`); return { lines, code: 1 }; }
    const row = { id: nextId(rows, 'hand'), project, request, gold, source: 'hand', ...(f.uncertain ? { uncertain: f.uncertain } : {}) };
    writeGold([...rows, row], file);
    say(`saved     ${row.id}: ${show(gold)}${row.uncertain ? ` (uncertain: ${row.uncertain})` : ''}`);
    return { lines, code: 0 };
  }
  if (cmd === 'edit') {
    const i = rows.findIndex((r) => r.id === args[0]);
    if (i < 0) { say(`No gold row ${args[0]}.`); return { lines, code: 1 }; }
    const r = { ...rows[i] };
    if (flags.request) r.request = flags.request;
    if (flags.project) r.project = flags.project;
    try { r.gold = goldFromFlags(flags, r.gold); assertGold(r.gold, r.id); } catch (err) { say(`Not saved: ${/** @type {Error} */ (err).message}`); return { lines, code: 1 }; }
    if (flags.uncertain) r.uncertain = flags.uncertain;
    if (flags.sure) delete r.uncertain;
    rows[i] = r;
    writeGold(rows, file);
    say(`edited    ${r.id}: ${show(r.gold)}`);
    return { lines, code: 0 };
  }
  if (cmd === 'rm') {
    const keep = rows.filter((r) => r.id !== args[0]);
    if (keep.length === rows.length) { say(`No gold row ${args[0]}.`); return { lines, code: 1 }; }
    writeGold(keep, file);
    say(`removed   ${args[0]}`);
    return { lines, code: 0 };
  }
  if (cmd === 'list') {
    const shown = rows.filter((r) => !flags.intent || r.gold.intent === flags.intent);
    for (const r of shown) say(`${r.id.padEnd(12)} ${r.gold.intent.padEnd(22)} ${String(r.gold.slot ?? '-').padEnd(26)} ${r.gold.layers.join(',').padEnd(18)} ${r.uncertain ? '?' : ' '} ${r.request}`);
    const count = {};
    for (const r of rows) count[r.gold.intent] = (count[r.gold.intent] ?? 0) + 1;
    const templated = CATALOG.filter((e) => e.templates.length).map((e) => e.id);
    say('');
    say(`${rows.length} rows; per intent: ${Object.entries(count).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
    const missing = templated.filter((id) => !count[id]);
    say(missing.length ? `intents with a template but no gold row: ${missing.join(', ')}` : 'every intent with a template has at least one gold row');
    return { lines, code: 0 };
  }
  say('Commands: add "<request>" | from-last | edit <id> | rm <id> | list   (see the header of intent-label.mjs)');
  return { lines, code: cmd ? 1 : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { lines, code } = await run(process.argv.slice(2), { interactive: process.stdin.isTTY === true });
  if (lines.length) console.log(lines.join('\n'));
  process.exitCode = code;
}
