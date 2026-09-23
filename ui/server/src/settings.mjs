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
import { PROVIDERS } from '../../../packages/core/llm.mjs';
import { resolveStateDir } from '../../../packages/engine/processStore.mjs';
import { containInWorkspace, containOrNull, currentLogin, normalizeLogin, relativeToWorkspace, WorkspaceError, workspaceRoot } from './workspace.mjs';

// The one hard guardrail from #96: planAnalysis is the whole-feature deep-
// analysis call and must never be delegated to a local model, no matter
// what a user requests via the API — enforced here, not just left to the
// UI dropdown omitting the option.
const PLAN_ANALYSIS_FORBIDDEN_PROVIDERS = new Set(['ollama']);

const CAPABILITIES = ['importFill', 'createFill', 'planAnalysis'];

const defaultProvider = Object.keys(PROVIDERS)[0] || null;

// #569 slice 1: the open project and the remembered project are per signed-in login (key = lowercased login, or ''
// with no session / auth off). Slice 2: the dev server slot is per login too (devServer.mjs). STILL SHARED, to be keyed in
// later #569 slices: the LLM provider choices below, the engine/command queue, processes and review workers.
const shared = {
  // #365 harness-only: the project named by CONSTRUCT_E2E_PROJECT_DIR (loopback only). When the open project
  // vanishes mid-run (a spec removed its temp fixture while it was the current project), the server falls back
  // to this one instead of leaving every later spec at "Open a project". Never set outside the e2e harness. It is
  // offered to a login only when it lies inside that login's own directory (containOrNull).
  preloadedProject: null,
  llmProviders: {
    importFill: defaultProvider,
    createFill: defaultProvider,
    planAnalysis: defaultProvider,
  },
};

/** login key -> { projectDir, lastProject }. */
const userStates = new Map();

/** The state of the current request's login, created on first use. #365: NO project at start; the Cockpit never
 * opens the directory it was launched from. Read the project through `getProjectDir()`, which re-verifies containment. */
function userState() {
  const key = currentLogin();
  let entry = userStates.get(key);
  if (entry === undefined) {
    entry = {
      projectDir: shared.preloadedProject === null ? null : containOrNull(workspaceRoot(), shared.preloadedProject, { mustBeDir: true }),
      // The project that was open last, offered as "Reopen <name>" and NEVER loaded automatically.
      lastProject: undefined, // undefined = not read from disk yet
    };
    userStates.set(key, entry);
  }
  return entry;
}

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
  const real = containInWorkspace(dir, { mustBeDir: true });
  userState().projectDir = real;
  shared.preloadedProject = real;
}

const LAST_PROJECT_FILE = 'last-project.json';

/** The state file for `login` ('' = no session keeps the original `last-project.json`). The login is validated as one
 * safe path segment (normalizeLogin) before it can name a file, so it can never select another path. */
export function lastProjectFilePath(login) {
  return path.join(resolveStateDir(), login === '' ? LAST_PROJECT_FILE : `last-project.${normalizeLogin(login)}.json`);
}

const lastProjectFile = () => lastProjectFilePath(currentLogin());

/** The remembered project, re-contained on every read so a stale or tampered file can never point outside the workspace. */
function readLastProject() {
  const user = userState();
  if (user.lastProject === undefined) {
    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(lastProjectFile(), 'utf8')).projectDir;
    } catch {
      /* none saved */
    }
    user.lastProject = typeof stored === 'string' ? stored : null;
  }
  if (!user.lastProject) return null;
  const real = containOrNull(workspaceRoot(), user.lastProject, { mustBeDir: true });
  return real && real !== user.projectDir ? real : null;
}

function rememberProject(dir) {
  userState().lastProject = dir;
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
  const user = userState();
  if (user.projectDir === null) return null;
  const real = containOrNull(workspaceRoot(), user.projectDir, { mustBeDir: true });
  if (real === null) {
    const preloaded = shared.preloadedProject;
    // Harness fallback (see `preloadedProject`): still re-contained, so a removed or replaced preload is refused too.
    const fallback = preloaded === null ? null : containOrNull(workspaceRoot(), preloaded, { mustBeDir: true });
    user.projectDir = fallback;
    return fallback;
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
    llmProviders: { ...shared.llmProviders },
    // Kept for exact backward compatibility with any existing reader of
    // the old single-provider shape (e.g. project-gate's status display) —
    // mirrors importFill, the closest analog to "the" provider a user
    // would expect this to mean.
    llmProvider: shared.llmProviders.importFill,
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
  shared.llmProviders[capability] = value;
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
    userState().projectDir = nextProject;
    rememberProject(nextProject);
  } else if (closeProject === true) {
    if (userState().projectDir !== null) rememberProject(userState().projectDir);
    userState().projectDir = null;
  }
  return getSettings();
}
