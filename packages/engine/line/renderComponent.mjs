// T7 of the Line Cockpit (contract.mjs, LINE_API GET /api/line/render): render ONE library component alone, with
// sample props, to a themed HTML document. A pure read: nothing is written to the project; the renderer's own build
// folder lives under the OS temp folder and is removed after every render.
//
//   sampleProps(described, fixture)   props from react-docgen's description (describeComponent.mjs): a string gets
//                                     its name as text ("label" -> "Label"), a number 1, a boolean false, a union of
//                                     string literals its first one; anything else has no sample (null, not passed).
//                                     A fixture `<library>/fixtures/<Name>.json` (an object) wins per prop.
//   renderLibraryComponent(root, {file, props}, deps)
//                                     checks the path is under `<library>/components`, reads the props, merges the
//                                     person's values over the samples and renders through Morpheus's isolated
//                                     render (@mx/morpheus-render, linked by packages/line-links).
//
// No single point of failure: when the Morpheus link is down there is no other renderer that works without the
// project's own dev server (Construct's preview, previewVitePlugin.mjs, is served by that dev server), so the answer
// is `{ok: false, code: 'NO_RENDERER', sentence}` with the props still listed and the link's reason under `detail`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../core/config.mjs';
import { normalizeLineConfig } from '../../core/profiles/line/contract.mjs';
import { resolveLayout } from '../../core/profiles/line/checks.mjs';
import { describeComponent } from '../describeComponent.mjs';
import { importLinked } from '../../line-links/index.mjs';

const SOURCE_EXT = /\.(tsx|jsx|ts|js)$/;
export const RENDER_TIMEOUT_MS = 20000;

/** @typedef {import('./contract.mjs').RenderProp} RenderProp */
/** @typedef {import('./contract.mjs').RenderResult} RenderResult */

/** "label" -> "Label", "userName" -> "User name". */
const textFor = (name) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Text';
};

/** The sample value for one described prop, or null when its type has no simple sample. */
export function sampleValue(name, type) {
  const t = String(type ?? '').trim();
  if (t === 'string') return textFor(name);
  if (t === 'number') return 1;
  if (t === 'boolean' || t === 'bool') return false;
  const literals = t.split('|').map((s) => s.trim());
  if (literals.length > 0 && literals.every((s) => /^(['"]).*\1$/.test(s))) return literals[0].slice(1, -1);
  return null;
}

/** The value kind the Cockpit edits it as. */
export function valueKind(type) {
  const t = String(type ?? '').trim();
  if (t === 'number') return 'number';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t === 'string' || sampleValue('x', t) !== null) return 'string';
  return 'other';
}

/**
 * Sample props for a described component.
 * @param {{name: string, type: string}[]} described
 * @param {Record<string, unknown> | null} [fixture]
 * @returns {RenderProp[]}
 */
export function sampleProps(described, fixture = null) {
  return described.map((p) => {
    const fromFixture = fixture && Object.prototype.hasOwnProperty.call(fixture, p.name) ? fixture[p.name] : undefined;
    return { name: p.name, type: String(p.type ?? 'unknown'), kind: valueKind(p.type), value: fromFixture !== undefined ? fromFixture : sampleValue(p.name, p.type) };
  });
}

/** @param {string} sentence @param {string} code @returns {{ ok: false, code: string, sentence: string }} */
const refusal = (sentence, code) => ({ ok: false, code, sentence });

/** The project's library folder (architecture.yml's `line:` section, resolved like the Line profile does). */
function libraryOf(root) {
  try {
    return resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line)).library;
  } catch {
    return resolveLayout(root, normalizeLineConfig(undefined)).library;
  }
}

/**
 * Check `file` is a component source file inside `<library>/components` of `root`, symlinks included.
 * @returns {{ok: true, abs: string, name: string, library: string} | {ok: false, code: string, sentence: string}}
 */
export function checkLibraryComponent(root, file) {
  const library = libraryOf(root);
  const dir = `${library}/components/`;
  const outside = refusal(`Only components in ${dir} can be previewed here, so "${String(file ?? '')}" is not shown.`, 'OUTSIDE_LIBRARY');
  if (typeof file !== 'string' || !file || file.includes('\0') || file.includes('\\') || path.isAbsolute(file)) return outside;
  if (file.split('/').some((s) => s === '..' || s === '.' || s === '') || !file.startsWith(dir)) return outside;
  if (!SOURCE_EXT.test(file)) return refusal(`Only .tsx, .jsx, .ts and .js components can be previewed, so "${file}" is not shown.`, 'NOT_SOURCE');
  let abs;
  try {
    const realRoot = fs.realpathSync(root);
    const realDir = fs.realpathSync(path.join(realRoot, library, 'components'));
    abs = fs.realpathSync(path.join(realRoot, file));
    if (!abs.startsWith(realDir + path.sep)) return outside;
    if (!fs.statSync(abs).isFile()) throw new Error('not a file');
  } catch {
    return refusal(`There is no component at ${file} in this project.`, 'NOT_FOUND');
  }
  return { ok: true, abs, name: path.basename(file).replace(SOURCE_EXT, ''), library };
}

/** `<library>/fixtures/<Name>.json` when it is a JSON object, else null. */
function fixtureOf(root, library, name) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, library, 'fixtures', `${name}.json`), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Parse the `props` query value: absent, or a JSON object of simple values. */
export function parseGivenProps(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: /** @type {const} */ (true), props: {} };
  let v;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { v = undefined; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return refusal('The props must be a JSON object of names and values, so nothing was rendered.', 'BAD_PROPS');
  for (const [k, x] of Object.entries(v)) {
    if (!['string', 'number', 'boolean'].includes(typeof x) && x !== null) return refusal(`The value of "${k}" must be text, a number, yes or no, so nothing was rendered.`, 'BAD_PROPS');
  }
  return { ok: /** @type {const} */ (true), props: /** @type {Record<string, string|number|boolean|null>} */ (v) };
}

