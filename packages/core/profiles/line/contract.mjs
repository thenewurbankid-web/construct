// Line profile, contract (ca1): the Line project layout, the LINE-* rule ids with their plain-English
// "why", and the `line:` section of architecture.yml. No detection logic lives here (see checks.mjs);
// this file is what docs/line-architecture.md describes and what the tests pin.
//
// A Line project:
//
//   <library>/            components/ pages/ workflows/ fixtures/ usecases/ services/ domains/     (complete, usable items)
//   <features>/<name>/    the same kind folders, plus spec.md
//   line/                 plans, memory, state (Line's own state; only the writer touches it)
//
// <library> and <features> default to `library` and `features`, or `src/library` and `src/features`
// when the project keeps its code under `src/`. Both can be set in architecture.yml's `line:` section.
import { ConstructError, EXIT_CODES } from '../../diagnostics.mjs';

/**
 * The item kinds, the same folder names in the library and in every feature. Import v2 (iv2-fit) added the three logic
 * kinds in their minimal form: `usecases` (one user goal: data, state and navigation together), `services` (data hooks
 * and adapters) and `domains` (pure rules and transforms). They need no library base yet (LOGIC_KINDS); the layers wave
 * adds their full dependency rule.
 */
export const ITEM_KINDS = Object.freeze(['components', 'pages', 'workflows', 'fixtures', 'usecases', 'services', 'domains']);

/** The logic kinds (minimal version): a feature item of these kinds needs no `@line-base` link yet. */
export const LOGIC_KINDS = Object.freeze(['usecases', 'services', 'domains']);

/** Each kind's singular name, as sentences say it. */
export const KIND_SINGULAR = Object.freeze({ components: 'component', pages: 'page', workflows: 'workflow', fixtures: 'fixture', usecases: 'usecase', services: 'service', domains: 'domain' });

/** Which existing Construct layer each kind is checked as (fixtures have no layer rules). */
export const KIND_LAYER = Object.freeze({ components: 'component', pages: 'page', workflows: 'workflow' });

/** Files a feature folder may hold next to its kind folders. spec.md is the user's spec (LINE-BASE exempt). */
export const FEATURE_FILES = Object.freeze(['spec.md', 'README.md']);
/** Files the library folder may hold next to its kind folders. */
export const LIBRARY_FILES = Object.freeze(['README.md']);

/** Source files Line reads as code. JSON is read only for fixtures (base link in `$lineBase`). */
export const CODE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/** Default `line.packageRoots`: the folders whose direct children (and @scope/children) with a package.json are packages. */
export const DEFAULT_PACKAGE_ROOTS = Object.freeze(['packages']);

/**
 * Default `line.appFolders`: folders (at the project root, or next to the library when the code lives under src/)
 * that hold the app shell, config, scripts and tests rather than items. A source file outside these, the library,
 * the features, Line's state folder and the package roots is a LINE-LAYOUT error. Files directly at the project root
 * (or directly in src/) are config and entry files and always allowed.
 */
export const DEFAULT_APP_FOLDERS = Object.freeze(['app', 'config', 'scripts', 'public', 'types', 'test', 'tests', '__tests__', 'e2e']);

/** Folders never scanned: dependencies, build output, VCS, caches and test reports. */
export const SKIP_DIRS = Object.freeze(['node_modules', '.git', '.next', 'dist', 'out', 'build', 'coverage', 'test-results', 'playwright-report', '.turbo', '.cache']);

/** Test, story and barrel files are not feature items: they need no base link and get no layer rules. */
export const NON_ITEM_FILE = /(^index\.[cm]?[jt]sx?$)|(\.(test|spec|stories)\.[cm]?[jt]sx?$)/;

/** Default `line.writerExempt`: tests may create scratch files; everything else goes through the writer. */
export const DEFAULT_WRITER_EXEMPT = Object.freeze([
  '**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**', '**/__tests__/**', '**/e2e/**',
]);

