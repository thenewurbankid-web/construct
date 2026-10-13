#!/usr/bin/env node
// #938: how well each local model PICKS the right tool with Ollama's native tool calling. A small replay set: five
// fixed builder turns (each needs one specific call: plan_status, plan_add line.setCode with args, read_file,
// plan_run_next, finish) and five real lending-qwen-7b-r1 turn inputs (bench/lending/results/tool-harness/replay.json,
// each with the tools that are a right next call). Every case runs in four configurations:
//
//   current/full    the r1 system prompt and qwen-agent's TOOLS.line (today's builder)
//   clean/full      cleanPrompt() (no CLI table, no bare-JSON replies) and the choosing tools (turn-tools.mjs), all ten
//   clean/subset    the same, only the tools the turn's situation needs, cut to the model's maxTools
//   layered         L1 decide (format enum of intent sentences) -> L2 native call offering only that tool -> L3 check
//
// Scores: native % (the reply had native tool_calls), right % (the first call is a right tool, with the right key
// arguments on the fixed cases), valid % (its arguments pass the schema and the path-scope check), calls per step
// (Ollama requests per case), median latency. Writes bench/lending/results/tool-harness/r1.json and the table into
// driver/model-profiles.json. Every Ollama call is sequential; run it in the heavy slot:
//
//   packages/tools/dev/heavy.sh node bench/ecommerce/driver/tool-harness-probe.mjs [--models a,b] [--ollama URL]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callNative, checkArgs, layeredTurn, recordSentence, toolName } from '../../../packages/engine/line/toolHarness.mjs';
import { TOOLS } from './qwen-agent.mjs';
import { cleanPrompt } from './prompt-variants.mjs';
import { CHOOSING_TOOLS, toolsForTurn, intentsFor, INTENTS } from './turn-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OLLAMA = arg('--ollama', process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
const MODELS = arg('--models', 'qwen2.5-coder:7b,qwen2.5-coder:1.5b,qwen3:4b').split(',');
const OUT = path.resolve(arg('--out', path.join(root, 'bench/lending/results/tool-harness/r1.json')));
const REPLAY = path.join(root, 'bench/lending/results/tool-harness/replay.json');
const PROFILES = path.join(here, 'model-profiles.json');
const OPTIONS = { num_ctx: 16384, temperature: 0.2, seed: 7 };
/** Tools per turn in the subset configurations (fewer for the small model). */
export const MAX_TOOLS = { 'qwen2.5-coder:7b': 5, 'qwen2.5-coder:1.5b': 3, 'qwen3:4b': 5 };
const FIRST = 'Start building. Use only your tools. Call finish when every acceptance point is done or you cannot make more progress.';
const FILE = 'features/browse/domains/countBooks.ts';

/** The fixed cases: what the user says, the last tool answer (the situation), and what a right call is. */
export const FIXED = [
  { id: 'status', say: 'Show me the plan and the acceptance points of the feature I am working on.', last: null, accept: ['plan_status'] },
  { id: 'setCode', say: `Add a plan step that creates the new file ${FILE} with this code: export const countBooks = (books: unknown[]): number => books.length;`, last: null, accept: ['plan_add'],
    args: (a) => a?.tool === 'line.setCode' && a?.args?.file === FILE && /countBooks/.test(String(a?.args?.code ?? '')) },
  { id: 'read', say: 'Read the file features/browse/spec.md.', last: null, accept: ['read_file'], args: (a) => a?.path === 'features/browse/spec.md' },
  { id: 'runNext', say: 'The step you added is approved and waiting. Land it now.', last: { name: 'plan_add', out: { ok: true, state: 'ready' } }, accept: ['plan_run_next'] },
  { id: 'finish', say: 'Every acceptance point is done and validate is clean. Stop now with a short summary.', last: { name: 'plan_run_next', out: { ok: true } }, accept: ['finish'], args: (a) => typeof a?.summary === 'string' && a.summary.length > 0 },
];

