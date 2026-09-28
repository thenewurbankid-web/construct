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
import { DEFAULT_RULES } from '../../../packages/core/config.mjs';
import { validateArchitectureConfig } from '../../../packages/core/validate-architecture-config.mjs';

/** @returns {{status:number, body:object}} */
export const rulesIndex = (root) => ({ status: 200, body: { ok: true, rules: listRules(root) } });

const VALID_SEVERITIES = new Set(['error', 'warning', 'off']);
const err = (status, code, error, extra) => ({ status, body: { ok: false, code, error, ...extra } });
const archPath = (root) => path.join(root, 'architecture.yml');
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

function readRaw(root) {
  const file = archPath(root);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
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
  return router;
}
