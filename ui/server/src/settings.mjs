// Settings for the UI server: which LLM provider each distinct LLM-touching
// capability should use, and which Construct project directory every
// command targets. The provider choice is persisted at
// `<stateDir>/settings.json` (#418) so it survives a server restart; the
// project directory is intentionally NOT auto-reopened (#365 decision) —
// only offered back as "Reopen <name>" from `last-project.json`.
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
import { resolveStateDir, atomicWriteJson } from '../../../packages/engine/processStore.mjs';
import { containInWorkspace, containOrNull, currentLogin, normalizeLogin, relativeToWorkspace, WorkspaceError, workspaceRoot } from './workspace.mjs';
// #471: the per-block model already validates a plain Ollama model name this same way (#407) --
// reused here rather than a second copy, so the two screens can never silently accept different things.
import { MAX_MODEL_CHARS, MODEL_RE } from './blockSettingsStore.mjs';

// The one hard guardrail from #96: planAnalysis is the whole-feature deep-
// analysis call and must never be delegated to a local model, no matter
// what a user requests via the API — enforced here, not just left to the
// UI dropdown omitting the option.
const PLAN_ANALYSIS_FORBIDDEN_PROVIDERS = new Set(['ollama']);

const CAPABILITIES = ['importFill', 'createFill', 'planAnalysis'];

const defaultProvider = Object.keys(PROVIDERS)[0] || null;

// #569 slice 1: the open project and the remembered project are per signed-in login (key = lowercased login, or ''
// with no session / auth off). Slice 2: the dev server slot is per login too (devServer.mjs). Slice 3: the LLM provider
// choices are per login (userState().llmProviders), and since #418 persisted per login too
// (`settings.json` / `settings.<login>.json`, mirroring `last-project.json`'s own naming) — a login with no file yet
// starts from the defaults exactly as the old shared in-memory object did.
// Slice 4: the command queue is per login with a global concurrency cap (commandRunner.mjs), and a command's exit
// code is captured per command (diagnostics.mjs withExitCodeSink), never read from the shared `process.exitCode`.
// Slice 5: the Logs ring buffer is per login (logBuffer.mjs serverLog, a registry of rings; context-less lines
// land in '' and are visible to no signed-in user).
// STILL SHARED, to be keyed in later #569 slices: review workers (reviewJobs.mjs, reviewAnalyses.mjs), clone jobs
// (cloneJobs.mjs) and page-change tracking (pageChanges.mjs).
const shared = {
  // #365 harness-only: the project named by CONSTRUCT_E2E_PROJECT_DIR (loopback only). When the open project
  // vanishes mid-run (a spec removed its temp fixture while it was the current project), the server falls back
  // to this one instead of leaving every later spec at "Open a project". Never set outside the e2e harness. It is
  // offered to a login only when it lies inside that login's own directory (containOrNull).
  preloadedProject: null,
};

const defaultLlmProviders = () => ({ importFill: defaultProvider, createFill: defaultProvider, planAnalysis: defaultProvider });

// #471: no default model per capability -- null means "the provider's own built-in default"
// (DEFAULT_OLLAMA_MODEL for ollama; the other providers ignore this entirely), exactly the
// behaviour before this setting existed, until a person picks an installed model explicitly.
const defaultLlmModels = () => ({ importFill: null, createFill: null, planAnalysis: null });

/** login key -> { projectDir, lastProject, llmProviders, llmModels, fellBackFrom }. */
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
      llmProviders: undefined, // undefined = not read from disk yet (see userLlmProviders)
      llmModels: undefined, // undefined = not read from disk yet (see userLlmModels)
      // #420: set to the path getProjectDir() last silently substituted AWAY from (a spec removed its own open
      // project and the harness fallback below took over), so /api/settings can expose it and a spec can assert
      // the fallback did NOT fire by accident. Cleared by any explicit project change (updateSettings).
      fellBackFrom: null,
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

const SETTINGS_FILE = 'settings.json';

/** The settings file for `login` ('' = no session keeps the shared `settings.json`), mirroring
 * `lastProjectFilePath`'s per-login naming and the same safe-segment validation (#418). */
export function settingsFilePath(login) {
  return path.join(resolveStateDir(), login === '' ? SETTINGS_FILE : `settings.${normalizeLogin(login)}.json`);
}

const settingsFile = () => settingsFilePath(currentLogin());

/** Keep only capability/value pairs that are still valid against the REAL `PROVIDERS` map (not a
 * cached copy), so a settings.json written by an older build that allowed a provider since removed
 * — or hand-edited — can never resurrect it. Also re-enforces the #96 planAnalysis guardrail, in
 * case a file predates it. Invalid or missing entries are left out and the default fills them in. */
function validatedLlmProviders(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const capability of CAPABILITIES) {
    const value = raw[capability];
    if (typeof value !== 'string' || !PROVIDERS[value]) continue;
    if (capability === 'planAnalysis' && PLAN_ANALYSIS_FORBIDDEN_PROVIDERS.has(value)) continue;
    out[capability] = value;
  }
  return out;
}

/** The per-capability provider choice, persisted at `<stateDir>/settings.json` (#418) so it survives
 * a server restart; read once per login and cached like `readLastProject`. */
function userLlmProviders() {
  const user = userState();
  if (user.llmProviders === undefined) {
    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).llmProviders;
    } catch {
      /* none saved, or unreadable/corrupt — start from defaults */
    }
    user.llmProviders = { ...defaultLlmProviders(), ...validatedLlmProviders(stored) };
  }
  return user.llmProviders;
}

/** Keep only capability/value pairs that are a plain model name (or `null`, "use the provider's
 * default") — same shape and regex the per-block `model` field already validates (#407), so a
 * settings.json hand-edited or written by an older build can never resurrect something invalid. */
