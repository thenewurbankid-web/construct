// In-memory settings for the UI server: which LLM provider each distinct
// LLM-touching capability should use, and which Construct project
// directory every command targets.
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
//
// #365: the project directory is confined to ONE workspace root (workspace.mjs). There is no project at
// start, a chosen directory must be inside the workspace by realpath, and it is re-verified on every read.
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '../../../src/llm.mjs';
import { resolveStateDir } from '../../../src/engine/processStore.mjs';
import { containInWorkspace, containOrNull, relativeToWorkspace, WorkspaceError, workspaceRoot } from './workspace.mjs';

// The one hard guardrail from #96: planAnalysis is the whole-feature deep-
// analysis call and must never be delegated to a local model, no matter
// what a user requests via the API — enforced here, not just left to the
// UI dropdown omitting the option.
const PLAN_ANALYSIS_FORBIDDEN_PROVIDERS = new Set(['ollama']);

const CAPABILITIES = ['importFill', 'createFill', 'planAnalysis'];

const defaultProvider = Object.keys(PROVIDERS)[0] || null;

const state = {
  // #365: NO project at start. The Cockpit never opens the directory it was launched from (on a hosted server
  // that was the Construct repo itself); the user picks one inside the workspace. Read it through
  // `getProjectDir()`, which re-verifies containment on every use.
  projectDir: null,
  // The project that was open last, offered as "Reopen <name>" and NEVER loaded automatically.
  lastProject: undefined, // undefined = not read from disk yet
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

/** The only root the directory picker may browse (#223, #365): the workspace. Not configurable by a client. */
export function getBrowseRoots() {
  return [workspaceRoot()];
}

/** Harness-only preload (#365). An e2e config may name a project to open at start; it goes through the same
 * containment as any client choice, and index.mjs refuses it on a non-loopback host. */
export function preloadProject(dir) {
  state.projectDir = containInWorkspace(dir, { mustBeDir: true });
}

const LAST_PROJECT_FILE = 'last-project.json';

const lastProjectFile = () => path.join(resolveStateDir(), LAST_PROJECT_FILE);

/** The remembered project, re-contained on every read so a stale or tampered file can never point outside the workspace. */
function readLastProject() {
  if (state.lastProject === undefined) {
    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(lastProjectFile(), 'utf8')).projectDir;
    } catch {
      /* none saved */
    }
    state.lastProject = typeof stored === 'string' ? stored : null;
  }
  if (!state.lastProject) return null;
  const real = containOrNull(workspaceRoot(), state.lastProject, { mustBeDir: true });
  return real && real !== state.projectDir ? real : null;
}

function rememberProject(dir) {
  state.lastProject = dir;
  try {
    fs.mkdirSync(resolveStateDir(), { recursive: true });
    fs.writeFileSync(lastProjectFile(), JSON.stringify({ projectDir: dir }));
  } catch {
    /* remembering is a convenience; never fail a project switch over it */
  }
}

/** The open project directory, or null. Re-verified against the workspace on EVERY call (realpath), so a
 * directory that was replaced by a symlink out of the workspace, or removed, stops being served at once. */
export function getProjectDir() {
  if (state.projectDir === null) return null;
  const real = containOrNull(workspaceRoot(), state.projectDir, { mustBeDir: true });
  if (real === null) {
    state.projectDir = null;
    return null;
  }
  return real;
}

export function getSettings() {
  const projectDir = getProjectDir();
  return {
    projectDir,
    workspaceRoot: workspaceRoot(),
    // Workspace-relative name of the open project ("" when the project is the workspace itself).
    projectRelative: projectDir === null ? null : relativeToWorkspace(workspaceRoot(), projectDir),
    lastProject: readLastProject(),
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

/** @throws {WorkspaceError} for a projectDir outside the workspace / missing / not a directory; Error for a bad provider. */
export function updateSettings({ projectDir, closeProject, llmProviders, llmProvider, browseRoots } = {}) {
  if (browseRoots !== undefined && browseRoots !== null) {
    throw new WorkspaceError(400, 'BROWSE_ROOTS_FIXED', 'The folder picker is fixed to the workspace and cannot be reconfigured.');
  }
  // Validate the project first and apply it LAST, so a request with one bad field changes nothing.
  let nextProject;
  if (projectDir !== undefined && projectDir !== null && projectDir !== '') {
    nextProject = containInWorkspace(projectDir, { mustBeDir: true });
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
  if (nextProject !== undefined) {
    state.projectDir = nextProject;
    rememberProject(nextProject);
  } else if (closeProject === true) {
    if (state.projectDir !== null) rememberProject(state.projectDir);
    state.projectDir = null;
  }
  return getSettings();
}
