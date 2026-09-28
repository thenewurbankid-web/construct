// AI runs (`npm run eval -- --ai`): feed every question Trace would ask to the AI layer (src/ai) with the task
// models from ai.config.json, and score its answers against ground truth. Not part of the deterministic core:
// results depend on the model, so they are reported under `ai` and never enter the report hash or the gate.
//   accepted   the AI layer answered (it cited a checked fact); the rest are abstentions
//   correct    the accepted option is the ground-truth answer
//   confidence only when the provider reports one (open-jev does); otherwise ECE is n/a and the
//              coverage-accuracy curve is a single point
import path from "node:path";
import fs from "node:fs";
import { extract } from "../src/extract.mjs";
import { createAi } from "../src/ai/index.mjs";
import { loadAiConfig, taskConfig } from "../src/ai/config.mjs";
import { describeParts, canonOption } from "./truth.mjs";
import { writeInputs } from "./adapter.mjs";
import { aiMetrics } from "./metrics.mjs";

// Is the configured model reachable? Never throws.
export async function modelReachable(cfg) {
  try {
    if (cfg.provider === "ollama") {
      const r = await fetch(`${cfg.baseUrl || "http://localhost:11434"}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return `ollama answered ${r.status}`;
      const names = (await r.json()).models?.map((m) => m.name) ?? [];
      return names.includes(cfg.model) || names.some((n) => n.startsWith(cfg.model)) ? null : `model ${cfg.model} is not pulled (have: ${names.join(", ") || "none"})`;
    }
    if (cfg.provider === "anthropic") return process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY is not set";
    if (cfg.provider === "openai") { const r = await fetch(`${cfg.baseUrl || "http://localhost:1234"}/v1/models`, { signal: AbortSignal.timeout(2500) }); return r.ok ? null : `server answered ${r.status}`; }
    if (cfg.provider === "jev") { const r = await fetch(`${cfg.baseUrl || "http://127.0.0.1:8765"}/`, { signal: AbortSignal.timeout(2500) }); return r ? null : "no answer"; }
    return `unknown provider ${cfg.provider}`;
  } catch (e) {
    return `unreachable: ${e.message}`;
  }
}

export const confidenceOf = (entry) => {
  const m = /epistemic confidence ([0-9.]+)/.exec(entry?.thinking ?? "");
  return m ? Number(m[1]) : null;
};

// loaded: cases from adapter.loadCase. provider: only for tests (a fake model function). limit: max questions.
export async function runAi({ loaded, variant, workRoot, provider = null, limit = Infinity, onProgress = () => {} }) {
  const cfg = loadAiConfig({});
  const choose = taskConfig(cfg, "choose");
  if (!provider) {
    const why = await modelReachable(choose);
    if (why) return { status: `skipped: ${why}`, model: `${choose.provider}:${choose.model}` };
  }
  const records = [];
  let asked = 0;
  for (const l of loaded) {
    if (!l.truth || asked >= limit) continue;
    const dir = path.join(workRoot, `ai-${l.id}`);
    fs.rmSync(dir, { recursive: true, force: true });
    writeInputs(l, dir);
    const { matched, questions } = variant.analyze(extract(l.pageSource), l.spec);
    const parts = describeParts(matched, questions);
    const entries = [];
    const ai = createAi({ dir, spec: l.spec, source: l.pageSource, matched, useCache: false, provider, onLog: (e) => e.kind === "call" && entries.push(e) });
    for (const p of parts) {
      const t = l.truth[p.id];
      const q = questions.find((x) => x.id === p.qid && !x.sub);
      if (!t || t.uncertain || !q || p.cls === "action" || asked >= limit) continue;
      asked++;
      const before = { tok: ai.stats.tokensIn + ai.stats.tokensOut, ms: ai.stats.msTotal, n: entries.length };
      const pick = await ai.answer(q);
      const call = entries.length > before.n ? entries[entries.length - 1] : null;
      const ok = new Set([t.want, ...(t.also ?? [])]);
      records.push({
        id: `${l.id}:${p.id}`, accepted: pick != null, correct: pick != null && ok.has(canonOption(pick)),
        confidence: confidenceOf(call), tokens: ai.stats.tokensIn + ai.stats.tokensOut - before.tok, ms: ai.stats.msTotal - before.ms,
      });
      onProgress(records.length);
    }
  }
  const m = aiMetrics(records);
  return { status: "ran", model: `${choose.provider}:${choose.model}`, tasks: Object.fromEntries(["choose", "pick-fields", "draft-body"].map((t) => [t, `${taskConfig(cfg, t).provider}:${taskConfig(cfg, t).model}`])), ...m, calibration_available: records.some((r) => r.confidence != null), chance_level_note: "compare accuracy_of_accepted with the share of questions whose default option is right" };
}
