// Commit-on-save for the Cockpit (#283) — the trigger half, which is `ui/` (proprietary-future)
// because it is policy and lifecycle, not computation. Everything deterministic it needs (the
// serial, the branch name, the impact counts, the message) comes from core
// `src/engine/commitMessage.mjs`; the git plumbing comes from ./git.mjs. One-way dependency: core
// never imports this.
//
// THE RISK THIS MODULE EXISTS TO MANAGE. Auto-committing writes to the user's git history without
// being asked each time. Done carelessly that is hundreds of noise commits, or a commit containing
// work the user never meant to keep. The three things that stop it are features, not polish:
//
//   1. THE WINDOW. `coalesce` (the default) folds every save inside a 30s window — configurable —
//      into one commit. The window runs from the FIRST pending save and is not extended by later
//      ones, so continuous editing still commits on a bounded schedule instead of never.
//   2. THE OFF SWITCH. Auto-commit is on by default for new projects, and `enabled: false` turns
//      the whole thing off; `manual` keeps the message format but waits for an explicit Commit.
//   3. STAGING BY PATH. A commit stages exactly the files the Cockpit wrote (`git add -- <paths>`,
//      never `git add -A`), so it cannot sweep up unrelated work sitting in the same tree.
//
// THE SESSION. A branch is created on the FIRST SAVE, not on Cockpit open, so browsing leaves no
// empty branches behind, and by then we know what was touched and can name the branch after the
// work. If the tree was already dirty when the session started, the user is ASKED (#283: "Ask each
// time") — carry those changes onto the session branch, or stash them — with the changed files
// grouped by feature and layer so the question is answerable, and the answer remembered per
// project. Carried files are committed but marked pre-existing, so the impact counts never claim
// work the session did not do.
import {
  DEFAULT_COMMIT_CONFIG, COMMIT_MODES, buildCommitMessage, commitImpact, deriveSlug,
  newSessionId, nextSerialFrom, parseSerial, sessionBranchName,
} from '../../../src/engine/commitMessage.mjs';
import { impactFromChangedFiles } from '../../../src/engine/impact.mjs';
import * as git from './git.mjs';

export const DIRTY_ANSWERS = ['carry', 'stash'];
/** Upper bound on the coalescing window: a day-long window is indistinguishable from `manual`
 * and would quietly lose the audit trail the feature exists to produce. */
export const MAX_COALESCE_MS = 10 * 60 * 1000;

export class AutoCommitError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AutoCommitError';
    this.status = status;
  }
}

// Settings are in-memory, exactly like ui/server/src/settings.mjs: this is a local dev tool and a
// restart resets to the defaults. `enabled: true` is the "on by default for new projects" decision.
let config = { ...DEFAULT_COMMIT_CONFIG };
/** root -> session */
const sessions = new Map();
/** root -> 'carry' | 'stash', the remembered answer to the dirty-tree prompt (#283). */
const remembered = new Map();

export function getCommitConfig() {
  return { ...config, modes: [...COMMIT_MODES], maxCoalesceMs: MAX_COALESCE_MS };
}

/** Validate and apply a config patch. Throws (never silently ignores) on a bad value. */
export function updateCommitConfig(patch = {}) {
  const next = { ...config };
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new AutoCommitError('enabled must be a boolean.');
    next.enabled = patch.enabled;
  }
  if (patch.mode !== undefined) {
    if (!COMMIT_MODES.includes(patch.mode)) throw new AutoCommitError(`mode must be one of ${COMMIT_MODES.join(', ')}.`);
    next.mode = patch.mode;
  }
  if (patch.coalesceMs !== undefined) {
    const n = Number(patch.coalesceMs);
    if (!Number.isFinite(n) || n < 0 || n > MAX_COALESCE_MS) throw new AutoCommitError(`coalesceMs must be between 0 and ${MAX_COALESCE_MS}.`);
    next.coalesceMs = Math.round(n);
  }
  for (const key of ['messagePrefix', 'branchPrefix', 'branchSuffix']) {
    if (patch[key] === undefined) continue;
    const v = String(patch[key] ?? '');
    // These end up in a commit subject and a ref name; keep them boring. Empty is allowed on purpose.
    if (v.length > 32 || /[^A-Za-z0-9._-]/.test(v)) throw new AutoCommitError(`${key} may only contain letters, digits, ".", "_" or "-" (max 32 chars).`);
    next[key] = v;
  }
  config = next;
  return getCommitConfig();
}

/** Test seam, and the reset a project switch performs. */
export function resetAutoCommit() {
  for (const s of sessions.values()) if (s.timer) clearTimeout(s.timer);
  sessions.clear();
  remembered.clear();
  config = { ...DEFAULT_COMMIT_CONFIG };
}

/** Forget the session for one project (e.g. the user switched projectDir). Never touches git. */
export function endSession(root) {
  const s = sessions.get(root);
  if (s?.timer) clearTimeout(s.timer);
  sessions.delete(root);
}

// ---- session lifecycle ---------------------------------------------------------------------------

/** A branch this Cockpit already created, recognised by its own commits, so reopening a session
 * continues its serial instead of restarting at 1. */
