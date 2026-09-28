// The AI layer. Every task is small, single-turn and checked, so a 2B local model can do it:
//   choose / pick-fields  answer ONE question from ≤ 4 numbered facts; the answer must cite a fact that
//                         mentions the part or the chosen option, or it is skipped (never a guess)
//   draft-body            write ONE expression for a placeholder; it is executed against the design's own
//                         examples and accepted only if it reproduces them
// Results are cached by prompt hash (ai-cache.json), so a re-run replays them with zero tokens, and the
// provenance of every AI answer (model, cited fact) goes to decisions.json for review.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { makeProvider } from "./provider.mjs";
import { loadAiConfig, taskConfig } from "./config.mjs";
import { loadFacts, retrieve, words } from "./context.mjs";
import { SEVERITY, plainTemplate, checkExplanation, EXPLAIN_SYSTEM, explainPrompt, EXPLAIN_SCHEMA, BLOCK_SCHEMA, blockPrompt, checkBlock } from "./explain.mjs";
import { listItems, flat, envelopeOf } from "../match.mjs";

const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);

const sha = (...p) => crypto.createHash("sha1").update(p.join("\u0000")).digest("hex").slice(0, 16);
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const partOf = (id) => id.split("#")[0].split(".").slice(id.startsWith("action.") ? 2 : 1).join(".");
const json = (text) => { try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { return null; } };

const SYSTEM = "You answer one question about a UI page. Use ONLY the numbered facts. Reply with JSON only. If no fact settles it, use fact 0. " +
  '"Static text" means the words never change, so pick it only if a fact says so. If a fact says a value is combined from fields, computed, supplied by the controller, or will come from an endpoint later, pick the option that builds a placeholder.';

// Expressions become generated code, so they stay simple. They are never run as JavaScript: safe-eval.mjs parses them
// and interprets only a small allow-list (see its header).
export { evalExpression } from "./safe-eval.mjs";
import { evalExpression } from "./safe-eval.mjs";

