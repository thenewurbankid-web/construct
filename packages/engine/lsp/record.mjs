// #950 -- what the persistent index stores for one file, computed the same way by the foreground LSP (server.mjs) and
// the background indexer (indexer.mjs), and the pins that decide whether a stored record is still valid.
//
//   computeRecord(root, rel, text, o)   -> { ids, smith, exact, rules, exports, refs }
//   smithPin({ smith })                 -> 'cbc25671+raw#<adapter hash>' | 'off'   atomic-codemod head + mode + our adapter
//   rulesVersion(root, { rules })       -> 'line#<hash>' | 'off'                  profile + rule code + architecture.yml
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportsOf, refsOf } from './outline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);
/**
 * A file the Smith and rules layers index (code, not a declaration file).
 * @param {string} rel
 * @returns {boolean}
 */
export const isCode = (rel) => /\.(ts|tsx|js|jsx|mjs)$/.test(rel) && !/\.d\.ts$/.test(rel);

let smithMod;
let rulesMod;
const S = async () => (smithMod ??= await import('./smith.mjs'));
const R = async () => (rulesMod ??= await import('./rules.mjs'));

/**
 * The Smith pin: which to-english produced the stored steps (atomic-codemod's linked head, raw or JS mode) and which
 * adapter turned a file into functions (smith.mjs + smithText.mjs content). 'off' when Smith is not used.
 * @param {{smith?: boolean}} [o]
 * @returns {Promise<string>}
 */
export async function smithPin({ smith = true } = {}) {
  if (!smith) return 'off';
  const s = await S();
  const adapter = ['smith.mjs', 'smithText.mjs'].map((f) => { try { return fs.readFileSync(path.join(HERE, f), 'utf8'); } catch { return ''; } }).join('\0');
  return `${s.smithHead() ?? 'unlinked'}${s.RAW ? '+raw' : ''}#${sha(adapter)}`;
}

let ruleCodeHash;
/** One hash over the rule engine's code (packages/core, its profiles, the default enforcer list), once a process. */
function ruleCode() {
  if (ruleCodeHash) return ruleCodeHash;
  const core = path.resolve(HERE, '..', '..', 'core');
  const files = [];
  const walk = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'test', 'fixtures'].includes(e.name)) walk(p); } else if (/\.(mjs|json)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) files.push(p);
    }
  };
  walk(core);
  files.push(path.resolve(HERE, '..', 'defaultEnforcers.mjs'));
  const h = crypto.createHash('sha1');
  for (const f of files.sort()) { try { h.update(f.slice(core.length)); h.update(fs.readFileSync(f)); } catch { /* gone */ } }
  return (ruleCodeHash = h.digest('hex').slice(0, 12));
}

/**
 * The rules profile version: the project's profile, the rule code and its architecture.yml. 'off' when rules are off.
 * @param {string} root
 * @param {{rules?: boolean}} [o]
 * @returns {Promise<string>}
 */
export async function rulesVersion(root, { rules = true } = {}) {
  if (!rules) return 'off';
  let profile = 'strict-nextjs';
  try { const { selectProfile } = await import('@line/construct-core/profiles'); profile = selectProfile(root); } catch { /* no config: the default */ }
  let yml = '';
  try { yml = fs.readFileSync(path.join(root, 'architecture.yml'), 'utf8'); } catch { yml = ''; }
  return `${profile}#${ruleCode()}#${sha(yml)}`;
}

/**
 * Everything the index stores for one file. `smith` is the Smith index function (smith.mjs smithIndexFile by default;
 * tests pass a counting stub); `exact` also stores the exact (canonical) style per stable id.
 * @param {string} root Project root.
 * @param {string} rel Root-relative file.
 * @param {string} text Its content.
 * @param {{smith?: ((rel: string, text: string, o?: {canonical?: boolean}) => Promise<any[]>) | null, exact?: boolean, rules?: boolean, tsOptions?: any}} [o]
 * @returns {Promise<{ids: string[], smith: any[]|null, exact: Record<string, string[]>|null, rules: any, exports: any[], refs: any[]}>}
 */
export async function computeRecord(root, rel, text, { smith = null, exact = true, rules = true, tsOptions = null } = {}) {
  const out = { ids: [], smith: null, exact: null, rules: null, exports: [], refs: [] };
  try { out.exports = exportsOf(rel, text); } catch { out.exports = []; }
  try { out.refs = refsOf(root, rel, text, tsOptions); } catch { out.refs = []; }
  if (!isCode(rel)) return out;
  if (smith) {
    let entries = [];
    try { entries = await smith(rel, text, { canonical: false }); } catch { entries = []; }
    out.smith = entries;
    out.ids = entries.map((e) => e.id);
    if (exact && entries.length) {
      let ex = [];
      try { ex = await smith(rel, text, { canonical: true }); } catch { ex = []; }
      out.exact = Object.fromEntries(ex.map((e) => [e.id, e.sentences]));
    }
  }
  if (rules) out.rules = (await R()).ruleDiagnostics(root, rel);
  return out;
}

/**
 * The default Smith index function (smith.mjs smithIndexFile).
 * @returns {Promise<(rel: string, text: string, o?: {canonical?: boolean}) => Promise<any[]>>}
 */
export async function defaultSmith() { const s = await S(); return (rel, text, o) => s.smithIndexFile(rel, text, o); }
