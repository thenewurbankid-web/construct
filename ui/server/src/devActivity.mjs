// Is an agent or model working on Construct itself on this machine right now? The Cockpit's logo can be set to follow this
// (Settings, or a Trinity link) so the person building the framework sees, at a glance, that something is working.
//
// READ, never told: nothing has to report in and no model is asked. Claude Code appends to a session's transcript as it works, so
// "a transcript for this repository was written within the last minute" is the whole signal. Only file TIMES are read (never a
// transcript's contents), from one fixed directory (`~/.claude/projects`, never a path a client names), skipping symbolic links.
// Sessions of the repository's worktrees count too (their project folder names start with the repository's).
//
// Off unless the server is on a developer's own machine: with login required (a hosted, multi-user Cockpit) it answers
// `available: false`, unless CONSTRUCT_DEV_ACTIVITY=1 says otherwise.
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** How recently a transcript must have been written to count as "working". */
export const ACTIVE_WINDOW_MS = 60_000;
const MAX_FILES = 5000;
const MAX_DEPTH = 4;
const CACHE_MS = 2000;

/** Claude Code names a project's folder after its path with separators and dots turned into dashes. */
export const projectSlug = (dir) => path.resolve(dir).replace(/[\\/.]/g, '-');

/**
 * @param {object} o
 * @param {string} o.repoRoot the framework's own checkout (its slug picks which sessions count)
 * @param {string} [o.projectsDir] where the agent transcripts live (a test seam; default `~/.claude/projects`)
 * @param {number} [o.now] a test seam
 * @param {number} [o.windowMs]
 * @returns {{available: boolean, active: boolean, sessions: number, newestAgeMs: number | null}}
 */
export function readDevActivity({ repoRoot, projectsDir = path.join(os.homedir(), '.claude', 'projects'), now = Date.now(), windowMs = ACTIVE_WINDOW_MS }) {
  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return { available: false, active: false, sessions: 0, newestAgeMs: null };
  }
  const slug = projectSlug(repoRoot);
  let seen = 0;
  let newest = 0;
  let sessions = 0;
  const visit = (dir, depth) => {
    if (depth > MAX_DEPTH || seen >= MAX_FILES) return;
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (seen >= MAX_FILES) return;
      if (item.isSymbolicLink()) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full, depth + 1);
      else if (item.name.endsWith('.jsonl')) {
        seen += 1;
        let m;
        try {
          m = fs.statSync(full).mtimeMs;
        } catch {
          continue;
        }
        if (m > newest) newest = m;
        if (now - m <= windowMs) sessions += 1;
      }
    }
  };
  for (const e of entries) {
    if (e.isDirectory() && !e.isSymbolicLink() && e.name.startsWith(slug)) visit(path.join(projectsDir, e.name), 1);
  }
  return { available: true, active: sessions > 0, sessions, newestAgeMs: newest ? Math.max(0, now - newest) : null };
}

/** The route's handler: answers from a 2 s cache so a few open tabs cost one directory scan, and `available: false` where it is off. */
export function createDevActivity({ repoRoot, enabled, projectsDir, now = Date.now }) {
  let cached = null;
  return () => {
    if (!enabled()) return { ok: true, available: false, active: false };
    const t = now();
    if (!cached || t - cached.at > CACHE_MS) cached = { at: t, value: readDevActivity({ repoRoot, projectsDir, now: t }) };
    const { available, active, sessions, newestAgeMs } = cached.value;
    return { ok: true, available, active, sessions, newestAgeMs };
  };
}

/**
 * The public status API: `GET /api/dev-status` -> `{ ok, available, active }`, and nothing else (no counts, no ages, no paths).
 * Read-only and answerable to anyone, because the docs site's logo reads it from a visitor's browser, so it carries CORS
 * `*` (no credentials, no cookies) and is mounted BEFORE the session gate. It says `available: false` unless the server is on the
 * machine where the framework is built and has been told so (`enabled`). Mutating verbs are not routed at all.
 *
 * @param {object} o
 * @param {() => {ok: boolean, available: boolean, active: boolean}} o.read the handler from `createDevActivity`
 */
export function createDevStatusRouter({ read }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      // Chrome asks before a public page may reach a private-network address; a same-machine tunnel answers it here.
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).set('Allow', 'GET, OPTIONS').json({ ok: false, error: 'GET only.' });
    return next();
  });
  router.get('/', (req, res) => {
    const { available, active } = read();
    res.json({ ok: true, available: available === true, active: active === true });
  });
  return router;
}