/** fs functions that change the file system (node:fs, node:fs/promises, callback and Sync forms). */
export const FS_WRITE_FUNCTIONS = Object.freeze([
  'writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp',
  'symlink', 'link', 'truncate', 'ftruncate', 'chmod', 'chown', 'lchown', 'utimes', 'write', 'writev',
  'createWriteStream',
]);
/** fs-extra's own extra writers. */
export const FS_EXTRA_WRITE_FUNCTIONS = Object.freeze([
  'outputFile', 'outputJson', 'outputJSON', 'writeJson', 'writeJSON', 'ensureDir', 'ensureFile', 'mkdirs',
  'mkdirp', 'copy', 'move', 'remove', 'emptyDir', 'ensureLink', 'ensureSymlink',
]);
/** Modules whose bindings LINE-WRITER tracks. */
export const FS_MODULES = Object.freeze(['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'fs-extra', 'graceful-fs']);

/**
 * The LINE-* rules. `why` is one plain-English sentence shown with every violation; each hit adds
 * its own full-sentence `message` naming the file and what to do.
 * @type {Readonly<Record<string, {id: string, defaultSeverity: 'error'|'warning', why: string, expected: string[], check: string}>>}
 */
export const LINE_RULES = Object.freeze({
  'LINE-BASE': {
    id: 'LINE-BASE',
    defaultSeverity: 'error',
    why: 'Every feature item is based on exactly one library item of the same kind, so the library stays the single source every feature builds on.',
    expected: ['one "@line-base <kind>/<name>" link to an existing library item of the same kind'],
    check: 'Each component, page, workflow and fixture file under a feature carries exactly one @line-base link (a comment in code, "$lineBase" in JSON) that resolves to an existing library item of the same kind; spec.md and the logic kinds (usecases, services, domains: no base until the layers wave) are exempt.',
  },
  'LINE-OWNER': {
    id: 'LINE-OWNER',
    defaultSeverity: 'error',
    why: 'Every page that is not a full library page belongs to exactly one feature, so each screen has one owner.',
    expected: ['the page inside <features>/<feature>/pages/, or a full page inside <library>/pages/'],
    check: 'A page-shaped file (in a pages/ or app/ folder, named page.tsx or Name.page.tsx) outside <library>/pages and <features>/<name>/pages is an orphan; two features declaring the same @line-route both claim one page.',
  },
  'LINE-DIR': {
    id: 'LINE-DIR',
    defaultSeverity: 'error',
    why: 'A feature uses the library and never another feature, and the library never depends on a feature, so features stay independent and items can be promoted.',
    expected: ['an import from the library', 'promoting the shared item to the library'],
    check: 'Every import, re-export, dynamic import and require in a feature or library file is resolved (relative, @/, ~/ and src/ forms); a feature reaching into another feature, or the library reaching into any feature, is a violation.',
  },
  'LINE-WRITER': {
    id: 'LINE-WRITER',
    defaultSeverity: 'error',
    why: 'Every file write goes through Construct\'s writer, so project files are checked and approved and Line\'s own state is written atomically and logged.',
    expected: ['a call to Construct\'s writer (or a file listed under line.writers)'],
    check: 'Bindings of fs, node:fs, fs/promises, fs-extra and graceful-fs (import, namespace import, require, dynamic import, destructuring) are tracked, and every use of a function that writes, creates, moves or removes files is reported outside line.writers; test files are exempt by default (line.writerExempt).',
  },
  'LINE-SHARED': {
    id: 'LINE-SHARED',
    defaultSeverity: 'error',
    why: 'Every app and package uses the one shared module for each concern instead of keeping its own copy, so a fix or an improvement lands everywhere at once.',
    expected: ['an import of the shared module named in the message'],
    check: 'Outside the package that owns a concern (by its package.json name), a file that imports a library only the owner may use, contains a string only the owner may use (such as a model endpoint), or exports a function with the owner\'s signature name is a copy of that concern.',
  },
  'LINE-MODULE': {
    id: 'LINE-MODULE',
    defaultSeverity: 'error',
    why: 'Every module has a typed contract, a mock and its own tests, and other modules use it only through its name, so any module can be swapped for its mock, tested alone and fall back when it is down.',
    expected: ['a contract file (contract.*, types.*, a .d.ts, or package.json "types")', 'a mock (mock.*, mocks.*, *.mock.* or __mocks__/)', 'its own tests (*.test.*, *.spec.*, or a test/, tests/ or __tests__/ folder)', 'imports of another package by its name or an "exports" subpath'],
    check: 'Each folder with a package.json directly under a line.packageRoots folder (default packages; @scope/name too) is a package: it needs a contract file at its root or in src/ (a .js contract must hold a JSDoc @typedef or @callback) or a package.json types entry naming a real file, a mock, and tests inside it; a file in a package that reaches another package by a relative path, or by a subpath its package.json "exports" does not list, is reported.',
  },
  'LINE-LAYOUT': {
    id: 'LINE-LAYOUT',
    defaultSeverity: 'error',
    why: 'A Line project keeps its items in the library and in feature folders with a fixed set of kinds, so every item can be found, linked and checked.',
    expected: ['components/, pages/, workflows/, fixtures/, usecases/, services/, domains/ and spec.md inside a feature; the same kinds inside the library'],
    check: 'Entries directly under <library>, <features> and <features>/<name> must be one of the known kinds or allowed files; a project with neither folder is reported once. Once a project has either folder, a source file anywhere else is reported unless it sits at the project root (or directly in src/), in a line.appFolders folder (default app, config, scripts, public, types, test, tests, __tests__, e2e), in Line\'s state folder or a package root, in a test or example folder, or is a page (LINE-OWNER reports those), a test, a story or a .d.ts file.',
  },
});

/**
 * The shared module for each concern (LINE-SHARED). `owners` are package.json names allowed to do the
 * work; `imports`, `strings` and `declares` are the static signals of a copy elsewhere. File writes are
 * a shared concern too, checked by LINE-WRITER. Each project can add owners with `line.sharedOwners`.
 * @type {ReadonlyArray<{id: string, concern: string, module: string, path: string, owners: string[], ownerFiles?: string[], imports?: string[], strings?: string[], declares?: RegExp}>}
 */
export const SHARED_CONCERNS = Object.freeze([
  {
    id: 'ai', concern: 'AI decision-making', module: '@mx/reason',
    path: 'vision-architect-pipeline runs/core-ship/packages/reason',
    owners: ['@mx/reason'],
    imports: ['ollama', '@anthropic-ai/sdk', 'openai', '@google/generative-ai', '@google/genai', 'groq-sdk', '@mistralai/mistralai', 'cohere-ai', '@huggingface/inference', 'node-llama-cpp'],
    strings: [':11434', 'api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'api.groq.com', 'api.mistral.ai'],
  },
  {
    id: 'plan', concern: 'plans and tool calls', module: '@mx/plan',
    path: 'vision-architect-pipeline runs/core-plan-api/packages/plan',
    owners: ['@mx/plan'],
    declares: /^(createPlan|addStep|updateStep|approveStep|approvePlan|runNext|runNextStep|planStatus)$/,
  },
  {
    // Owner decision (2026-10-11): Line's one tool catalog is packages/engine/line/toolRegistry.mjs, which registers
    // its tools into @mx/plan's registry at runtime (planTools.mjs createLinePlanRegistry -> createPlanApi).
    id: 'registry', concern: 'the tool registry', module: 'Line\'s tool catalog (packages/engine/line/toolRegistry.mjs, registered into @mx/plan\'s registry)',
    path: 'construct packages/engine/line/toolRegistry.mjs; vision-architect-pipeline runs/core-plan-api/packages/plan/registry.ts',
    owners: ['@mx/plan'],
    ownerFiles: ['packages/engine/line/toolRegistry.mjs'],
    declares: /^(defineTool|createRegistry|createToolRegistry|registerTool|toolCatalog)$/,
  },
  {
    id: 'summarizer', concern: 'user-facing English', module: 'Construct\'s summarize block (built on Smith)',
    path: 'construct packages/core/summarize.mjs and prose.mjs',
    owners: ['@line/construct-core', 'construct-architecture'],
    imports: ['smith', 'atomic-codemod'],
    declares: /^(toEnglish|toPlainEnglish|plainEnglish|summarizeToEnglish|narrate[A-Z]\w*)$/,
  },
  {
    id: 'matcher', concern: 'page matching', module: 'Trace\'s matcher',
    path: 'construct trace/src: extract.mjs, match.mjs, transforms.mjs, pagemap/classify.mjs, pagemap/collapse.mjs, structural-gate.mjs',
    owners: ['line-matcher'],
    declares: /^(structuralGate|applyStructural|structuralRows|collapsePageMap|classifyPage|matchPages?|pageMap)$/,
  },
  {
    id: 'architecture', concern: 'the architecture check', module: 'construct validate',
    path: 'construct packages/core (validate.mjs, rules/, profiles/)',
    owners: ['@line/construct-core', '@line/construct', 'construct-architecture'],
    imports: ['dependency-cruiser', 'eslint-plugin-boundaries'],
  },
]);

export const LINE_RULE_IDS = Object.freeze(Object.keys(LINE_RULES));

const VALID_SEVERITIES = new Set(['error', 'warning', 'info', 'off']);

function usageError(message) {
  return new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
}

const stringList = (value, field) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    throw usageError(`The "line.${field}" setting in architecture.yml must be a list of path patterns.`);
  }
  return value.map((v) => v.trim());
};

const folder = (value, field) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.includes('..')) {
    throw usageError(`The "line.${field}" setting in architecture.yml must be a folder path inside the project.`);
  }
  return value.trim().replace(/^\.\//, '').replace(/\/+$/, '');
};

