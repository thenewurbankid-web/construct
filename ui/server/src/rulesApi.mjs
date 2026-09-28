// #549 -- thin REST adapter over packages/core/rules-catalog.mjs: every rule `construct validate`
// can report, with severity resolved against the open project's `architecture.yml` (falls back to
// the built-in default with no override). Feeds #395's Cockpit Rules screen (per-project severity
// toggle composer) and the generated rules doc.
//
// #395 slice B -- the one write path this screen has: change a single rule's severity. Same
// preview/commit/contentHash shape componentsApi.mjs's componentSave uses (nothing written until
// `commit: true`, refused with 409 if architecture.yml changed on disk since it was loaded), and
// the same "never write an invalid file" gate #761 built (validateArchitectureConfig) instead of
// architecture-enforcer's per-source-file checks, which don't apply to architecture.yml itself.
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { listRules } from '../../../packages/core/rules-catalog.mjs';
import { DEFAULT_RULES, loadConfig } from '../../../packages/core/config.mjs';
import { validateArchitectureConfig } from '../../../packages/core/validate-architecture-config.mjs';

/** @returns {{status:number, body:object}} */
export const rulesIndex = (root) => {
  const config = loadConfig(root);
  return { status: 200, body: { ok: true, rules: listRules(root), exceptions: readExceptions(root), nonLayer: config.nonLayer, frozen: config.frozen } };
};

const VALID_SEVERITIES = new Set(['error', 'warning', 'off']);
const err = (status, code, error, extra) => ({ status, body: { ok: false, code, error, ...extra } });
const archPath = (root) => path.join(root, 'architecture.yml');
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

function readRaw(root) {
  const file = archPath(root);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Every exception in the project's architecture.yml, in display form: its own list index (the
 * only stable handle a client has to remove one -- exceptions carry no id of their own), whether
 * it has expired, and `expires` normalized to a plain ISO-date string (js-yaml parses an unquoted
 * date scalar into a real `Date`, which JSON.stringify would otherwise turn into a full timestamp). */
function readExceptions(root) {
  const { exceptions } = loadConfig(root);
  const now = Date.now();
  return exceptions.map((e, index) => {
    const rules = e.rule ? [e.rule] : e.rules || [];
    const expires = e.expires instanceof Date ? e.expires.toISOString().slice(0, 10) : e.expires ?? null;
    return { index, path: e.path, rules, expires, reason: e.reason ?? null, expired: !!expires && new Date(expires).getTime() < now };
  });
}

/** The parsed mapping a raw architecture.yml text represents, or `{}` for an empty/missing file.
 * Malformed YAML is left to validateArchitectureConfig's caller to catch via the normal read path
 * (loadConfig) -- this function is only ever handed text this same module just wrote, or the
 * current on-disk file, never arbitrary client input. */
