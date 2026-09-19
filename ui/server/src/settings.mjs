// In-memory settings for the UI server: which LLM provider each distinct
// LLM-touching capability should use, and which Construct project
// directory every command targets. Deliberately not persisted to disk —
// this is a local dev tool; restarting the server resets to its defaults.
//
// Per-capability, not one global provider (#100/Epic 6.4): the framework
// has (at least) two distinct classes of LLM call — small, scoped
// "execution" fills (`import`'s per-file fill = importFill; `create`/
// `generate`'s optional fill, #101 = createFill) vs. the single
// whole-feature "plan analysis" call in `construct import --route`
// (planAnalysis). #96's design explicitly allows execution-class calls to
// route to a local model (Ollama) while planAnalysis must always stay on a
// real hosted model — never Ollama, not even as a user choice. Every value
// is validated against the *real* `PROVIDERS` map in src/llm.mjs (not a
// UI-side copy), so the settings screen's dropdowns can never drift from
// what the core CLI actually supports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROVIDERS } from '../../../src/llm.mjs';

// The one hard guardrail from #96: planAnalysis is the whole-feature deep-
// analysis call and must never be delegated to a local model, no matter
// what a user requests via the API — enforced here, not just left to the
// UI dropdown omitting the option.
const PLAN_ANALYSIS_FORBIDDEN_PROVIDERS = new Set(['ollama']);

const CAPABILITIES = ['importFill', 'createFill', 'planAnalysis'];

const defaultProvider = Object.keys(PROVIDERS)[0] || null;

const state = {
  // Defaults to wherever the server process was started from. The settings
  // screen lets a user point this at any Construct project (or a
  // not-yet-`construct init`'ed directory) without restarting the server.
  projectDir: process.cwd(),
  // #223 directory picker allowlist. null = use the default (home dir + the
  // current project dir's parent, computed live so it follows projectDir).
  browseRoots: null,
  llmProviders: {
    importFill: defaultProvider,
    createFill: defaultProvider,
    planAnalysis: defaultProvider,
  },
};

function availableProvidersFor(capability) {
  const all = Object.keys(PROVIDERS);
  return capability === 'planAnalysis'
    ? all.filter((p) => !PLAN_ANALYSIS_FORBIDDEN_PROVIDERS.has(p))
    : all;
}

/** Roots the directory picker may browse (#223): explicit setting, else the
 * user's home dir plus the current project's parent directory. */
export function getBrowseRoots() {
  if (state.browseRoots) return [...state.browseRoots];
  return [os.homedir(), path.dirname(state.projectDir)];
}

export function getSettings() {
  return {
    projectDir: state.projectDir,
    browseRoots: getBrowseRoots(),
    llmProviders: { ...state.llmProviders },
    // Kept for exact backward compatibility with any existing reader of
    // the old single-provider shape (e.g. project-gate's status display) —
    // mirrors importFill, the closest analog to "the" provider a user
    // would expect this to mean.
    llmProvider: state.llmProviders.importFill,
    availableProviders: Object.keys(PROVIDERS),
    availableProvidersByCapability: Object.fromEntries(CAPABILITIES.map((c) => [c, availableProvidersFor(c)])),
  };
}

/** Validate and apply one capability's provider value. Throws (does not
 * silently ignore) on an unknown provider, or on `planAnalysis` given a
 * provider in PLAN_ANALYSIS_FORBIDDEN_PROVIDERS — this is the actual
 * enforcement point for #96's "planAnalysis never routes to a local model"
 * guardrail, not just a UI-side omission. */
function applyCapabilityProvider(capability, value) {
  if (value === undefined || value === null || value === '') return;
  if (!PROVIDERS[value]) {
    throw new Error(`Unknown LLM provider "${value}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  if (capability === 'planAnalysis' && PLAN_ANALYSIS_FORBIDDEN_PROVIDERS.has(value)) {
    throw new Error(
      `"${value}" cannot be used for planAnalysis — the whole-feature plan-analysis call is deliberately Claude/hosted-model-only (see epic #96) and never delegated to a local model, even by explicit request.`,
    );
  }
  state.llmProviders[capability] = value;
}

export function updateSettings({ projectDir, llmProviders, llmProvider, browseRoots } = {}) {
  if (browseRoots !== undefined && browseRoots !== null) {
    // [] or null resets to the default; otherwise every entry must be an existing directory.
    if (!Array.isArray(browseRoots) || browseRoots.some((r) => typeof r !== 'string' || !r || r.includes('\0'))) {
      throw new Error('browseRoots must be an array of directory paths.');
    }
    const resolved = browseRoots.map((r) => path.resolve(r));
    for (const r of resolved) {
      if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw new Error(`Not a directory: ${r}`);
    }
    state.browseRoots = resolved.length ? resolved : null;
  }
  if (llmProviders !== undefined && llmProviders !== null) {
    for (const capability of CAPABILITIES) {
      applyCapabilityProvider(capability, llmProviders[capability]);
    }
  }
  // Backward-compatible single-field input: treated as setting importFill
  // only (the old field's closest analog), never planAnalysis/createFill —
  // an old client posting the legacy shape must not silently widen its own
  // scope to capabilities it never knew existed.
  if (llmProvider !== undefined && llmProvider !== null && llmProvider !== '') {
    applyCapabilityProvider('importFill', llmProvider);
  }
  if (projectDir !== undefined && projectDir !== null && projectDir !== '') {
    const resolved = path.resolve(projectDir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }
    state.projectDir = resolved;
  }
  return getSettings();
}