/**
 * Normalize `line.sharedOwners`: extra package names allowed to own each shared concern.
 * @param {unknown} raw The raw value (undefined when absent).
 * @returns {Record<string, string[]>} Concern id to extra owner package names.
 */
function normalizeSharedOwners(raw) {
  if (raw === undefined || raw === null) return /** @type {Record<string, string[]>} */ ({});
  if (typeof raw !== 'object' || Array.isArray(raw)) throw usageError('The "line.sharedOwners" setting in architecture.yml must map a concern to a list of package names.');
  const ids = SHARED_CONCERNS.map((c) => c.id);
  const out = /** @type {Record<string, string[]>} */ ({});
  for (const [id, list] of Object.entries(raw)) {
    if (!ids.includes(id)) throw usageError(`"${id}" under line.sharedOwners is not a shared concern; the concerns are ${ids.join(', ')}.`);
    out[id] = stringList(list, `sharedOwners.${id}`);
  }
  return out;
}

/**
 * Normalize architecture.yml's `line:` section. Folder defaults that depend on the disk
 * (`src/` detection) are filled in by checks.mjs's resolveLayout, not here.
 *
 * @param {unknown} raw The raw `line:` value (undefined when absent).
 * @returns {{library?: string, features?: string, state: string, writers: string[], writerExempt: string[], packageRoots: string[], appFolders: string[], sharedOwners: Record<string, string[]>, traceExcludes: string[], rules: Record<string, {severity: string}>}}
 * @throws {ConstructError} A usage error naming the bad field.
 */