/** The TSX page Morpheus renders: the component, imported by its absolute path, with the given props. */
export function previewPageSource(abs, name, props) {
  return [
    `import * as M from ${JSON.stringify(abs)};`,
    `const props = ${JSON.stringify(props)};`,
    `const C = M.default ?? M[${JSON.stringify(name)}] ?? Object.values(M).find((v) => typeof v === "function");`,
    'export default function Page() { return <C {...props} />; }',
    '',
  ].join('\n');
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`took longer than ${ms / 1000} seconds`)), ms).unref())]);
const firstLine = (e) => String(/** @type {any} */ (e)?.message ?? e).split('\n')[0].slice(0, 300);

/**
 * Render one library component alone. Never throws.
 * @param {string} root Project root.
 * @param {{file: string, props?: unknown}} req `file` root-relative; `props` a JSON string or object of values over the samples.
 * @param {{loadMorpheus?: () => Promise<{ok: true, module: any} | {ok: false, reason: string}>,
 *   describe?: typeof describeComponent, timeoutMs?: number, tmpDir?: string}} [deps]
 * @returns {Promise<RenderResult>}
 */
export async function renderLibraryComponent(root, req, deps = {}) {
  const { loadMorpheus = () => importLinked('@mx/morpheus-render'), describe = describeComponent, timeoutMs = RENDER_TIMEOUT_MS, tmpDir = os.tmpdir() } = deps;
  try {
    const at = checkLibraryComponent(root, req?.file);
    if (!at.ok) return /** @type {{ ok: false, code: string, sentence: string }} */ (at);
    const given = parseGivenProps(req?.props);
    if (!given.ok) return /** @type {{ ok: false, code: string, sentence: string }} */ (given);
    const d = await describe(root, req.file);
    const comp = d?.ok ? (d.components.find((c) => c.name === at.name) ?? d.components[0]) : null;
    const props = sampleProps(comp?.props ?? [], fixtureOf(root, at.library, at.name));
    for (const [k, v] of Object.entries(given.props)) {
      const p = props.find((x) => x.name === k);
      if (!p) return refusal(`${at.name} has no prop called "${k}", so nothing was rendered.`, 'UNKNOWN_PROP');
      p.value = v;
    }
    const values = Object.fromEntries(props.filter((p) => p.value !== null && p.value !== undefined).map((p) => [p.name, p.value]));
    const link = await loadMorpheus();
    if (!link.ok) {
      return {
        ok: false,
        code: 'NO_RENDERER',
        sentence: `There is no picture of ${at.name} because Morpheus's renderer is not linked here and Construct's own preview needs the project's dev server, so only its props are listed; the rest of Cockpit works as usual.`,
        detail: /** @type {{ reason: string }} */ (link).reason,
        props,
      };
    }
    const scratch = fs.mkdtempSync(path.join(tmpDir, 'construct-line-render-'));
    try {
      const html = await withTimeout(link.module.renderPage(previewPageSource(at.abs, at.name, values), { libraryDir: path.join(scratch, 'no-morpheus-library'), scratch, title: at.name }), timeoutMs);
      return { ok: true, html, props, via: 'morpheus' };
    } catch (e) {
      return { ok: false, code: 'RENDER_FAILED', sentence: `${at.name} could not be rendered with these props, so there is no picture; check its code or change a prop.`, detail: firstLine(e), props };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  } catch (e) {
    return { ok: false, code: 'INTERNAL', sentence: 'Cockpit could not render this component; nothing was changed.', detail: firstLine(e) };
  }
}