/** L3's own check: a path argument is project-relative and inside the project. */
export function scopeCheck(_name, args) {
  for (const p of [args?.path, args?.file, args?.args?.file]) {
    if (p === undefined) continue;
    if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) return `${JSON.stringify(p)} is not a project-relative path inside the project`;
  }
  return null;
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
/** The replay case's situation: its last assistant call and the tool answer after it. */
function lastOf(messages) {
  const i = messages.map((m) => m.role).lastIndexOf('tool');
  if (i < 1) return null;
  return { name: messages[i - 1]?.tool_calls?.[0]?.function?.name ?? '', out: safeParse(messages[i].content) ?? {} };
}
/** The ledger view a layered turn starts from: one sentence per earlier tool call (L4's default record). */
function ledgerOf(messages) {
  const lines = [];
  messages.forEach((m, i) => { if (m.role === 'tool') { const c = messages[i - 1]?.tool_calls?.[0]?.function; lines.push(`- ${recordSentence(c?.name ?? '?', c?.arguments ?? {}, safeParse(m.content) ?? {})}`); } });
  return lines.length ? lines.join('\n') : '- Nothing done yet.';
}
/** The request a layered turn answers: the fixed case's words, else the newest tool answer (or the first message). */
function requestOf(c) {
  if (c.say) return c.say;
  const t = [...c.messages].reverse().find((m) => m.role === 'tool' || m.role === 'user');
  const o = safeParse(t.content);
  return String(o?.sentence ?? t.content).slice(0, 1500);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const unload = (model) => fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).then((r) => r.text()).catch(() => '');

/** Score one first call against the case. */
function score(c, call, tools) {
  if (!call) return { name: null, right: false, valid: false };
  const name = call.function.name; const a = call.function.arguments;
  const tool = tools.find((t) => toolName(t) === name) ?? CHOOSING_TOOLS[name];
  const valid = Boolean(tool) && !checkArgs(tool, a, { check: scopeCheck });
  const resend = c.id === 'r1-t7' && name === 'plan_add' && a?.args?.file === 'features/picks/pages/PicksPage.tsx';
  return { name, valid, right: c.accept.includes(name) && !resend && (!c.args || c.args(a)) };
}

