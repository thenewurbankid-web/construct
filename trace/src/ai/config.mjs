// Which model does which task. Each task is configurable on its own, so the cheap local model can pick
// options while Claude (or a bigger model) drafts code, or the other way round.
//   choose        pick one option of a question
//   pick-fields   pick several fields
//   draft-body    write one JavaScript expression for a placeholder (checked against the design examples)
//   explain       put an open item in plain words for the run summary (checked against the facts it was given)
//   mail          rewrite a team email on request in the composer chat (streamed; every draft is fact-checked and never applied by itself)
//   part-chat     the Part inspector's chat, which only knows one part's facts (streamed; the reply is fact-checked, it can propose but never apply)
//   generate-sample  T12.1: one plausible sample value for a contract field with no example (checked against its
//                    declared type when known); shown only in the Contract card, never saved to the contract or
//                    matched against — it only proposes, so (per the Qwen policy) needs no accuracy measurement
// Order of precedence: built-in defaults < ai.config.json (project root) < <example>/ai.json < the run's overrides.
// Security: provider, baseUrl and API keys come ONLY from the server's own files (and the CLI's own arguments, which
// pass `trusted: true`). Overrides that arrive over HTTP are untrusted: only a task's `model` name survives (and,
// for a paid provider, only a model the server config already names or lists under "allowedModels").
// ai.config.json may also hold  "allowedModels": { "anthropic": ["claude-..."] }  and  "keyHosts": ["llm.example.com"]
// (extra hosts an OpenAI-compatible API key may be sent to; loopback hosts are always allowed).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASKS = ["choose", "pick-fields", "draft-body", "explain", "mail", "part-chat", "generate-sample"];
export const DEFAULT = { provider: "ollama", model: "qwen2.5-coder:1.5b" };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
const own = (o, k) => o != null && typeof o === "object" && Object.hasOwn(o, k);

export const MODEL_NAME = /^[A-Za-z0-9][\w.:\/@+-]{0,99}$/;
export const isLoopbackHost = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(h);

// http(s) only, no credentials in the URL. Returns the URL string or undefined (dropped, never thrown).
export function safeBaseUrl(u) {
  if (typeof u !== "string") return undefined;
  try {
    const x = new URL(u.trim());
    return (x.protocol === "http:" || x.protocol === "https:") && !x.username && !x.password ? u.trim().replace(/\/+$/, "") : undefined;
  } catch { return undefined; }
}

// A model name a client may pick freely: local providers cost nothing to misuse. A paid provider (anthropic, or an
// OpenAI-compatible server that is not on this machine) only accepts models the server config already names.
function freeform(provider, baseUrl) {
  if (provider === "anthropic") return false;
  if (provider !== "openai") return true;
  try { return isLoopbackHost(new URL(baseUrl || "http://localhost:1234").hostname); } catch { return false; }
}

// Server-owned layers may set provider/model/baseUrl; a bad baseUrl is dropped.
function clean(l) {
  const out = {};
  for (const k of ["provider", "model"]) if (typeof l?.[k] === "string" && l[k]) out[k] = l[k];
  const b = safeBaseUrl(l?.baseUrl);
  if (b) out.baseUrl = b;
  if (typeof l?.fn === "function") out.fn = l.fn; // the fake provider, for tests (trusted callers only)
  return out;
}

export function loadAiConfig({ dir, overrides = {}, trusted = false } = {}) {
  const file = readJson(path.join(root, "ai.config.json"));
  const layers = [file, dir ? readJson(path.join(dir, "ai.json")) : {}];
  if (trusted) layers.push(overrides);
  const cfg = { default: { ...DEFAULT }, tasks: {}, allowedModels: {}, keyHosts: [] };
  for (const l of layers) {
    Object.assign(cfg.default, clean(l?.default));
    const tasks = l?.tasks ?? {};
    for (const t of Object.keys(tasks)) {
      if (!TASKS.includes(t) || !own(tasks, t)) continue;
      cfg.tasks[t] = { ...(cfg.tasks[t] ?? {}), ...clean(tasks[t]) };
    }
  }
  for (const [p, list] of Object.entries(file.allowedModels ?? {})) if (own(file.allowedModels, p) && Array.isArray(list)) cfg.allowedModels[p] = list.filter((m) => typeof m === "string");
  if (Array.isArray(file.keyHosts)) cfg.keyHosts = file.keyHosts.filter((h) => typeof h === "string").map((h) => h.toLowerCase());

  if (!trusted) {
    // Untrusted overrides: a model name per task, nothing else.
    const tasks = overrides?.tasks;
    for (const t of TASKS) {
      const m = own(tasks, t) && own(tasks[t], "model") ? tasks[t].model : null;
      if (typeof m !== "string" || !MODEL_NAME.test(m)) continue;
      const c = taskConfig(cfg, t);
      const named = [cfg.default, ...TASKS.map((x) => taskConfig(cfg, x))].filter((x) => x.provider === c.provider).map((x) => x.model);
      const allowed = new Set([...named, ...(cfg.allowedModels[c.provider] ?? [])]);
      if (freeform(c.provider, c.baseUrl) || allowed.has(m)) cfg.tasks[t] = { ...(cfg.tasks[t] ?? {}), model: m };
    }
  }
  return cfg;
}
// keyHosts travels with every task's config so the provider can decide where an API key may go.
export const taskConfig = (cfg, task) => ({ ...cfg.default, ...(cfg.tasks[task] ?? {}), keyHosts: cfg.keyHosts ?? [] });