export function normalizeLineConfig(raw) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw usageError('The "line" section of architecture.yml must be a mapping.');
  }
  const c = /** @type {Record<string, any>} */ (raw || {});
  const rules = /** @type {Record<string, {severity: string}>} */ ({});
  for (const id of LINE_RULE_IDS) rules[id] = { severity: LINE_RULES[id].defaultSeverity };
  for (const [id, value] of Object.entries(c.rules || {})) {
    if (!(id in LINE_RULES)) throw usageError(`"${id}" under line.rules in architecture.yml is not a Line rule; the Line rules are ${LINE_RULE_IDS.join(', ')}.`);
    const severity = typeof value === 'string' ? value : value?.severity;
    if (!VALID_SEVERITIES.has(severity)) throw usageError(`The severity "${severity}" for ${id} in architecture.yml must be error, warning, info or off.`);
    rules[id] = { severity };
  }
  return {
    library: folder(c.library, 'library'),
    features: folder(c.features, 'features'),
    state: folder(c.state, 'state') ?? 'line',
    writers: stringList(c.writers, 'writers') ?? [],
    writerExempt: stringList(c.writerExempt, 'writerExempt') ?? [...DEFAULT_WRITER_EXEMPT],
    packageRoots: (stringList(c.packageRoots, 'packageRoots') ?? [...DEFAULT_PACKAGE_ROOTS]).map((d) => folder(d, 'packageRoots')),
    appFolders: [...DEFAULT_APP_FOLDERS, ...(stringList(c.appFolders, 'appFolders') ?? []).map((d) => folder(d, 'appFolders'))],
    sharedOwners: normalizeSharedOwners(c.sharedOwners),
    // Import v2: where a route trace stops in this project (path substrings); none unless set.
    traceExcludes: stringList(c.traceExcludes, 'traceExcludes') ?? [],
    rules,
  };
}