function adoptExistingSession(root) {
  const branch = git.currentBranch(root);
  const m = branch && branch.match(/-([0-9a-f]{4,16})(?:[A-Za-z0-9._-]*)$/);
  if (!m) return null;
  const candidate = m[1];
  const subjects = git.subjectsOn(root, { limit: 200 });
  return subjects.some((s) => parseSerial(s, { sessionId: candidate }) !== null) ? { sessionId: candidate, branch } : null;
}

function ensureSession(root) {
  let s = sessions.get(root);
  if (s) return s;
  const adopted = adoptExistingSession(root);
  s = {
    root,
    sessionId: adopted?.sessionId || newSessionId(),
    branch: adopted?.branch || null,
    adopted: !!adopted,
    pending: new Map(), // path -> 'add' | 'update' | 'delete'
    preexisting: [],
    dirtyAnswer: remembered.get(root) || null,
    awaitingDecision: null,
    timer: null,
    timerDueAt: null,
    plan: null,
    planTitle: '',
    commits: [],
    startedAt: Date.now(),
  };
  sessions.set(root, s);
  return s;
}

/** Attach the plan/ticket a session is working from (#286), which names the branch and lets the
 * commit body state what was planned versus not. Optional — a session without one still works. */
export function setSessionPlan(root, { plan = null, planTitle = '' } = {}) {
  const s = ensureSession(root);
  s.plan = plan;
  s.planTitle = String(planTitle || '');
  return getSessionStatus(root);
}

/** Changed files grouped by feature and layer — the detail that makes the dirty-tree prompt worth
 * reading. Same impact computation the commit messages use (#288), so the two never disagree. */
function describeDirty(root, paths) {
  const impact = commitImpact(impactFromChangedFiles(root, paths));
  const groups = impact.available
    ? impact.features.map((f) => ({ name: f.name, kind: f.kind, layers: f.layers, files: f.files.map((x) => x.path) }))
    : [{ name: 'unclassified', kind: 'directory', layers: [], files: [...paths] }];
  const phrase = groups.map((g) => `${g.files.length} file(s) in ${g.name}${g.layers.length ? ` (${g.layers.join(', ')})` : ''}`).join(', ');
  return {
    count: paths.length,
    files: [...paths],
    groups,
    question: `${phrase || `${paths.length} changed file(s)`} — carry onto this session's branch, or stash?`,
  };
}

// ---- the trigger ------------------------------------------------------------------------------------

const idle = (reason) => ({ committed: false, status: reason });

/**
 * Tell the auto-committer that the Cockpit just wrote a file. This is the single entry point every
 * save route calls; it never throws for a non-git or non-project directory, because a save must
 * succeed whether or not it can be committed.
 *
 * @param {string} root project root
 * @param {string|string[]} relPaths project-relative path(s) just written
 * @param {{kind?: 'add'|'update'|'delete'}} [opts]
 * @returns {object} one of: `{status:'disabled'|'not-a-repo'}`, `{status:'manual'|'coalescing', pending}`,
 *   `{status:'needs-decision', dirty}`, or `{committed:true, commit}`.
 */
export function recordSave(root, relPaths, { kind = 'update' } = {}) {
  const paths = (Array.isArray(relPaths) ? relPaths : [relPaths]).filter(Boolean);
  if (!config.enabled) return idle('disabled');
  if (!paths.length) return idle('nothing-pending');
  if (!git.isRepo(root)) return idle('not-a-repo');

  const s = ensureSession(root);
  for (const p of paths) s.pending.set(p, kind);

  // The dirty-tree question belongs at session start, before a branch exists — asked once, then
  // remembered per project if the user says so.
  if (!s.branch && !s.dirtyAnswer) {
    const dirty = git.status(root).map((e) => e.path).filter((p) => !s.pending.has(p));
    if (dirty.length) {
      s.awaitingDecision = describeDirty(root, dirty);
      return { committed: false, status: 'needs-decision', sessionId: s.sessionId, dirty: s.awaitingDecision, pending: [...s.pending.keys()] };
    }
    s.dirtyAnswer = 'carry'; // nothing to carry; recorded so the question is not re-asked
  }

  return proceed(s);
}

/** Answer the dirty-tree prompt. `remember` stores it for this project until the server restarts. */
export function answerDirtyPrompt(root, { answer, remember = false } = {}) {
  if (!DIRTY_ANSWERS.includes(answer)) throw new AutoCommitError(`answer must be one of ${DIRTY_ANSWERS.join(', ')}.`);
  const s = sessions.get(root);
  if (!s) throw new AutoCommitError('There is no Cockpit session for this project yet.', 409);
  s.dirtyAnswer = answer;
  if (remember) remembered.set(root, answer);
  const dirty = s.awaitingDecision;
  s.awaitingDecision = null;
  if (answer === 'stash' && dirty?.files.length) {
    s.stash = git.stashPaths(root, dirty.files, `construct-cockpit ${s.sessionId}: changes present before this session`);
  }
  return proceed(s);
}