async function main() {
  const replay = JSON.parse(fs.readFileSync(REPLAY, 'utf8'));
  const current = replay.system;
  const clean = cleanPrompt(current);
  const cases = [
    ...FIXED.map((f) => ({ ...f, messages: [{ role: 'user', content: FIRST }, { role: 'user', content: f.say }] })),
    ...replay.cases.map((r) => ({ ...r, last: lastOf(r.messages) })),
  ];
  const all = Object.values(CHOOSING_TOOLS);
  const results = { at: new Date().toISOString(), ollama: OLLAMA, options: OPTIONS, maxTools: MAX_TOOLS, cases: cases.map((c) => ({ id: c.id, accept: c.accept })), models: {} };
  for (const model of MODELS) {
    const max = MAX_TOOLS[model] ?? 5;
    const rows = [];
    for (const cfg of ['current/full', 'clean/full', 'clean/subset', 'layered']) {
      const turns = [];
      for (const c of cases) {
        const t0 = Date.now();
        const subset = toolsForTurn(c.last, { max });
        try {
          if (cfg === 'layered') {
            const view = ledgerOf(c.messages); const request = requestOf(c);
            const r = await layeredTurn({ model, tools: subset, intents: intentsFor(subset), options: OPTIONS, ollama: OLLAMA, check: scopeCheck,
              decideMessages: [{ role: 'system', content: 'You are a coder building a web app with Line. Read the ledger and the request, then say what you need next.' }, { role: 'user', content: `Ledger:\n${view}\n\nRequest: ${request}\n\nWhat do you need next?` }],
              callMessages: (tool, refusal) => [{ role: 'system', content: clean }, { role: 'user', content: `Ledger:\n${view}\n\nRequest: ${request}\n\nCall ${toolName(tool)} now.${refusal ? `\n${refusal.sentence}` : ''}` }] });
            const s = score(c, r.call, subset);
            turns.push({ case: c.id, ms: Date.now() - t0, requests: r.requests, native: r.native, intent: r.intent, l1Right: c.accept.includes(INTENTS[r.intent] ?? ''), ...s, valid: r.valid && s.valid, offered: subset.map(toolName), note: r.sentence.slice(0, 200) });
          } else {
            const tools = cfg === 'current/full' ? TOOLS.line : cfg === 'clean/full' ? all : subset;
            const system = cfg === 'current/full' ? current : clean;
            const h = await callNative({ model, messages: [{ role: 'system', content: system }, ...c.messages], tools, options: OPTIONS, ollama: OLLAMA, signal: AbortSignal.timeout(300_000) });
            const native = h.calls.length + h.wrong.length > 0;
            // Diagnostic only (the harness never parses text): did a text answer at least name a right tool?
            const named = native ? null : /"name"\s*:\s*"([^"]+)"/.exec(String(h.message.content ?? ''))?.[1] ?? null;
            turns.push({ case: c.id, ms: Date.now() - t0, requests: 1, native, textNamedRight: named !== null && c.accept.includes(named), ...score(c, h.calls[0] ?? h.wrong[0] ?? null, tools), offered: tools.map(toolName), content: native ? '' : String(h.message.content ?? '').slice(0, 200) });
          }
        } catch (e) {
          turns.push({ case: c.id, ms: Date.now() - t0, requests: 1, native: false, name: null, right: false, valid: false, error: String(/** @type {Error} */ (e).message ?? e) });
        }
        const x = turns[turns.length - 1];
        console.log(`${model} ${cfg} ${c.id}: ${x.error ? `error ${x.error}` : `${x.native ? 'native' : 'text'} ${x.name ?? '-'} right=${x.right} valid=${x.valid} requests=${x.requests}`} ${x.ms} ms`);
      }
      const n = cases.length;
      rows.push({ config: cfg, native: pct(turns.filter((t) => t.native).length, n), right: pct(turns.filter((t) => t.right).length, n), valid: pct(turns.filter((t) => t.valid).length, n),
        textNamedRight: cfg === 'layered' ? null : pct(turns.filter((t) => t.textNamedRight).length, n), l1Right: cfg === 'layered' ? pct(turns.filter((t) => t.l1Right).length, n) : null,
        callsPerStep: Math.round((10 * turns.reduce((s, t) => s + t.requests, 0)) / n) / 10, medianMs: median(turns.map((t) => t.ms)), turns });
    }
    await unload(model);
    results.models[model] = { rows };
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);
  const prev = fs.existsSync(PROFILES) ? JSON.parse(fs.readFileSync(PROFILES, 'utf8')) : {};
  const models = { ...(prev.models ?? {}) };
  for (const [m, r] of Object.entries(results.models)) {
    models[m] = { ...(models[m] ?? {}), measured: { file: path.relative(root, OUT), at: results.at.slice(0, 10), table: r.rows.map((x) => `${x.config}: native ${x.native}%, right ${x.right}%, valid ${x.valid}%, ${x.callsPerStep} calls/step, ${x.l1Right === null ? `text named a right tool ${x.textNamedRight}%` : `L1 chose right ${x.l1Right}%`}, median ${x.medianMs} ms`) } };
  }
  fs.writeFileSync(PROFILES, `${JSON.stringify({ ...prev, models }, null, 1)}\n`);
  console.log('| model | config | native % | right % | valid % | calls/step | text named right % | L1 right % | median ms |');
  for (const [m, r] of Object.entries(results.models)) for (const x of r.rows) console.log(`| ${m} | ${x.config} | ${x.native} | ${x.right} | ${x.valid} | ${x.callsPerStep} | ${x.textNamedRight ?? '-'} | ${x.l1Right ?? '-'} | ${x.medianMs} |`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