function validatedLlmModels(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const capability of CAPABILITIES) {
    const value = raw[capability];
    if (value === null) {
      out[capability] = null;
    } else if (typeof value === 'string' && value && value.length <= MAX_MODEL_CHARS && MODEL_RE.test(value)) {
      out[capability] = value;
    }
  }
  return out;
}

/** #471: the per-capability model choice, alongside `userLlmProviders` — same `settings.json` file,
 * same per-login caching, `null` meaning "the provider's own default" (only `ollama` reads this at
 * all; DEFAULT_OLLAMA_MODEL otherwise). */
function userLlmModels() {
  const user = userState();
  if (user.llmModels === undefined) {
    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).llmModels;
    } catch {
      /* none saved, or unreadable/corrupt — start from defaults */
    }
    user.llmModels = { ...defaultLlmModels(), ...validatedLlmModels(stored) };
  }
  return user.llmModels;
}

/** Same atomic write (temp file + fsync + rename) processStore.mjs uses for process records, so a
 * process killed mid-save leaves either the old settings.json or the new one, never a half-written
 * file the server then refuses to parse on its next start. Writes providers and models TOGETHER
 * (#471) — a single-field write would otherwise silently drop whichever field it didn't pass. */
function persistSettings() {
  try {
    atomicWriteJson(settingsFile(), { llmProviders: userLlmProviders(), llmModels: userLlmModels() });
  } catch {
    /* persisting is a convenience; never fail a provider/model switch over it (matches rememberProject) */
  }
}

/** The open project directory, or null. Re-verified against the workspace on EVERY call (realpath), so a
 * directory that was replaced by a symlink out of the workspace, or removed, stops being served at once. */
export function getProjectDir() {
  const user = userState();
  if (user.projectDir === null) return null;
  const real = containOrNull(workspaceRoot(), user.projectDir, { mustBeDir: true });
  if (real === null) {
    const stale = user.projectDir;
    const preloaded = shared.preloadedProject;
    // Harness fallback (see `preloadedProject`): still re-contained, so a removed or replaced preload is refused too.
    const fallback = preloaded === null ? null : containOrNull(workspaceRoot(), preloaded, { mustBeDir: true });
    user.projectDir = fallback;
    // #420: only a real substitution (fallback !== null) counts as "fell back" — a plain close (no preloaded
    // project to fall back to) is not a silent surprise, so it neither logs nor sets fellBackFrom.
    if (fallback !== null) {
      user.fellBackFrom = stale;
      console.warn(`Project fallback: "${stale}" is no longer available; substituted the preloaded default project "${fallback}".`);
    }
    return fallback;
  }
  return real;
}

export function getSettings() {
  const projectDir = getProjectDir(); // may set fellBackFrom as a side effect (read AFTER this call)
  const llmProviders = userLlmProviders();
  const llmModels = userLlmModels();
  const { fellBackFrom } = userState();
  return {
    projectDir,
    // #420: present (the path substituted away from) only when the #365 preload fallback actually just fired for
    // this login's current project; null otherwise, including the ordinary "no project"/"still valid" cases.
    fellBackFrom,
    workspaceRoot: workspaceRoot(),
    // Workspace-relative name of the open project ("" when the project is the workspace itself).
    projectRelative: projectDir === null ? null : relativeToWorkspace(workspaceRoot(), projectDir),
    lastProject: readLastProject(),
    browseRoots: getBrowseRoots(),
    llmProviders: { ...llmProviders },
    // #471: the installed model name each capability should use, or null for the provider's own
    // built-in default (DEFAULT_OLLAMA_MODEL). Meaningful only for a capability whose provider is
    // "ollama" — the Settings screen shows this picker only then, but it round-trips for any provider.
    llmModels: { ...llmModels },
    // Kept for exact backward compatibility with any existing reader of
    // the old single-provider shape (e.g. project-gate's status display) —
    // mirrors importFill, the closest analog to "the" provider a user
    // would expect this to mean.
    llmProvider: llmProviders.importFill,
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
  const llmProviders = userLlmProviders();
  llmProviders[capability] = value;
  persistSettings();
}

/** Validate and apply one capability's model choice. `null`/`''`/`undefined` means "back to the
 * provider's own default" (never an error — unlike a bad provider name, "no model chosen yet" is
 * the ordinary starting state, matching how #407's per-block `model` field treats a cleared value). */
function applyCapabilityModel(capability, value) {
  const llmModels = userLlmModels();
  if (value === undefined) return;
  if (value === null || value === '') {
    llmModels[capability] = null;
    persistSettings();
    return;
  }
  if (typeof value !== 'string' || value.length > MAX_MODEL_CHARS || !MODEL_RE.test(value)) {
    throw new Error(`"${String(value).slice(0, 60)}" is not a valid model name for ${capability} (letters, digits and . _ : / @ -, at most ${MAX_MODEL_CHARS} characters, not starting with a dash).`);
  }
  llmModels[capability] = value;
  persistSettings();
}

/** @throws {WorkspaceError} for a projectDir outside the workspace / missing / not a directory; Error for a bad provider or model. */
export function updateSettings({ projectDir, closeProject, llmProviders, llmProvider, llmModels, browseRoots } = {}) {
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
  if (llmModels !== undefined && llmModels !== null) {
    for (const capability of CAPABILITIES) {
      applyCapabilityModel(capability, llmModels[capability]);
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
    userState().fellBackFrom = null; // #420: an explicit open supersedes any earlier silent substitution
    rememberProject(nextProject);
  } else if (closeProject === true) {
    if (userState().projectDir !== null) rememberProject(userState().projectDir);
    userState().projectDir = null;
    userState().fellBackFrom = null; // #420: closing clears the flag too — nothing is still silently substituted
  }
  return getSettings();
}