function parseRaw(text) {
  if (!text.trim()) return {};
  const parsed = yaml.load(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/** Preview (`commit` false: nothing written, returns before/after text) or save (`commit` true) one
 * rule's severity override. Unknown rule ids and invalid severities are refused before anything is
 * computed; the proposed whole-file result is re-validated through validateArchitectureConfig (#761)
 * before it is ever written, so a bad edit can never reach disk. */
export function ruleSeveritySave(root, body) {
  const { ruleId, severity, contentHash, commit } = body ?? {};
  if (typeof ruleId !== 'string' || !DEFAULT_RULES[ruleId]) return err(400, 'BAD_RULE', 'Unknown rule id.');
  if (!VALID_SEVERITIES.has(severity)) return err(400, 'BAD_SEVERITY', "severity must be 'error', 'warning' or 'off'.");
  const before = readRaw(root);
  const proposed = parseRaw(before);
  proposed.rules = { ...(proposed.rules || {}), [ruleId]: severity };
  if (commit !== true) {
    return { status: 200, body: { ok: true, before, after: yaml.dump(proposed), contentHash: hashOf(before), changed: true } };
  }
  if (contentHash !== hashOf(before)) return err(409, 'CHANGED_ON_DISK', 'architecture.yml changed on disk since it was loaded; re-read it and redo the edit.');
  const { valid, errors } = validateArchitectureConfig(proposed);
  if (!valid) return err(422, 'INVALID', 'That change would produce an invalid architecture.yml.', { errors });
  const after = yaml.dump(proposed);
  fs.writeFileSync(archPath(root), after);
  return { status: 200, body: { ok: true, ruleId, severity, contentHash: hashOf(after), rules: listRules(root) } };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Preview or save adding/removing one exception (#395 slice C). `action: 'add'` needs a `path`
 * glob and a `rule` id (an existing, known rule -- `rules:` arrays are not exposed by this UI
 * yet, one rule per exception); `expires`/`reason` are optional. `action: 'remove'` needs the
 * `index` readExceptions() reported for that entry -- indexes are only ever valid for the
 * architecture.yml text they were read from, which is exactly what `contentHash` guards against
 * drifting out from under a remove. Same preview/commit/contentHash/validateArchitectureConfig
 * shape as ruleSeveritySave. */
export function ruleExceptionSave(root, body) {
  const { action, contentHash, commit } = body ?? {};
  const before = readRaw(root);
  const proposed = parseRaw(before);
  const exceptions = [...(proposed.exceptions || [])];

  if (action === 'add') {
    const { path: glob, rule, expires, reason } = body;
    if (typeof glob !== 'string' || !glob) return err(400, 'BAD_PATH', 'path is required.');
    if (typeof rule !== 'string' || !DEFAULT_RULES[rule]) return err(400, 'BAD_RULE', 'Unknown rule id.');
    if (expires !== undefined && expires !== null && expires !== '' && !DATE_RE.test(expires)) {
      return err(400, 'BAD_EXPIRES', 'expires must be an ISO date (YYYY-MM-DD) or omitted.');
    }
    exceptions.push({ path: glob, rule, ...(expires ? { expires } : {}), ...(reason ? { reason } : {}) });
  } else if (action === 'remove') {
    const { index } = body;
    if (typeof index !== 'number' || !exceptions[index]) return err(400, 'BAD_INDEX', 'That exception no longer exists at that index.');
    exceptions.splice(index, 1);
  } else {
    return err(400, 'BAD_ACTION', "action must be 'add' or 'remove'.");
  }
  proposed.exceptions = exceptions;

  if (commit !== true) {
    return { status: 200, body: { ok: true, before, after: yaml.dump(proposed), contentHash: hashOf(before), changed: true } };
  }
  if (contentHash !== hashOf(before)) return err(409, 'CHANGED_ON_DISK', 'architecture.yml changed on disk since it was loaded; re-read it and redo the edit.');
  const { valid, errors } = validateArchitectureConfig(proposed);
  if (!valid) return err(422, 'INVALID', 'That change would produce an invalid architecture.yml.', { errors });
  const after = yaml.dump(proposed);
  fs.writeFileSync(archPath(root), after);
  return { status: 200, body: { ok: true, contentHash: hashOf(after), exceptions: readExceptions(root) } };
}

const GLOB_FIELDS = new Set(['nonLayer', 'frozen']);

/** Preview or save adding/removing one glob to `nonLayer:` or `frozen:` (#395 slice D, the
 * "Advanced" disclosure #764's spec describes) -- both are a flat list of glob strings, so this
 * one function covers both fields rather than duplicating ruleExceptionSave's add/remove shape
 * for each. Same preview/commit/contentHash/validateArchitectureConfig shape as the other two. */
export function globListSave(root, body) {
  const { field, action, contentHash, commit } = body ?? {};
  if (!GLOB_FIELDS.has(field)) return err(400, 'BAD_FIELD', "field must be 'nonLayer' or 'frozen'.");
  const before = readRaw(root);
  const proposed = parseRaw(before);
  const globs = [...(proposed[field] || [])];

  if (action === 'add') {
    const { glob } = body;
    if (typeof glob !== 'string' || !glob.trim()) return err(400, 'BAD_GLOB', 'glob is required.');
    globs.push(glob);
  } else if (action === 'remove') {
    const { index } = body;
    if (typeof index !== 'number' || globs[index] === undefined) return err(400, 'BAD_INDEX', 'That entry no longer exists at that index.');
    globs.splice(index, 1);
  } else {
    return err(400, 'BAD_ACTION', "action must be 'add' or 'remove'.");
  }
  proposed[field] = globs;

  if (commit !== true) {
    return { status: 200, body: { ok: true, before, after: yaml.dump(proposed), contentHash: hashOf(before), changed: true } };
  }
  if (contentHash !== hashOf(before)) return err(409, 'CHANGED_ON_DISK', 'architecture.yml changed on disk since it was loaded; re-read it and redo the edit.');
  const { valid, errors } = validateArchitectureConfig(proposed);
  if (!valid) return err(422, 'INVALID', 'That change would produce an invalid architecture.yml.', { errors });
  const after = yaml.dump(proposed);
  fs.writeFileSync(archPath(root), after);
  return { status: 200, body: { ok: true, contentHash: hashOf(after), [field]: loadConfig(root)[field] } };
}

/** @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}, clientOrigin?: string, afterSave?: (root:string, rel:string) => unknown}} deps */
export function createRulesRouter({ getRoot, clientOrigin, afterSave = () => null }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    }
    return next();
  });
  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    try {
      const out = fn(r.root, req);
      return res.status(out.status).json(out.body);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || 'Could not process that rules request.' });
    }
  };
  router.get('/', handle((root) => rulesIndex(root)));
  router.post('/severity', handle((root, req) => {
    const out = ruleSeveritySave(root, req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
    if (out.status === 200 && out.body.ok && req.body?.commit === true) afterSave(root, 'architecture.yml');
    return out;
  }));
  router.post('/exceptions', handle((root, req) => {
    const out = ruleExceptionSave(root, req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
    if (out.status === 200 && out.body.ok && req.body?.commit === true) afterSave(root, 'architecture.yml');
    return out;
  }));
  router.post('/globs', handle((root, req) => {
    const out = globListSave(root, req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
    if (out.status === 200 && out.body.ok && req.body?.commit === true) afterSave(root, 'architecture.yml');
    return out;
  }));
  return router;
}