/** Apply the configured granularity to whatever is pending. */
function proceed(s) {
  if (!s.pending.size) return idle('nothing-pending');
  if (config.mode === 'manual') return { committed: false, status: 'manual', pending: [...s.pending.keys()] };
  if (config.mode === 'every-save') return commitPending(s);
  // coalesce: one window from the first pending save; later saves join it rather than pushing it
  // out, so a long editing burst still commits on a bounded schedule.
  if (!s.timer) {
    s.timerDueAt = Date.now() + config.coalesceMs;
    s.timer = setTimeout(() => {
      s.timer = null;
      s.timerDueAt = null;
      try { commitPending(s); } catch { /* a background commit must never crash the server */ }
    }, config.coalesceMs);
    if (typeof s.timer.unref === 'function') s.timer.unref();
  }
  return { committed: false, status: 'coalescing', pending: [...s.pending.keys()], dueInMs: Math.max(0, (s.timerDueAt || 0) - Date.now()) };
}

/** Commit now: the Commit button in `manual`, and the "don't wait for the window" action. */
export function flushSession(root) {
  const s = sessions.get(root);
  if (!s) return idle('nothing-pending');
  if (s.awaitingDecision) return { committed: false, status: 'needs-decision', sessionId: s.sessionId, dirty: s.awaitingDecision, pending: [...s.pending.keys()] };
  if (!s.pending.size) return idle('nothing-pending');
  return commitPending(s);
}

function commitPending(s) {
  const { root } = s;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; s.timerDueAt = null; }
  const changedFiles = [...s.pending.keys()];
  const changes = Object.fromEntries(s.pending);

  // Carried-in files: dirty before the session started, committed alongside, never counted.
  if (!s.branch && s.dirtyAnswer === 'carry') {
    s.preexisting = git.status(root).map((e) => e.path).filter((p) => !s.pending.has(p));
  }

  // The serial is read from the branch the commit will land on. A branch created from HEAD shares
  // HEAD's history, so reading before or after creating it gives the same answer — and a reopened
  // session branch continues its own numbering for free.
  const serial = nextSerialFrom(git.subjectsOn(root), { sessionId: s.sessionId });
  const built = buildCommitMessage(root, {
    changedFiles,
    preexisting: s.preexisting,
    changes,
    sessionId: s.sessionId,
    serial,
    prefix: config.messagePrefix,
    plan: s.plan,
    planTitle: s.planTitle,
  });
  if (!built.ok) throw new AutoCommitError(`Could not build a commit message: ${built.error.message}`, 500);

  if (!s.branch) {
    const { slug } = deriveSlug({ planTitle: s.planTitle, plan: s.plan, impact: built.impact, changedFiles });
    let name = sessionBranchName({ prefix: config.branchPrefix, slug, sessionId: s.sessionId, suffix: config.branchSuffix });
    // The session id is what guarantees uniqueness, but a re-run with the same id (tests, a restored
    // session) should not hard-fail — fall back to a fresh id rather than refusing to commit.
    if (git.branchExists(root, name)) {
      s.sessionId = newSessionId();
      name = sessionBranchName({ prefix: config.branchPrefix, slug, sessionId: s.sessionId, suffix: config.branchSuffix });
    }
    s.branch = git.createBranch(root, name);
  }

  git.stage(root, [...changedFiles, ...s.preexisting]);
  if (!git.hasStagedChanges(root)) {
    s.pending.clear();
    return idle('nothing-to-commit');
  }
  const { sha, subject } = git.commit(root, built.message);
  s.pending.clear();
  s.preexisting = [];

  const record = {
    sha,
    subject,
    label: built.label,
    serial,
    branch: s.branch,
    sessionId: s.sessionId,
    files: changedFiles,
    impact: {
      features: built.impact.featureCount,
      layers: built.impact.layerCount,
      files: built.impact.fileCount,
      perFeature: built.impact.available ? built.impact.features.map((f) => ({ name: f.name, layers: f.layers })) : [],
    },
    message: built.message,
    at: new Date().toISOString(),
  };
  s.commits.unshift(record);
  s.commits.length = Math.min(s.commits.length, 20);
  return { committed: true, status: 'committed', commit: record };
}

// ---- status -----------------------------------------------------------------------------------------

/** Everything the Cockpit needs to render the auto-commit indicator and the dirty-tree prompt. */
export function getSessionStatus(root) {
  const repo = git.isRepo(root);
  const s = sessions.get(root);
  return {
    ok: true,
    config: getCommitConfig(),
    repo,
    branch: repo ? git.currentBranch(root) : null,
    remembered: remembered.get(root) || null,
    session: s
      ? {
        sessionId: s.sessionId,
        branch: s.branch,
        adopted: s.adopted,
        pending: [...s.pending.keys()],
        dueInMs: s.timerDueAt ? Math.max(0, s.timerDueAt - Date.now()) : null,
        awaitingDecision: s.awaitingDecision,
        dirtyAnswer: s.dirtyAnswer,
        stash: s.stash || null,
        commits: s.commits,
        lastCommit: s.commits[0] || null,
      }
      : null,
  };
}