export function createAi({ dir, spec, source, matched, overrides = {}, trusted = false, provider = null, onLog = null, useCache = true }) {
  const cfg = loadAiConfig({ dir, overrides, trusted });
  const facts = loadFacts({ dir, spec, source });
  const cacheFile = path.join(dir, "ai-cache.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
  const before = JSON.stringify(cache);
  const stats = { calls: 0, cached: 0, msTotal: 0, tokensIn: 0, tokensOut: 0, skipped: 0, answered: 0, drafted: 0, errors: [] };
  const decisions = {};
  const dead = new Set(); // tasks whose model is unreachable: don't retry every question
  const providers = {};

  // One call of one task. Returns { text, model, done(verdict) } or null (unreachable model). Every exchange is
  // reported to onLog: what was asked, what came back, any reasoning, and (through done) what we made of it.
  let seq = 0;
  async function call(task, user, schema, maxTokens = 120, label = "", structured = null, system = SYSTEM) {
    const c = taskConfig(cfg, task);
    const model = `${c.provider}:${c.model}`;
    const base = { kind: "call", n: ++seq, task, model, label, system, user };
    const key = sha(c.provider, c.model, system, user);
    const hit = useCache ? cache[key] : null;
    if (hit) {
      stats.cached++;
      const e = { ...base, answer: hit.text, thinking: hit.thinking ?? "", tokens: { in: hit.in, out: hit.out }, ms: 0, cached: true };
      return { text: hit.text, model, done: (verdict) => onLog?.({ ...e, verdict }) };
    }
    if (dead.has(task)) {
      onLog?.({ kind: "note", task, model, label, text: `not asked: ${model} was unreachable earlier in this run` });
      return null;
    }
    const t0 = Date.now();
    try {
      const id = `${c.provider}:${c.model}:${c.baseUrl ?? ""}`;
      providers[id] ??= provider ?? makeProvider(c);
      const { text, usage, thinking = "" } = await providers[id]({ system, user, schema, maxTokens, structured });
      const ms = Date.now() - t0;
      stats.calls++; stats.msTotal += ms; stats.tokensIn += usage.in; stats.tokensOut += usage.out;
      if (useCache) cache[key] = { text, thinking, in: usage.in, out: usage.out };
      const e = { ...base, answer: text, thinking, tokens: { in: usage.in, out: usage.out }, ms, cached: false };
      return { text, model, done: (verdict) => onLog?.({ ...e, verdict }) };
    } catch (err) {
      dead.add(task);
      stats.errors.push(`${task} (${model}): ${err.message}`);
      onLog?.({ ...base, answer: "", thinking: "", tokens: { in: 0, out: 0 }, ms: Date.now() - t0, cached: false, verdict: { ok: false, text: `the call failed: ${err.message}` } });
      return null;
    }
  }

  // T12.4: the joint placeholder follow-up ("where does it come from? which fields feed it?", asked together —
  // see ask.mjs's askJoint). One fact-checked AI attempt at BOTH parts at once, replacing what used to be two
  // separate "choose" + "pick-fields" attempts across two separate sub-questions. The placeholder's own name is
  // never AI-picked (the old text-type "what's it called?" step just used its default too — see answer()'s
  // first line above), so this only returns `from` and, when relevant, `inputs`; `fn` is always the default.
  async function answerJoint(q) {
    const part = partOf(q.focusId ?? q.id);
    const shown = retrieve(facts, [...words(part), ...q.sources.flatMap((o) => words(o.label)), ...q.itemFields.flatMap((o) => words(o.label))], 4);
    if (!shown.length) {
      onLog?.({ kind: "note", task: "pick-fields", label: q.id, text: `no fact mentions "${part}" → not asked (no tokens spent)` });
      stats.skipped++;
      return null;
    }
    const user = `Question: ${q.text}\nWhere from:\n${q.sources.map((o, i) => `${i + 1}) ${o.label}`).join("\n")}\n` +
      (q.itemFields.length ? `If "combine values from API fields" is picked, which fields (any that apply; leave empty otherwise):\n${q.itemFields.map((o, i) => `${i + 1}) ${o.label}`).join("\n")}\n` : "") +
      `Facts:\n${shown.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n` +
      `Reply: {"from": option number (where from), "inputs": [field numbers, only when "combine values from API fields" was picked], "fact": number of the fact that settles it, 0 if none}`;
    const schema = { type: "object", properties: { from: { type: "integer" }, inputs: { type: "array", items: { type: "integer" } }, fact: { type: "integer" } }, required: ["from", "inputs", "fact"] };
    const r = await call("pick-fields", user, schema, 150, q.id, { part, question: q.text, options: q.sources.map((o) => o.label), facts: shown, multi: true });
    if (!r) { stats.skipped++; return null; }
    const a = json(r.text);
    const okFrom = a && Number.isInteger(a.from) && a.from >= 1 && a.from <= q.sources.length;
    const from = okFrom ? q.sources[a.from - 1].value : null;
    const inputIdx = Array.isArray(a?.inputs) ? a.inputs : [];
    const okInputs = from !== "fields" || (inputIdx.length > 0 && inputIdx.every((n) => Number.isInteger(n) && n >= 1 && n <= q.itemFields.length));
    const inputs = from === "fields" && okInputs ? inputIdx.map((n) => q.itemFields[n - 1].value) : [];
    const fact = a?.fact;
    const okFact = Number.isInteger(fact) && fact >= 1 && fact <= shown.length;
    const evidence = okFact ? shown[fact - 1] : null;
    const relevantWords = new Set([...words(part), ...(okFrom ? words(q.sources[a.from - 1].label) : []), ...inputs.flatMap((v) => words(v))]);
    const relevant = okFrom && okFact && words(evidence).some((w) => relevantWords.has(w));
    const why = !a ? "the reply was not valid JSON"
      : !okFrom ? "the choice was not one of the options"
      : !okInputs ? 'it picked "combine values from API fields" but named no valid field'
      : !okFact ? "it cited no fact (fact 0 or out of range)"
      : !relevant ? "the cited fact does not mention the part or the chosen option"
      : null;
    if (why) { r.done({ ok: false, text: `skipped — ${why}` }); stats.skipped++; return null; }
    stats.answered++;
    const label = `${q.sources[a.from - 1].label}${inputs.length ? ` (${inputs.join(", ")})` : ""}`;
    r.done({ ok: true, text: `accepted → ${label} (cited: “${evidence}”)` });
    decisions[q.id] = { task: "pick-fields", model: r.model, evidence, answer: label };
    return { from, inputs, fn: q.defaultName[from] };
  }

  // Answers a question the user would otherwise get: an option, an array of options, a string, or null (skip).
  async function answer(q) {
    if (q.type === "text") return q.default;
    if (q.type === "joint") return answerJoint(q);
    const part = partOf(q.focusId ?? q.id);
    const opts = q.options ?? [];
    const query = [...words(part), ...words(q.text.replace(/^.*?\(/, "")), ...opts.flatMap((o) => words(o.label))];
    const shown = retrieve(facts, [...words(part), ...opts.flatMap((o) => words(o.label))], 4);
    if (!shown.length) {
      onLog?.({ kind: "note", task: q.type === "multi" ? "pick-fields" : "choose", label: q.id, text: `no fact mentions "${part}" → not asked (no tokens spent)` });
      stats.skipped++;
      return null;
    }
    const multi = q.type === "multi";
    const user = `Question: ${q.text}\nOptions:\n${opts.map((o, i) => `${i + 1}) ${o.label}`).join("\n")}\nFacts:\n${shown.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n` +
      (multi ? `Reply: {"choices": [option numbers], "fact": number of the fact that settles it, 0 if none}` : `Reply: {"choice": option number, "fact": number of the fact that settles it, 0 if none}`);
    const schema = multi
      ? { type: "object", properties: { choices: { type: "array", items: { type: "integer" } }, fact: { type: "integer" } }, required: ["choices", "fact"] }
      : { type: "object", properties: { choice: { type: "integer" }, fact: { type: "integer" } }, required: ["choice", "fact"] };
    const task = multi ? "pick-fields" : "choose";
    const r = await call(task, user, schema, 120, q.id, { part, question: q.text, options: opts.map((o) => o.label), facts: shown, multi });
    if (!r) { stats.skipped++; return null; }
    const a = json(r.text);
    const picks = a && (multi ? a.choices : [a.choice]);
    const fact = a?.fact;
    const okPicks = Array.isArray(picks) && picks.length && picks.every((n) => Number.isInteger(n) && n >= 1 && n <= opts.length) && new Set(picks).size === picks.length;
    const okFact = Number.isInteger(fact) && fact >= 1 && fact <= shown.length;
    const evidence = okFact ? shown[fact - 1] : null;
    // The cited fact has to be about this part or the chosen option — otherwise it is not evidence.
    const relevant = okPicks && okFact && words(evidence).some((w) => new Set([...words(part), ...picks.flatMap((n) => words(opts[n - 1].label))]).has(w));
    // "Static text" would silently hide a missing connection, so the AI may not choose it: that stays a human call.
    const why = !a ? "the reply was not valid JSON"
      : !okPicks ? "the choice was not one of the options"
      : !okFact ? "it cited no fact (fact 0 or out of range)"
      : !relevant ? "the cited fact does not mention the part or the chosen option"
      : picks.some((n) => opts[n - 1].value?.static) ? "it picked “static text”, which the AI may not choose"
      : null;
    if (why) { r.done({ ok: false, text: `skipped — ${why}` }); stats.skipped++; return null; }
    stats.answered++;
    const chosen = picks.map((n) => opts[n - 1]);
    r.done({ ok: true, text: `accepted → ${chosen.map((o) => o.label).join(" + ")} (cited: “${evidence}”)` });
    decisions[q.id] = { task, model: r.model, evidence, answer: chosen.map((o) => o.label).join(" + ") };
    return multi ? chosen : chosen[0];
  }

  // Placeholders built from fields: ask for one expression, run it on the design's own examples, keep it only if it matches.
  async function draft() {
    const items = listItems(matched.endpoints); // raw (nested) items: expressions read item.a.b
    const envelope = envelopeOf(matched.endpoints);
    const idx = matched.list?.alignedIdx ?? [];
    const jobs = [];
    for (const f of matched.list?.fields ?? []) {
      const c = f.candidates.length === 1 ? f.candidates[0] : null;
      if (c?.custom && c.from === "fields" && !c.body) {
        const pick = (it) => Object.fromEntries(c.inputs.map((k) => [k, getPath(it, k)]));
        jobs.push({ id: `list.${f.name}`, part: f.name, c, var: "item", cases: f.examples.map((want, i) => ({ scope: { item: items[idx[i]] ?? {} }, show: JSON.stringify(pick(items[idx[i]])), want })).slice(0, 4) });
      }
    }
    for (const v of matched.values) {
      const c = v.candidates.length === 1 ? v.candidates[0] : null;
      if (c?.custom && c.from === "fields" && !c.body) {
        const shows = Object.fromEntries(c.inputs.map((k) => [k, k.startsWith("data.") ? getPath(envelope, k.slice(5)) : items.slice(0, 4).map((it) => getPath(it, k))]));
        jobs.push({ id: `value.${v.name}`, part: v.name, c, var: "items", cases: [{ scope: { items, data: envelope ?? {} }, show: JSON.stringify(shows), want: v.example }] });
      }
    }
    for (const j of jobs) {
      const shown = retrieve(facts, [...words(j.part), ...j.c.inputs.flatMap(words)], 2);
      let note = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const user = `Write ONE JavaScript expression that produces the text shown in the design.\nUse only ${j.var}.<field>${j.var === "items" ? " or data.<path>" : ""}, string/number literals and methods like join, slice, toUpperCase. No functions, no statements.\nPart: ${j.part}\n` +
          (shown.length ? `Facts:\n${shown.map((f) => "- " + f).join("\n")}\n` : "") +
          `Cases (${j.var} -> expected):\n${j.cases.map((k) => `${k.show} -> ${JSON.stringify(k.want)}`).join("\n")}\n${note}Reply: {"expression": "<code>"}`;
        const r = await call("draft-body", user, { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] }, 100, j.id);
        if (!r) break;
        const expr = json(r.text)?.expression;
        if (!expr) { r.done({ ok: false, text: "no expression in the reply → giving up on this placeholder" }); break; }
        try {
          const bad = j.cases.find((k) => norm(evalExpression(expr, k.scope)) !== norm(k.want));
          if (!bad) {
            r.done({ ok: true, text: `ran the expression on ${j.cases.length} design example(s): all reproduced → kept` });
            j.c.body = expr;
            stats.drafted++;
            decisions[j.id + "#body"] = { task: "draft-body", model: r.model, evidence: `runs against ${j.cases.length} design example(s) and reproduces them`, answer: expr };
            break;
          }
          const got = JSON.stringify(norm(evalExpression(expr, bad.scope)));
          r.done({ ok: false, text: `ran it: got ${got} for ${bad.show}, design shows ${JSON.stringify(bad.want)} → ${attempt === 0 ? "asking once more" : "rejected"}` });
          note = `Your previous expression ${JSON.stringify(expr)} gave ${got} for ${bad.show}; expected ${JSON.stringify(bad.want)}. Fix it.\n`;
        } catch (e) {
          r.done({ ok: false, text: `rejected: ${e.message}` });
          note = `Your previous expression ${JSON.stringify(expr)} was rejected (${e.message}). Use only ${j.var}.<field> and simple methods.\n`;
        }
      }
    }
  }

  // Plain-language versions of the open items, for the run summary. Severity comes from a rule; the model only
  // writes the words, and its text is used only if it passes checkExplanation, else a fixed template is used.
  async function explain(items, limit = 12) {
    const out = [];
    for (const o of items.slice(0, limit)) {
      const tmpl = plainTemplate(o);
      const sev = SEVERITY[o.state] ?? { rank: 5, label: "Open" };
      const facts = `part: ${o.part}\nstate: ${o.state}\nwhat we know: ${o.why}\nwhat would close it: ${o.hint}`;
      let text = tmpl, by = "template", model = null, ms = 0;
      const r = await call("explain", explainPrompt(o, facts), EXPLAIN_SCHEMA, 220, o.id, null, EXPLAIN_SYSTEM);
      if (r) {
        const e = json(r.text);
        const v = checkExplanation(e, facts, o);
        r.done(v.ok ? { ok: true, text: `used: “${e.headline}”` } : { ok: false, text: `fell back to the fixed text — ${v.why}` });
        if (v.ok) { text = { headline: e.headline.trim(), why: e.why.trim(), action: e.action.trim() }; by = "model"; model = r.model; }
      }
      out.push({ id: o.id, part: o.part, state: o.state, priority: sev.rank, label: sev.label, ...text, by, model });
    }
    return out.sort((a, b) => a.priority - b.priority);
  }

  // One call per summary block, each with only that block's facts. Text is used only if it stays inside them.
  async function summarizeBlocks(blocks) {
    const out = [];
    for (const b of blocks) {
      let text = b.template, by = "template", model = null;
      const r = await call("explain", blockPrompt(b), BLOCK_SCHEMA, 160, `block:${b.key}`, null, EXPLAIN_SYSTEM);
      if (r) {
        const e = json(r.text), v = checkBlock(e, b);
        r.done(v.ok ? { ok: true, text: `used: “${e.summary}”` } : { ok: false, text: `fell back to the fixed text — ${v.why}` });
        if (v.ok) { text = e.summary.trim(); by = "model"; model = r.model; }
      }
      out.push({ key: b.key, title: b.title, attention: b.attention, text, by, model });
    }
    return out;
  }

  function save() {
    if (useCache && JSON.stringify(cache) !== before) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1) + "\n");
  }
  return { answer, draft, explain, summarizeBlocks, save, stats, decisions, config: cfg };
}
