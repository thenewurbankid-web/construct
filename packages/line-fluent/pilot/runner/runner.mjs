// Pilot runner (t1-3b): one C1 entry per request, C2 answer out, C3 gate, retry with the refusal.
// Every collaborator is injected: build(entry, {refusal}) -> {system, user, prefill};
// model(request) -> {text, tokensIn, tokensOut}; gate(answer) -> C3.
// Contracts: docs/line/FLUENT-PLAN-2026-10-15.md (C2, C3, "Wave 2 leaves").
import { appendFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const entryId = (entry) => (typeof entry === 'string' ? entry : entry?.id ?? null);

// A model output that does not parse is a C3 schema failure, so it retries like any other refusal.
export function parseFailure(id, error) {
  const detail = String(error?.message ?? error).split('\n')[0];
  return {
    entry: id,
    pass: false,
    checks: { schema: 'fail', grammar: 'skip', equivalence: 'skip', types: 'skip' },
    refusal: `The answer is not valid JSON (${detail}); reply with one JSON object holding the C2 fields in order and nothing after it.`,
    fixes: [],
  };
}

export function parseAnswer(prefill, text) {
  try {
    return { answer: JSON.parse(`${prefill ?? ''}${text ?? ''}`) };
  } catch (error) {
    return { error };
  }
}

async function runEntry(entry, { model, gate, build, maxRetries }) {
  const id = entryId(entry);
  const started = performance.now();
  let refusal = null;
  let tries = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let answer = null;
  let verdict = null;
  while (tries <= maxRetries) {
    tries += 1;
    const request = build(entry, { refusal });
    const reply = await model(request);
    tokensIn += reply?.tokensIn ?? 0;
    tokensOut += reply?.tokensOut ?? 0;
    const parsed = parseAnswer(request.prefill, reply?.text);
    if (parsed.error) {
      answer = null;
      verdict = parseFailure(id, parsed.error);
    } else {
      answer = parsed.answer;
      verdict = await gate(answer);
    }
    if (verdict.pass) break;
    refusal = verdict.refusal;
  }
  return { entry: id, answer, gate: verdict, tries, tokensIn, tokensOut, ms: Math.round(performance.now() - started) };
}

export function summarize(results) {
  const n = results.length;
  const passed = results.filter((r) => r.gate?.pass).length;
  const sum = (key) => results.reduce((acc, r) => acc + (r[key] ?? 0), 0);
  const per = (total) => (n ? total / n : 0);
  const decisions = {};
  for (const r of results) {
    const decision = r.answer?.decision;
    if (typeof decision === 'string') decisions[decision] = (decisions[decision] ?? 0) + 1;
  }
  return {
    entries: n,
    passed,
    passRate: per(passed),
    retries: results.reduce((acc, r) => acc + Math.max(0, r.tries - 1), 0),
    tokensPerEntry: per(sum('tokensIn') + sum('tokensOut')),
    msPerEntry: per(sum('ms')),
    decisions,
  };
}

export async function runPilot(entries, { model, gate, build, maxRetries = 1, log } = {}) {
  for (const [name, fn] of Object.entries({ model, gate, build })) {
    if (typeof fn !== 'function') throw new TypeError(`runPilot needs an injected ${name} function.`);
  }
  const results = [];
  for (const entry of entries) {
    const result = await runEntry(entry, { model, gate, build, maxRetries });
    results.push(result);
    if (log) await appendFile(log, `${JSON.stringify(result)}\n`);
  }
  return { results, summary: summarize(results) };
}
