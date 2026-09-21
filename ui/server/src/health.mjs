// #423 -- what `/api/health` reports, and the same facts as startup log lines.
//
// The route is PUBLIC (above the session gate: Playwright's `webServer` probe and any liveness check poll it
// before a session can exist), so this module reports states, never paths and never secrets: whether the
// workspace and the state directory can be written (a real 1-byte write and unlink), how much space is free on
// each (`fs.statfsSync`), which node and git are running, and whether clone is enabled (git >= 2.37.0, see
// src/engine/gitVersion.mjs). `ok: true` stays the first field and means "the server answers"; `degraded: true`
// means one of the checks failed, listed in `warnings`.
//
// Snapshots are cached for a few seconds: a public route must not be a way to make the server write to disk
// on every request.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MIN_FREE_MB = 500;
export const HEALTH_CACHE_MS = 10_000;

/** The low-space threshold in bytes: `CONSTRUCT_HEALTH_MIN_FREE_MB` (default 500). */
export function resolveMinFreeBytes(env = process.env) {
  const raw = Number(env.CONSTRUCT_HEALTH_MIN_FREE_MB);
  const mb = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_FREE_MB;
  return Math.round(mb * 1024 * 1024);
}

/** A real write: create `dir` if missing, write one byte to a private file in it, remove the file. */
export function probeWritable(dir) {
  const file = path.join(dir, `.construct-health-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '1');
    fs.rmSync(file, { force: true });
    return { writable: true };
  } catch (e) {
    try { fs.rmSync(file, { force: true }); } catch { /* never got that far */ }
    return { writable: false, error: e.code || e.message };
  }
}

/** Bytes available to this user on the filesystem holding `dir`, or null when it cannot be told. */
export function freeBytesOf(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** `{writable, error?, freeBytes, low}` for one directory. */
export function checkDir(dir, minFreeBytes) {
  const w = probeWritable(dir);
  const freeBytes = freeBytesOf(dir);
  return { writable: w.writable, ...(w.error ? { error: w.error } : {}), freeBytes, low: freeBytes !== null && freeBytes < minFreeBytes };
}

const mb = (bytes) => Math.round(bytes / 1024 / 1024);

/**
 * @param {{
 *   getWorkspaceRoot: () => string,
 *   getStateDir: () => string,
 *   gitStatus: () => {ok:boolean, version?:string|null, minimum:string, cloneEnabled:boolean, reason?:string},
 *   minFreeBytes?: number, cacheMs?: number, now?: () => number, nodeVersion?: string,
 * }} deps
 */
export function createHealth({ getWorkspaceRoot, getStateDir, gitStatus, minFreeBytes = resolveMinFreeBytes(), cacheMs = HEALTH_CACHE_MS, now = Date.now, nodeVersion = process.version }) {
  let cached = null;

  const safeCheck = (get) => {
    try {
      return checkDir(get(), minFreeBytes);
    } catch (e) {
      return { writable: false, error: e.code || e.message, freeBytes: null, low: false };
    }
  };

  function compute() {
    const warnings = [];
    const workspace = safeCheck(getWorkspaceRoot);
    const stateDir = safeCheck(getStateDir);
    let git;
    try {
      git = gitStatus();
    } catch (e) {
      git = { ok: false, version: null, minimum: null, cloneEnabled: false, reason: e.message };
    }
    if (!git.ok) warnings.push(`git: ${git.reason || 'not available'}`);
    else if (!git.cloneEnabled) warnings.push(`git: ${git.reason || 'clone disabled'}`);
    if (!workspace.writable) warnings.push(`workspace: not writable (${workspace.error || 'unknown'})`);
    if (workspace.low) warnings.push(`workspace: only ${mb(workspace.freeBytes)} MB free (threshold ${mb(minFreeBytes)} MB)`);
    if (!stateDir.writable) warnings.push(`state directory: not writable (${stateDir.error || 'unknown'})`);
    if (stateDir.low) warnings.push(`state directory: only ${mb(stateDir.freeBytes)} MB free (threshold ${mb(minFreeBytes)} MB)`);
    return {
      ok: true,
      degraded: warnings.length > 0,
      node: nodeVersion,
      git,
      workspace,
      stateDir,
      thresholds: { minFreeBytes },
      warnings,
      checkedAt: new Date(now()).toISOString(),
    };
  }

  return {
    /** The health document; cached for `cacheMs` unless `fresh` is asked for. */
    snapshot({ fresh = false } = {}) {
      if (!fresh && cached && now() - cached.at < cacheMs) return cached.value;
      const value = compute();
      cached = { at: now(), value };
      return value;
    },
    /** The same facts as `{level, text}` lines for the server's startup log (these MAY name paths: the log is local). */
    describeStartup() {
      const h = this.snapshot({ fresh: true });
      const lines = [];
      lines.push({ level: 'log', text: `Preflight: node ${h.node}; git ${h.git.ok ? h.git.version : 'MISSING'} (clone ${h.git.cloneEnabled ? 'enabled' : 'DISABLED'}${h.git.reason ? `: ${h.git.reason}` : ''}).` });
      lines.push({ level: h.workspace.writable && !h.workspace.low ? 'log' : 'warn', text: `Preflight: workspace ${h.workspace.writable ? 'writable' : `NOT writable (${h.workspace.error})`}, ${h.workspace.freeBytes === null ? 'free space unknown' : `${mb(h.workspace.freeBytes)} MB free`}.` });
      lines.push({ level: h.stateDir.writable && !h.stateDir.low ? 'log' : 'warn', text: `Preflight: state directory ${h.stateDir.writable ? 'writable' : `NOT writable (${h.stateDir.error})`}, ${h.stateDir.freeBytes === null ? 'free space unknown' : `${mb(h.stateDir.freeBytes)} MB free`}.` });
      for (const w of h.warnings) lines.push({ level: 'warn', text: `Preflight: ${w}` });
      return lines;
    },
  };
}
