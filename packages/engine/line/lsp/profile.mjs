// #945 (part of #943) -- the switch for each Line LSP call Line's own surfaces use: on (used), shadow (computed and
// logged, not used) or off. Defaults: nextSteps and fixes on (measured wins in lsp-r1), the rest shadow until a Line
// bench run proves them. Order: a call's own override, then LINE_LSP (env, `fixes=off,gatherer=on`), then the
// project's line/lsp-profile.json ({v: 1, calls: {"lsp.fixes": "off"}}), then the default. Shadow rows go to
// line/log/lsp-shadow.jsonl, only when the project already has a line/ folder.
import fs from 'node:fs';
import path from 'node:path';

export const LSP_CALLS = Object.freeze(['nextSteps', 'completions', 'gatherer', 'smithCheck', 'fixes', 'beam']);
export const LSP_MODES = Object.freeze(['on', 'shadow', 'off']);
/** lsp-r1 (bench/isolation/results/lsp-r1.md): nextSteps 8/8 and fixes clear tsc failures; the rest wait for a Line run.
 * beam (#949, path/beam/): the candidate-path re-plan after 3 failed fills, shadow until a Line run proves it. */
export const LSP_DEFAULTS = Object.freeze({ nextSteps: 'on', completions: 'shadow', gatherer: 'shadow', smithCheck: 'shadow', fixes: 'on', beam: 'shadow' });
export const LSP_PROFILE_FILE = 'line/lsp-profile.json';
export const LSP_SHADOW_LOG = 'line/log/lsp-shadow.jsonl';

/**
 * The profile flag name of a call: lsp.nextSteps, ...
 * @param {string} call One of LSP_CALLS.
 * @returns {string}
 */
export const flagOf = (call) => `lsp.${call}`;
const valid = (m) => (LSP_MODES.includes(m) ? m : null);
/** A mode from a map keyed by call or by flag ({nextSteps: 'off'} or {'lsp.nextSteps': 'off'}); booleans read as on/off. */
const pick = (map, call) => {
  if (!map || typeof map !== 'object') return null;
  const v = map[flagOf(call)] ?? map[call];
  return v === true ? 'on' : v === false ? 'off' : valid(v);
};

function fromEnv(call, env = process.env) {
  const s = String(env.LINE_LSP ?? '').trim();
  if (!s) return null;
  const map = Object.fromEntries(s.split(',').map((x) => x.trim().split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  return pick(map, call);
}

function fromProject(root, call) {
  if (!root) return null;
  try { return pick(JSON.parse(fs.readFileSync(path.join(root, LSP_PROFILE_FILE), 'utf8')).calls, call); } catch { return null; }
}

/**
 * The mode of one LSP call for one project.
 * @param {string|null} root The project root (null: defaults and env only).
 * @param {string} call One of LSP_CALLS.
 * @param {Record<string, unknown>|null} [override] A caller's own map ({fixes: 'off'} or {'lsp.fixes': 'off'}).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'on'|'shadow'|'off'}
 */
export function lspMode(root, call, override = null, env = process.env) {
  if (!LSP_CALLS.includes(call)) throw new TypeError(`lsp profile: no call ${call}`);
  return /** @type {any} */ (pick(override, call) ?? fromEnv(call, env) ?? fromProject(root, call) ?? LSP_DEFAULTS[call]);
}

/**
 * Every call's flag, mode and default, for one project.
 * @param {string|null} root The project root.
 * @param {Record<string, unknown>|null} [override]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{flag: string, mode: string, default: string}[]}
 */
export const lspProfile = (root, override = null, env = process.env) => LSP_CALLS.map((call) => ({ flag: flagOf(call), mode: lspMode(root, call, override, env), default: LSP_DEFAULTS[call] }));

/**
 * One shadow row (what the call would have done), appended to line/log/lsp-shadow.jsonl when the project has line/.
 * Never throws; returns the row so a caller can also carry it in its result.
 * @param {string} root @param {string} call @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>} The row as logged.
 */
export function shadowLog(root, call, row) {
  const rec = { at: new Date().toISOString(), flag: flagOf(call), ...row };
  try {
    if (root && fs.existsSync(path.join(root, 'line'))) {
      fs.mkdirSync(path.join(root, 'line', 'log'), { recursive: true });
      fs.appendFileSync(path.join(root, LSP_SHADOW_LOG), `${JSON.stringify(rec)}\n`);
    }
  } catch { /* a log that cannot be written never stops the work */ }
  return rec;
}
