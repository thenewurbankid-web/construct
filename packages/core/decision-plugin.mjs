// #633 (epic #616) -- loading a decision-provider plugin from a file, once, for everyone who names one: the project setting
// `decision: { provider, plugin }` of architecture.yml (decision-project.mjs) and `construct traces replay --plugin <file>`
// (cli.mjs) share this loader, so the contract and the containment rule live in one place.
//
// A plugin file default-exports the provider contract (docs/DECISION-PROVIDERS.md):
//
//   export default { name: 'jev', version: '0.1', suggest(summary) { return { option, reason, score?, runnerUp? } | null; } };
//
// What the loader guarantees, and what it cannot:
//   - a project plugin path must be RELATIVE and its real path (symbolic links resolved) must stay inside the project root;
//     an absolute path, a `..` that leaves the project or a link that points out is refused, never followed;
//   - the file is imported only when this function is called, and callers call it only when the plugin is named and its
//     provider is not `rules` or `off`; nothing is scanned, nothing is installed, nothing is fetched;
//   - the export is checked against the contract (`validateProviderContract`) before anything calls it;
//   - it CANNOT sandbox: an imported module runs in this process with the caller's permissions, exactly like a script you
//     run. The wall around it is the summary it receives (path-free, frozen, secret-free) and the validation of what it
//     returns (decision-provider.mjs), not isolation of its code. That is why a project plugin is a decision the person who
//     opens the project makes (docs/DECISION-PROVIDERS.md, "Trust").
// No network, no model of its own. Every failure is returned as `{ ok: false, code, message }`, never thrown.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDecisionProvider, registerDecisionProvider } from './decision-provider.mjs';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 160);

/** Plugin file extensions that can be imported. */
export const PLUGIN_EXTENSIONS = Object.freeze(['.mjs', '.js', '.cjs']);
/** What a provider name may look like (it is written into decision traces and log lines). */
export const PROVIDER_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,39}$/;

/**
 * Check an object against the provider contract: `{ name, version, suggest }` with a name of lowercase letters, digits and
 * `. _ -` (not `rules` or `off`, which are built in), a non-empty version string of at most 32 characters, and a `suggest`
 * function.
 *
 * @param {unknown} provider The candidate.
 * @returns {{ ok: boolean, errors: string[] }} Every problem found, in words.
 *
 * @example
 * validateProviderContract({ name: 'jev', version: '0.1', suggest() { return null; } }).ok; // => true
 * validateProviderContract({ suggest() {} }).errors; // => ['name must be ...', 'version must be ...']
 */
export function validateProviderContract(provider) {
  if (!isPlainObject(provider)) return { ok: false, errors: ['the provider must be an object { name, version, suggest }'] };
  const errors = [];
  if (typeof provider.name !== 'string' || !PROVIDER_NAME_PATTERN.test(provider.name)) errors.push('name must be lowercase letters, digits and . _ - (at most 40 characters, starting with a letter)');
  else if (provider.name === 'rules' || provider.name === 'off') errors.push(`"${provider.name}" is a built-in provider name`);
  if (typeof provider.version !== 'string' || !provider.version.trim() || provider.version.length > 32) errors.push('version must be a non-empty string of at most 32 characters');
  if (typeof provider.suggest !== 'function') errors.push('suggest must be a function (summary) => { option, reason, score?, runnerUp? } | null');
  return { ok: errors.length === 0, errors };
}

const fail = (code, message) => ({ ok: false, code, message });

/** The file of a project plugin, or why it is refused: relative, inside the project (links resolved), an existing importable file. */
function locateInProject(root, relative) {
  if (typeof relative !== 'string' || !relative.trim()) return fail('PLUGIN_PATH_INVALID', 'the plugin path must be a file path relative to the project');
  if (path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) return fail('PLUGIN_PATH_INVALID', 'the plugin path must be relative to the project, not absolute');
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return fail('PLUGIN_NOT_FOUND', 'the project folder could not be read');
  }
  const wanted = path.resolve(realRoot, relative);
  const inside = (p) => p === realRoot || p.startsWith(realRoot + path.sep);
  if (!inside(wanted)) return fail('PLUGIN_OUTSIDE_PROJECT', 'the plugin file is outside the project');
  let real;
  try {
    real = fs.realpathSync(wanted);
  } catch {
    return fail('PLUGIN_NOT_FOUND', 'the plugin file does not exist');
  }
  if (!inside(real)) return fail('PLUGIN_OUTSIDE_PROJECT', 'the plugin file is a link that leaves the project');
  return checkedFile(real);
}

