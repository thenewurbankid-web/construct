#!/usr/bin/env node
// Triage: where does Trace fail, why, and which multiple-choice question would have prevented it?
//
// The question forms are the small vocabulary an improved Trace (or its UI) can ask instead of open-ended
// prompts. Each failure gets the form that would have fixed it and a rendered example question.
//   confirm-or-pick   "F will be used for X. Confirm, or pick another field / none."
//   which-field       "Which field is X?" with candidates ranked (best guess first)
//   plan              "Plan 1 or plan 2" for parts tied on the same fields: one decision settles all of them
//   recipe            "Pick a recipe" for text no built-in format produces (upper-case, prefix, locale, ...)
//   endpoint          "Which endpoint feeds this list?"
import { fileURLToPath } from "node:url";
import path from "node:path";

export const FORMS = {
  "confirm-or-pick": "confirm or pick another field",
  "which-field": "which field is X (ranked)",
  plan: "plan 1 or plan 2",
  recipe: "pick a recipe",
  endpoint: "which endpoint",
};
const WEIGHT = { "wrong-accept": 3, "wrong-endpoint": 3, "library-gap": 2, "missed-match": 2, "coupled-questions": 1, "needless-question": 1 };
const RECIPES = { upper: "UPPER CASE", lower: "lower case", hash: "prefix with #", locale: "locale number (1 234,5 EUR)", spaced: "currency with a space ($ 1.2M)", roundedMillions: "whole millions ($280M)" };

const label = (canon) => (canon ?? "nothing").replace(/^[a-z]+:/, "");
const nice = (v) => `${v.name ?? v.id}`;

function question(form, ctx) {
  const n = ctx.name;
  if (form === "endpoint") return { form, text: `Two endpoints could feed the list. Which one does "${n}" come from?`, options: ctx.options, expected: ctx.want };
  if (form === "recipe") {
    const r = String(ctx.want).split("|")[1];
    return { form, text: `"${n}" shows text that no built-in format produces from ${label(String(ctx.want).split("|")[0])}. Which recipe turns the value into it?`, options: ["as is (asText)", ...Object.values(RECIPES), "something else"], expected: RECIPES[r] ?? r };
  }
  if (form === "plan") return { form, text: `${ctx.parts.length} parts are tied on the same ${ctx.parts.length} fields. Which plan?`, options: ctx.plans, expected: ctx.plans[0] };
  if (form === "confirm-or-pick") return { form, text: `"${n}" would be wired to ${label(ctx.accepted ?? ctx.default)}. Confirm, or pick another?`, options: [`yes, ${label(ctx.accepted ?? ctx.default)}`, ...ctx.others.map(label), "none of these: the API does not have it"], expected: label(ctx.want) };
  return { form: "which-field", text: `Which source is "${n}"?`, options: ctx.options.map(label), expected: label(ctx.want) };
}

