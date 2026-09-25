// #631 (part of #616) -- "wrap with provider" as a deterministic block, so a plan (and the CLI) can do what a person does by hand: wrap a
// component or page with one of the project's providers, as a minimal, previewed edit of the file that composes it. No model: the providers
// are found by a scan, the edit is a text splice at the offsets of the element in the file's AST, and running it twice changes nothing.
//   providersOf(root)                    every provider unit of the project (`features/*/hooks/*Provider*` built with `defineProvider`), each usable or not, with why
//   providerOffer(root, request)         the closed question `q-provider`: 1-4 providers and "do not wrap" (chooser summary shape, stable ids)
//   wrapProviderTouches(root, request)   the file the step edits (`modify`), or null when it cannot be worked out
//   wrapProvider(root, request, opts)    the edit itself (`dryRun` previews it: nothing is written)
// What the Pages editor has (ui/server/src/pagesEditor.mjs, #532 and #533) is the consuming side (`const cart = useCartProvider();` in a page) and the
// Expression "Wrap with..." (a flagged loop or condition), neither of which puts a provider's root component around an element, so nothing was
// shared to extract: this is the first transformation of that kind, built on the same AST package (packages/ast: parseJsxTree,
// insertNamedImport, jsxParseError). The Pages editor keeps its own tests and code, unchanged.
// Where the wrap goes: the file that COMPOSES the element, which is a controller of the feature. A route entry may import only controllers
// (ROUTE-002 territory), so a provider cannot be wrapped there and the block says so instead of breaking the layering. The provider's own
// props (`defineProvider<Props, Value>`) are not known to a text scan, so the root is wrapped with none: `construct test types` names any that are required.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { hasFactoryCall } from './architecture-enforcer.mjs';
import { walk, rel, write } from './fs.mjs';
import { extractExports, insertNamedImport, jsxParseError, parseJsxTree, spliceNode } from '../ast/index.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const FEATURE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const HOOK_RE = /^use[A-Z]\w*Provider$/;
const ROOT_RE = /export\s+const\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*[A-Za-z_]\w*\.ProviderComponent\b/g;
const SOURCE_EXT = /\.(?:tsx?|jsx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$/;

/** The id of the closed question about which provider to wrap with (chooser summary shape, like `q-route`), and the id of its "no provider" option. */
export const PROVIDER_QUESTION_ID = 'q-provider';
export const NO_PROVIDER_OPTION = 'none';

/** At most this many providers are shown as options (with "do not wrap" the question has at most 5, the chooser limit). */
export const MAX_PROVIDER_OPTIONS = 4;

const featuresRootOf = (root) => (loadConfig(root).features?.root || 'features').split('/').filter(Boolean).join('/');
const readFile = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

function featureDirs(root) {
  const base = path.join(root, featuresRootOf(root));
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Whether feature `owner`'s public index makes the root component (or the whole hook file) reachable from another feature. */
function exportedByIndex(root, owner, rootName, hookFile) {
  const source = readFile(path.join(root, featuresRootOf(root), owner, 'index.ts')) ?? readFile(path.join(root, featuresRootOf(root), owner, 'index.tsx'));
  if (!source) return false;
  const base = hookFile.replace(SOURCE_EXT, '');
  return new RegExp(`\\b${rootName}\\b`).test(source) || new RegExp(`export\\s*\\*\\s*from\\s*['"][^'"]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(source);
}

/**
 * Every provider unit of the project, found by a deterministic scan of `features/*\/hooks/*Provider*` (the features folder follows architecture.yml):
 * a file that calls `defineProvider` and exports a `use<Name>Provider` hook. `root` is the exported name of its `ProviderComponent`
 * (`export const CartProviderRoot = CartProvider.ProviderComponent`), `null` when there is none. Each entry says whether it `usable` for a wrap
 * and, when not, `why`. Sorted by feature then name; read-only, never throws.
 *
 * @param {string} root Project root.
 * @param {{ feature?: string }} [opts] `feature` is the feature that will be edited: a provider of another feature is usable only when that feature's public index exports it.
 * @returns {{ id: string, hook: string, root: string | null, feature: string, file: string, usable: boolean, why: string }[]} The providers. `id` is the hook name, or `<feature>.<hook>` when two features define the same one.
 *
 * @example
 * providersOf(root).map((p) => p.id); // => ['useCartProvider']
 */
export function providersOf(root, { feature } = {}) {
  const found = [];
  try {
    const featuresRoot = featuresRootOf(root);
    for (const owner of featureDirs(root)) {
      const dir = path.join(root, featuresRoot, owner, 'hooks');
      for (const abs of walk(dir).sort()) {
        const name = path.basename(abs);
        if (!SOURCE_EXT.test(name) || TEST_FILE.test(name) || !name.includes('Provider')) continue;
        const source = readFile(abs);
        if (!source || !hasFactoryCall('defineProvider', source)) continue;
        let exported = [];
        try { exported = extractExports(source).map((e) => e.name); } catch { continue; }
        const rootName = [...source.matchAll(ROOT_RE)].map((m) => m[1]).find((n) => exported.includes(n)) ?? null;
        for (const hook of exported.filter((n) => HOOK_RE.test(n))) {
          const file = rel(root, abs);
          let usable = true;
          let why = `Wraps with <${rootName}> from ${owner}.`;
          if (!rootName) { usable = false; why = 'It exports no ProviderComponent to wrap with. Add: export const <Name>ProviderRoot = <Name>Provider.ProviderComponent.'; }
          else if (feature && owner !== feature && !exportedByIndex(root, owner, rootName, name)) { usable = false; why = `The ${owner} feature's public index does not export ${rootName}, and another feature may import only through it.`; }
          found.push({ id: hook, hook, root: rootName, feature: owner, file, usable, why });
        }
      }
    }
  } catch { /* an unreadable project has no providers */ }
  const dup = new Set(found.filter((p, i) => found.findIndex((q) => q.hook === p.hook) !== i).map((p) => p.hook));
  return found.map((p) => (dup.has(p.hook) ? { ...p, id: `${p.feature}.${p.hook}` } : p)).sort((a, b) => a.id.localeCompare(b.id));
}

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);
const cap = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The closed question about which provider to wrap an element with (chooser summary shape, id `q-provider`): the project's usable providers first
 * (at most `MAX_PROVIDER_OPTIONS`, sorted by id, stable), the unusable ones after them disabled with the reason, then `none` (do not wrap). The default is
 * the first enabled option, so the rules-only provider suggests a real provider when there is one. Read-only.
 *
 * @param {string} root Project root.
 * @param {{ feature: string, name: string, answer?: string | { option: string } }} request The feature that owns the element, the element, an answer.
 * @returns {{ question: object, providers: object[], hidden: number } | null} The question, every provider found and how many did not fit, or `null` when the project has no provider at all.
 *
 * @example
 * providerOffer(root, { feature: 'cart', name: 'CartPage' })?.question.options.map((o) => o.id); // => ['useCartProvider', 'none']
 */
export function providerOffer(root, request) {
  const providers = providersOf(root, { feature: request?.feature });
  if (!providers.length) return null;
  const ordered = [...providers.filter((p) => p.usable), ...providers.filter((p) => !p.usable)];
  const shown = ordered.slice(0, MAX_PROVIDER_OPTIONS);
  const options = [
    ...shown.map((p) => ({ id: p.id, label: cap(`Wrap with ${p.root ?? p.hook}`, 60), enabled: p.usable, why: cap(p.why, 120) })),
    { id: NO_PROVIDER_OPTION, label: 'Do not wrap', enabled: true, why: 'Leaves the file as it is.' },
  ];
  const firstEnabled = options.find((o) => o.enabled)?.id ?? NO_PROVIDER_OPTION;
  const chosen = answerOf(request?.answer)?.option;
  const known = options.some((o) => o.id === chosen && o.enabled);
  const question = { id: PROVIDER_QUESTION_ID, question: cap(`Which provider should wrap ${request?.name ?? 'the element'}?`, 160), options, default: firstEnabled, chosen: known ? chosen : null };
  return { question, providers, hidden: Math.max(0, ordered.length - shown.length) };
}

function checkRequest(request) {
  if (!request || typeof request.name !== 'string' || !NAME_RE.test(request.name)) throw usage(`"${request?.name ?? ''}" is not a PascalCase component or page name such as CartPage.`);
  if (typeof request.feature !== 'string' || !FEATURE_RE.test(request.feature)) throw usage(`Invalid feature name ${JSON.stringify(request.feature ?? '')}: use letters, numbers, "_" and "-" only.`);
  if (typeof request.provider !== 'string' || !request.provider) throw usage('Say which provider to wrap with (--provider <id>).');
}

/** The controllers of a feature, project-relative and sorted. */
function controllersOf(root, feature) {
  const dir = path.join(root, featuresRootOf(root), feature, 'controllers');
  return walk(dir).filter((f) => SOURCE_EXT.test(f) && !TEST_FILE.test(f)).map((f) => rel(root, f)).sort();
}

/** The elements named `tag` in one file: `{ source, tree, nodes }`, or null when the file has none or does not parse. */
function elementsIn(root, file, tag) {
  const source = readFile(path.join(root, file));
  if (source === null || !source.includes(tag)) return null;
  try {
    const tree = parseJsxTree(source);
    const nodes = [...tree.byId.values()].filter((n) => !n.isFragment && n.tag === tag);
    return nodes.length ? { source, tree, nodes } : null;
  } catch {
    return null;
  }
}

/** Route entry files of the project (project-relative), from architecture.yml's route layer. */
function routeEntries(root) {
  const config = loadConfig(root);
  const pattern = config.layers?.route?.pattern ?? 'app/**/page.tsx';
  if (!pattern.includes('*')) return [pattern];
  const base = pattern.split('/**')[0];
  return walk(path.join(root, base)).filter((f) => /page\.[jt]sx?$/.test(f)).map((f) => rel(root, f)).sort();
}

/**
 * Where the wrap would be written, without writing: the composing file of the element and the provider. Answers `{ ok: true, file, node, provider, ... }` or
 * `{ ok: false, refusal }` in plain words. Shared by the touches, the preview and the edit, so they cannot disagree.
 */
function plan(root, request) {
  checkRequest(request);
  const providers = providersOf(root, { feature: request.feature });
  const matches = providers.filter((p) => p.id === request.provider || p.hook === request.provider);
  if (!matches.length) {
    const ids = providers.map((p) => p.id);
    return { ok: false, refusal: ids.length ? `"${request.provider}" is not a provider of this project. The providers are: ${ids.join(', ')}.` : 'This project has no provider (a hook named use<Name>Provider built with defineProvider in features/*/hooks/).' };
  }
  if (matches.length > 1) return { ok: false, refusal: `"${request.provider}" is defined in more than one feature (${matches.map((p) => p.id).join(', ')}). Name one of those.` };
  const provider = matches[0];
  if (!provider.usable) return { ok: false, refusal: `${provider.id} cannot be used here: ${provider.why}` };

  const controllers = controllersOf(root, request.feature);
  const hits = controllers.map((file) => ({ file, found: elementsIn(root, file, request.name) })).filter((h) => h.found);
  if (!hits.length) {
    const routed = routeEntries(root).find((file) => elementsIn(root, file, request.name));
    return { ok: false, refusal: routed
      ? `${request.name} is rendered by the route entry ${routed}, which may import only controllers, so a provider is not wrapped there. Wrap inside the controller that the route renders.`
      : `Nothing in the ${request.feature} feature's controllers renders <${request.name} />, so there is no file that composes it to edit. Create the controller first, or check the name.` };
  }
  if (hits.length > 1 || hits[0].found.nodes.length > 1) {
    const where = hits.map((h) => `${h.file} (${h.found.nodes.length})`).join(', ');
    return { ok: false, refusal: `<${request.name} /> is rendered in more than one place (${where}), so the wrap cannot be placed without guessing. Wrap one by hand.` };
  }
  const { file, found } = hits[0];
  const node = found.nodes[0];
  const ancestors = [...found.tree.byId.values()].filter((n) => n.start <= node.start && n.end >= node.end && n.id !== node.id);
  if (ancestors.some((n) => !n.isFragment && n.tag === provider.root)) return { ok: true, file, source: found.source, after: found.source, provider, already: true };
  const spec = importSpecifier(root, file, provider, request.feature);
  const existing = found.tree.ast.body.find((n) => n.type === 'ImportDeclaration' && n.specifiers.some((sp) => sp.local.name === provider.root));
  if (existing && existing.source.value !== spec) return { ok: false, refusal: `${provider.root} is already imported from "${existing.source.value}" in ${file}. Rename or remove that import first.` };
  const wrapped = spliceNode(found.source, node, wrapText(found.source, node, provider.root));
  const { source: after } = insertNamedImport(wrapped, { name: provider.root, specifier: spec });
  const broken = jsxParseError(after);
  if (broken) return { ok: false, refusal: `Wrapping <${request.name} /> in ${file} would leave invalid code (${broken}), so nothing is changed. Wrap it by hand.` };
  return { ok: true, file, source: found.source, after, provider, already: false };
}

/**
 * The file a `wrap.provider` step edits, as its `touches.files`: the file that composes the element (`modify`). Read-only and never throws.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, provider: string }} request The element, its feature and the provider.
 * @returns {{ path: string, change: 'modify', layer: string }[] | null} The file, or `null` when it cannot be worked out (a refusal, an invalid request).
 *
 * @example
 * wrapProviderTouches(root, { name: 'CartPage', feature: 'cart', provider: 'useCartProvider' }); // => [{ path: 'features/cart/controllers/CartController.tsx', change: 'modify', layer: 'controller' }]
 */
export function wrapProviderTouches(root, request) {
  try {
    const p = plan(root, request);
    return p.ok ? [{ path: p.file, change: 'modify', layer: 'controller' }] : null;
  } catch {
    return null;
  }
}

function importSpecifier(root, fromFile, provider, feature) {
  const featuresRoot = featuresRootOf(root);
  const target = provider.feature === feature ? provider.file : `${featuresRoot}/${provider.feature}/index.ts`;
  let spec = path.relative(path.dirname(path.join(root, fromFile)), path.join(root, target)).split(path.sep).join('/').replace(SOURCE_EXT, '');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return spec;
}

/** The element wrapped by the root: multi-line (own line) or one line (shares its line with other text). */
function wrapText(source, node, rootName) {
  const original = source.slice(node.start, node.end);
  const lineStart = source.lastIndexOf('\n', node.start - 1) + 1;
  const before = source.slice(lineStart, node.start);
  if (!/^[ \t]*$/.test(before)) return `<${rootName}>${original}</${rootName}>`;
  const inner = original.split('\n').map((line, i) => (i === 0 ? line : `  ${line}`)).join('\n');
  return `<${rootName}>\n${before}  ${inner}\n${before}</${rootName}>`;
}

/**
 * Wrap one component or page with a provider, in the controller that renders it: adds the import of the provider's root component and puts the element
 * inside it, a minimal splice at the element's own offsets; every other byte of the file is kept. Idempotent: an element already inside that root changes
 * nothing (`changed: false`, with a message). Refuses, with the reason, a provider that does not exist or cannot be used, an element that no controller of the
 * feature renders (a route entry may import only controllers), an element rendered in more than one place, a name already imported from elsewhere, and
 * a result that would not parse. `dryRun` returns the preview and writes nothing.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, provider: string }} request The element as it is rendered (`CartPage`), its feature, and a provider id from `providersOf`.
 * @param {{ dryRun?: boolean }} [opts] `dryRun`: compute the edit, write nothing.
 * @returns {{ file: string, changed: boolean, message: string, provider: string, root: string, before: string, after: string, notes: string[] }} The file (project-relative), whether it changed (or would), what happened in one line, and the text before and after.
 * @throws {Error} A usage error carrying the refusal.
 *
 * @example
 * wrapProvider(root, { name: 'CartPage', feature: 'cart', provider: 'useCartProvider' }).message; // => 'Wrapped <CartPage /> with <CartProviderRoot> in features/cart/controllers/CartController.tsx'
 */
export function wrapProvider(root, request, { dryRun = false } = {}) {
  const p = plan(root, request);
  if (!p.ok) throw usage(p.refusal);
  const { provider, file, source, after } = p;
  if (p.already) return { file, changed: false, message: `Unchanged ${file}: <${request.name} /> is already inside <${provider.root}>.`, provider: provider.id, root: provider.root, before: source, after: source, notes: [] };
  if (!dryRun) write(path.join(root, file), after);
  return {
    file,
    changed: true,
    message: `${dryRun ? 'Would wrap' : 'Wrapped'} <${request.name} /> with <${provider.root}> in ${file}`,
    provider: provider.id,
    root: provider.root,
    before: source,
    after,
    notes: ['The provider\'s own props are not filled in: run `construct test types` to see any it requires.'],
  };
}