/** A plugin file named on a command line (`--plugin`): any path the person types, resolved from the working directory. */
function locateOnCommandLine(file) {
  if (typeof file !== 'string' || !file.trim()) return fail('PLUGIN_PATH_INVALID', 'the plugin path is empty');
  try {
    return checkedFile(fs.realpathSync(path.resolve(file)));
  } catch {
    return fail('PLUGIN_NOT_FOUND', 'the plugin file does not exist');
  }
}

function checkedFile(real) {
  const st = fs.statSync(real);
  if (!st.isFile()) return fail('PLUGIN_PATH_INVALID', 'the plugin path is not a file');
  if (!PLUGIN_EXTENSIONS.includes(path.extname(real))) return fail('PLUGIN_PATH_INVALID', `the plugin file must end in ${PLUGIN_EXTENSIONS.join(', ')}`);
  return { ok: true, file: real, mtimeMs: st.mtimeMs };
}

/**
 * Import a plugin file and return its provider. With `root`, the file is a PROJECT plugin: relative, inside the project,
 * links resolved (`PLUGIN_PATH_INVALID`, `PLUGIN_OUTSIDE_PROJECT`, `PLUGIN_NOT_FOUND`). Without `root` it is a file named on a
 * command line and any path is taken as typed. The provider is the default export, or (for a file that registers itself
 * with `registerDecisionProvider`) the registered provider named `expectName`. It must satisfy `validateProviderContract`
 * (a self-registered one only when `strict` is not false) and, with `expectName`, carry that name (`PLUGIN_NAME_MISMATCH`).
 * `register` also registers it by name, for callers that look it up in the registry (the replay command).
 *
 * @param {string} file The plugin path: relative to `root` when `root` is given.
 * @param {{ root?: string, expectName?: string | null, register?: boolean, strict?: boolean }} [options] The project root, the provider name the caller asked for, whether to register it, strictness for a self-registered provider (default true).
 * @returns {Promise<{ ok: true, provider: import('./decision-provider.mjs').DecisionProvider } | { ok: false, code: string, message: string }>} The provider, or why not. The message holds no absolute path.
 *
 * @example
 * const r = await loadDecisionPlugin('tools/jev.mjs', { root, expectName: 'jev' });
 * if (r.ok) r.provider.version; // => '0.1'
 */
export async function loadDecisionPlugin(file, options = {}) {
  const { root, expectName = null, register = false, strict = true } = options;
  const located = root === undefined ? locateOnCommandLine(file) : locateInProject(root, file);
  if (!located.ok) return located;
  let mod;
  try {
    // The modification time is in the URL so an edited plugin is re-read by a running server, not served from the module cache.
    mod = await import(`${pathToFileURL(located.file).href}?m=${Math.floor(located.mtimeMs)}`);
  } catch (e) {
    return fail('PLUGIN_LOAD_FAILED', `the plugin could not be loaded: ${firstLine(e)}`);
  }
  const exported = isPlainObject(mod.default) && typeof mod.default.suggest === 'function' ? mod.default : null;
  const registered = !exported && expectName ? getDecisionProvider(expectName) : undefined;
  const provider = exported ?? registered;
  if (!provider) return fail('PLUGIN_NO_PROVIDER', 'the plugin file must default-export { name, version, suggest }');
  if (exported || strict) {
    const contract = validateProviderContract(provider);
    if (!contract.ok) return fail('PLUGIN_CONTRACT_INVALID', `the plugin does not follow the provider contract: ${contract.errors.join('; ')}`);
  }
  if (expectName && provider.name !== undefined && provider.name !== expectName) return fail('PLUGIN_NAME_MISMATCH', `the plugin is named "${String(provider.name).slice(0, 40)}", not "${expectName}"`);
  if (register && exported) {
    try {
      registerDecisionProvider(provider.name, provider);
    } catch (e) {
      return fail('PLUGIN_CONTRACT_INVALID', firstLine(e));
    }
  }
  return { ok: true, provider };
}