// All failures of one case record (see evaluate.mjs). Only certain, scored parts are considered.
export function failuresOf(rec) {
  const out = [];
  const add = (v, type, why, form, ctx) => out.push({ case: rec.id, category: rec.category, part: v.id, type, why, form, weight: WEIGHT[type], question: question(form, { name: nice(v), ...ctx }) });
  const groups = new Map();
  for (const v of rec.verdicts) {
    if (v.couple && v.asked !== false && v.outcome === "ask") (groups.get(v.couple) ?? groups.set(v.couple, []).get(v.couple)).push(v);
    if (v.wrong) {
      if (v.cls === "endpoint") add(v, "wrong-endpoint", `Trace took ${v.accepted} without asking; the screen is fed by ${v.want}`, "endpoint", { options: [v.accepted, v.want], want: v.want });
      else if (v.kind === "gap") add(v, "wrong-accept", `nothing in the API provides this, but ${label(v.accepted)} reproduces the visible values by chance`, "confirm-or-pick", { accepted: v.accepted, others: [], want: "the API does not have it" });
      else add(v, "wrong-accept", `Trace picked ${label(v.accepted)} but the truth is ${label(v.want)}`, "which-field", { options: [v.accepted, v.want], want: v.want });
    } else if (v.kind === "match" && !v.correct && v.cls !== "action") {
      if (v.library) add(v, "library-gap", `the truth (${label(v.want)}) is outside the closed transform library, so no candidate exists`, "recipe", { want: v.want });
      else add(v, "missed-match", `the data settles it (${label(v.want)}) but Trace ${v.outcome === "ask" ? `asked (${v.nCandidates} candidates)` : "did not wire it"}`, "which-field", { options: v.options.length ? v.options : [v.want], want: v.want });
    } else if (v.outcome === "ask" && v.necessary === false && v.cls !== "action") {
      add(v, "needless-question", `the default (${label(v.default)}) was already the right answer`, "confirm-or-pick", { default: v.default, others: v.options.slice(1), want: v.want });
    }
  }
  for (const [g, parts] of groups) {
    if (parts.length < 2) continue;
    const wants = parts.map((p) => p.want);
    const plans = [parts.map((p, i) => `${nice(p)} = ${label(wants[i])}`).join(", "), parts.map((p, i) => `${nice(p)} = ${label(wants[(i + 1) % wants.length])}`).join(", ")];
    out.push({ case: rec.id, category: rec.category, part: `couple:${g}`, type: "coupled-questions", why: `${parts.length} questions asked about parts that are tied on the same fields; one decision settles all`, form: "plan", weight: WEIGHT["coupled-questions"], question: question("plan", { name: g, parts, plans }) });
  }
  return out;
}

export function triage(records, { top = 3 } = {}) {
  const failures = records.flatMap(failuresOf);
  const byType = new Map();
  for (const f of failures) {
    const k = f.type;
    const e = byType.get(k) ?? { type: k, form: f.form, count: 0, weight: 0, categories: {} };
    e.count++; e.weight += f.weight; e.categories[f.category] = (e.categories[f.category] ?? 0) + 1;
    byType.set(k, e);
  }
  const by_type = [...byType.values()].sort((a, b) => b.weight - a.weight || (a.type < b.type ? -1 : 1));
  const worst = {};
  for (const cat of [...new Set(records.map((r) => r.category))].sort()) {
    const per = new Map();
    for (const f of failures.filter((x) => x.category === cat)) {
      const e = per.get(f.case) ?? { case: f.case, score: 0, failures: [] };
      e.score += f.weight; e.failures.push({ part: f.part, type: f.type, why: f.why, question: f.question });
      per.set(f.case, e);
    }
    worst[cat] = [...per.values()].sort((a, b) => b.score - a.score || (a.case < b.case ? -1 : 1)).slice(0, top);
  }
  return { failure_count: failures.length, by_type, worst_cases: worst, failures: failures.map(({ question: q, ...f }) => ({ ...f, question: q })) };
}

export function renderTriage(t, { top = 3 } = {}) {
  const L = [`# Trace triage: ${t.failure_count} failures`, "", "## By failure type (weighted)", ""];
  for (const e of t.by_type) L.push(`- **${e.type}** x${e.count} (weight ${e.weight}) -> question form "${FORMS[e.form]}"; in ${Object.entries(e.categories).map(([c, n]) => `${c} ${n}`).join(", ")}`);
  L.push("", "## Worst cases by category", "");
  for (const [cat, list] of Object.entries(t.worst_cases)) {
    if (!list.length) continue;
    L.push(`### ${cat}`);
    for (const c of list.slice(0, top)) {
      L.push(`- ${c.case} (score ${c.score})`);
      for (const f of c.failures.slice(0, 3)) L.push(`    - ${f.part} [${f.type}]: ${f.why}\n      would have prevented it: ${f.question.text} options: ${f.question.options.join(" | ")} (expected: ${f.question.expected})`);
    }
  }
  return L.join("\n") + "\n";
}

// CLI: evaluate the corpus with the baseline (or --variant) and print the triage.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { runCorpus } = await import("./run.mjs");
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const { records } = await runCorpus({ variant: opt("--variant", "baseline"), determinism: false });
  const t = triage(records, { top: Number(opt("--top", 3)) });
  process.stdout.write(a.includes("--json") ? JSON.stringify(t, null, 2) + "\n" : renderTriage(t, { top: Number(opt("--top", 3)) }));
}
