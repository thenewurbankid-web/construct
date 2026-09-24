import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { makeLineSource } from './line-source.mjs';
import { createFeature, generateLayer, generateVertical, layerFromGeneratedFile, fillGeneratedFile } from './generators.mjs';
import { generateServiceFromSpec } from './service-generator.mjs';
import { generateShapeLayer, generateShapeVertical, hasTypedContractsDependency, TYPED_CONTRACTS_SPECIFIER } from './shapes.mjs';
import { write, ensureDir } from './fs.mjs';
import { scaffoldProject } from './scaffold.mjs';
import { loadConfig, findProjectRoot, DEFAULT_RULES, NEW_PROJECT_RULE_SEVERITIES, normalizeFramework } from './config.mjs';
import { formatReport, exitCodeForViolations, ConstructError, EXIT_CODES, setExitCode } from './diagnostics.mjs';
import { aggregateValidation } from './registry.mjs';
import { validateArchitecture } from './architecture-enforcer.mjs';
import { syncPublicApi } from './api-composer.mjs';
import { summarizeUnit, listUnits, unitApiManifest, renderUnitMarkdown } from '../../packages/engine/unitSummary.mjs';
import { analyzeImpact, proposeSeedsFromText, impactApiManifest, renderImpactMarkdown } from '../../packages/engine/impact.mjs';
import { loadTemplateDir, TemplateError } from '../../packages/engine/planTemplate.mjs';
import { prHealth, renderPrHealthMarkdown, prHealthApiManifest } from '../../packages/engine/prHealth.mjs';
import { summarizeProject, summarizeCompact, summarizeProse, summarizeSince } from './summarize.mjs';
import { moveLayerFile, renameLayerFile } from './refactor.mjs';
import { extractExpression } from './extractExpression.mjs';
import { importVertical, importPlan, analyzeFiles, executeImportPlan, autoFixViolations } from './import.mjs';
import { planMechanically } from './mechanical-plan.mjs';
import { reviewImport } from './import-review.mjs';
import { repairRelativeImports } from './import-repair.mjs';
import { resolveRoute } from './route-resolver.mjs';
import { DEFAULT_ENFORCERS } from '../../packages/engine/defaultEnforcers.mjs';
import { runPipeline } from '../../packages/engine/pipeline.mjs';
import { validateEnvelope } from '../../packages/engine/envelope.mjs';
import { ingestPage } from '../../packages/engine/pageTransformer.mjs';
import { generateWorkflow } from '../../packages/engine/workflowGenerator.mjs';
import { generateController } from '../../packages/engine/controllerBinder.mjs';
import { generateFeatureTests } from '../../packages/engine/testGenerator.mjs';
import { generateUnitTests } from '../../packages/engine/testUnitGenerator.mjs';
import { runFeatureTests, renderRunText } from '../../packages/engine/testRunner.mjs';
import { runProofs, renderProofRunText } from '../../packages/engine/proofRunner.mjs';
import { generateProof } from './proof.mjs';
import { generateRouteEntry, addDependency } from './wiring.mjs';
import { startTimer, elapsedSeconds, formatDuration } from './timing.mjs';
import { explainSource, renderExplained } from '../../packages/engine/workflowExplain.mjs';
import { listWorkflowSourceFiles, readWorkflowSource } from '../../packages/engine/workflowSource.mjs';
import { validateMachineSpec, renderMachineSpecReport } from './research/machine-spec.mjs';
import { generateFromSpec } from './research/specToCode.mjs';
import { readTraces } from './decision-trace-store.mjs';
import { registerDecisionProvider } from './decision-provider.mjs';
import { traceStats, replayTraces, renderTraceList, renderTraceStats, renderReplay, DEFAULT_MIN_TRACES } from './decision-trace-replay.mjs';

// Resolve the project root freshly per command: walks up from cwd (or from
// --dir, when given) to find an existing architecture.yml (monorepo
// support), falling back to that starting directory itself (e.g. for
// `construct init`, or a project that hasn't been synced yet). --dir lets a
// command target a Construct project nested in a subdirectory of a larger,
// unrelated project without requiring the caller to `cd` into it first.
function getRoot(args = []) {
  const di = args.indexOf('--dir');
  if (di >= 0 && args[di + 1]) {
    const dir = path.resolve(args[di + 1]);
    return findProjectRoot(dir) ?? dir;
  }
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

// The Construct package's own install directory (not the target project's
// cwd) — enforcer modules live alongside this file, not in the user's repo.
const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Files that mark a module as "available" for construct doctor. These are
// existence checks only (never imports), so they report accurately even
// before the owning module has landed in the working tree.
const ENFORCER_MODULES = [
  { name: 'architecture-enforcer', file: 'architecture-enforcer.mjs' },
  { name: 'soc-enforcer', file: 'soc-enforcer.mjs' },
  { name: 'api-composer', file: 'api-composer.mjs' },
  { name: 'readability-enforcer', file: 'readability-enforcer.mjs' },
  { name: 'summarize', file: 'summarize.mjs' },
];

const INIT_HELP = `Usage: construct init [dir] [--framework nextjs|react-spa] [--no-scaffold]

Writes architecture.yml, AGENTS.md, the core feature and the framework's entry file(s).
Also lays down a minimal runnable project shell (package.json with dev/build scripts,
tsconfig.json, bundler config, .gitignore) so \`npm install && npm run dev\` works next.
Static files only: no network, no npm install. An existing file is never overwritten.

  --framework <name>  nextjs (default) | react-spa
  --no-scaffold       skip the project shell; write only the Construct files`;

// `construct init [dir] [--framework nextjs|react-spa]` — the entry-point
// scaffold this writes is the one genuinely framework-specific part of
// init: nextjs gets a physical app/page.tsx (Next.js's own file-system
// routing); react-spa gets src/main.tsx (the real Vite/CRA-style bootstrap
// entry) + src/App.tsx (the centralized react-router table #65/#66/#67
// treat as that framework's "route" layer) with the core feature's
// controller actually registered in it — not just a page.tsx clone. Framework
// defaults to nextjs when --framework is omitted, so every existing caller
// of `construct init` keeps getting exactly what it got before.
/**
 * `construct init [dir] [--framework nextjs|react-spa] [--no-scaffold]`: write `architecture.yml` and `AGENTS.md`, then scaffold the `core` feature, then (unless `--no-scaffold`) a minimal runnable project shell that never overwrites an existing file (#497). The entry-point scaffold is the one framework-specific part: `nextjs` (the default) gets `app/page.tsx`; `react-spa` gets `src/main.tsx` and `src/App.tsx` with the core controller registered in the router table.
 *
 * @param {string[]} args Command arguments: an optional target directory, then optional `--framework <name>`.
 * @returns {Promise<void>} Resolves once the files are written (prints what it wrote).
 * @since 0.8
 *
 * @example
 * await init(['my-app', '--framework', 'react-spa']);
 */
export async function init(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(INIT_HELP);
    return;
  }
  const dir = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
  const fi = args.indexOf('--framework');
  const framework = normalizeFramework(fi >= 0 ? args[fi + 1] : undefined);
  ensureDir(dir);
  // Only real severity-bearing rules get a scaffolded `<id>: <severity>` line — a
  // numeric-override entry like READ-002-max-loc (see config.mjs's DEFAULT_RULES) has
  // no severity to print and is left out entirely; the project inherits its default
  // (200) until someone opts into an override themselves.
  const arch = `version: 1\npreset: strict-nextjs\n\nproject:\n  framework: ${framework}\n  language: typescript\n\nfeatures:\n  root: features\n\nrules:\n${Object.entries(DEFAULT_RULES).filter(([, v]) => !v.numeric).map(([k, v]) => `  ${k}: ${NEW_PROJECT_RULE_SEVERITIES[k] ?? v.severity}`).join('\n')}\n\nexceptions: []\n`;
  write(path.join(dir, 'architecture.yml'), arch);
  write(path.join(dir, 'AGENTS.md'), `# Construct\n\nRead architecture.yml before changing code.\n\nDefault flow: Route → Controller → Workflow → Service → API; Controller → Page → Component.\n\nPages: no business logic, workflows, services, API calls, or fetch.\nComponents: presentation/local UI state only.\nFeatures: isolated; cross-feature access goes through index.ts.\nDomain: pure by default. Services: external effects.\n\nRun \`construct validate\` before finishing changes.\n`);
  createFeature(dir, 'core');
  if (framework === 'react-spa') {
    ensureDir(path.join(dir, 'src'));
    write(
      path.join(dir, 'src', 'main.tsx'),
      `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { BrowserRouter } from 'react-router-dom';\nimport { App } from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <BrowserRouter>\n      <App />\n    </BrowserRouter>\n  </React.StrictMode>,\n);\n`,
    );
    write(
      path.join(dir, 'src', 'App.tsx'),
      `import { Routes, Route } from 'react-router-dom';\nimport { CoreController } from '../features/core/controllers/CoreController';\n\nexport function App() {\n  return (\n    <Routes>\n      <Route path="/" element={<CoreController />} />\n    </Routes>\n  );\n}\n`,
    );
  } else {
    ensureDir(path.join(dir, 'app'));
    write(path.join(dir, 'app', 'page.tsx'), `import { CoreController } from '../features/core/controllers/CoreController';\n\nexport default function Page() {\n  return <CoreController />;\n}\n`);
  }
  console.log(`Initialized Construct in ${dir} (framework: ${framework})`);
  // #497: a runnable project shell (package.json, tsconfig, bundler config, ...) unless --no-scaffold.
  if (args.includes('--no-scaffold')) return;
  const { written, skipped } = scaffoldProject(dir, framework);
  if (written.length) console.log(`Scaffolded ${written.length} project file(s): ${written.join(', ')}`);
  if (skipped.length) console.log(`Kept existing (not overwritten): ${skipped.join(', ')}`);
  if (written.includes('package.json')) {
    const rel = path.relative(process.cwd(), dir);
    console.log(`Next: ${rel ? `cd ${/\s/.test(rel) ? JSON.stringify(rel) : rel} && ` : ''}npm install && npm run dev`);
  } else {
    console.log('Next: add the dependencies your framework needs to your existing package.json, then run your dev script.');
  }
  console.log('Note: the entry file imports features/core/controllers/CoreController, which does not exist yet; generate it (construct generate layer core --feature core --layers domain,service,workflow,hook,component,page,controller) or `construct validate` and the dev server will report the unresolved import.');
}

export async function feature(args) {
  if (args[0] !== 'create' || !args[1]) {
    throw new ConstructError('Usage: construct feature create <name>', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const t = startTimer();
  const p = createFeature(root, args[1]);
  console.log(`Created feature ${args[1]} at ${path.relative(root, p)} (${formatDuration(elapsedSeconds(t))})`);
}

// Ticket 7.2/7.3/7.4/7.5's `--from`/`--bind`/`--openapi` paths below are all
// zero-LLM: they compile a real input (JSX export, JSON state graph, an
// already-generated Props interface, an OpenAPI spec) deterministically via
// the packages/engine/* modules or service-generator.mjs. `--llm <provider>`
// (optional, mirrors `construct import`'s flag) only applies to the plain
// fallback path at the bottom of this function: when given, it calls that
// provider once to write a real implementation in place of the template
// stub — scoped strictly to that one file's own body (generators.mjs's
// fillGeneratedFile). Which layers/files get created is decided the exact
// same deterministic way regardless of --llm; the flag only changes what
// ends up *inside* a file generate() was already going to create via the
// plain stub path. Omitting --llm leaves the scaffolded template stub
// exactly as before this existed.
// #348: `construct generate tests <feature> [--dry-run] [--prune]` writes one LOCKED Playwright spec per
// workflow scenario into features/<feature>/tests/generated/ (see engine/testGenerator.mjs).
// #583: `--unit` writes one LOCKED every-path unit test per machine instead (engine/testUnitGenerator.mjs):
// @xstate/graph walks the machine under node's test runner, no browser.
function generateTests(args) {
  const feature = args.slice(1).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--dir');
  if (!feature) {
    throw new ConstructError('Usage: construct generate tests [--unit] <feature> [--dry-run] [--prune] [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const t = startTimer();
  const dry = args.includes('--dry-run') ? ' (dry run, nothing written)' : '';
  if (args.includes('--unit')) {
    const r = generateUnitTests(root, feature, { dryRun: args.includes('--dry-run'), prune: args.includes('--prune') });
    for (const f of r.written) console.log(`Wrote ${f}${dry}`);
    for (const f of r.unchanged) console.log(`Unchanged ${f}`);
    for (const f of r.pruned) console.log(`Pruned ${f}${dry}`);
    for (const f of r.orphans.filter((o) => !r.pruned.includes(o))) console.log(`Orphan ${f} (no machine produces it any more; --prune removes it)`);
    for (const sk of r.skipped) console.log(`Skipped machine "${sk.machine}" in ${sk.file}: ${sk.reason}`);
    const sum = r.files.reduce((n, f) => n + f.transitions, 0);
    console.log(`${r.files.length} every-path test(s) for feature "${feature}" (${r.written.length} written, ${r.unchanged.length} unchanged; ${sum} transition(s) checked) (${formatDuration(elapsedSeconds(t))})`);
    if (r.missingDependencies.length) console.log(`Note: the test needs ${r.missingDependencies.join(', ')} in this project: npm install -D ${r.missingDependencies.join(' ')}`);
    if (r.files.length) console.log(`Run: npx tsx --test ${r.files.map((f) => f.relPath).join(' ')}`);
    return;
  }
  const r = generateFeatureTests(root, feature, { dryRun: args.includes('--dry-run'), prune: args.includes('--prune') });
  for (const f of r.written) console.log(`Wrote ${f}${dry}`);
  for (const f of r.unchanged) console.log(`Unchanged ${f}`);
  for (const f of r.pruned) console.log(`Pruned ${f}${dry}`);
  for (const f of r.orphans.filter((o) => !r.pruned.includes(o))) console.log(`Orphan ${f} (no scenario produces it any more; --prune removes it)`);
  for (const sk of r.skipped) console.log(`Skipped machine "${sk.machine}" in ${sk.file}: ${sk.reason}`);
  if (r.truncated) console.log('Note: a machine has more scenarios than the enumeration limit; only the first were generated.');
  const todo = r.files.filter((f) => f.needs.length).length;
  console.log(`${r.files.length} spec(s) for feature "${feature}" (${r.written.length} written, ${r.unchanged.length} unchanged; ${todo} pending a fixture), start URL ${r.route ?? 'TODO (no route reaches this feature)'} (${formatDuration(elapsedSeconds(t))})`);
}

/**
 * The `--shape <name> [--entity <Entity>] [--fields a:string,b:number]` request of a create/generate command (#619), or `null` when
 * no shape was asked for. `--entity` and `--fields` mean nothing without `--shape`, and a shape is deterministic, so `--llm` is refused.
 */
function shapeRequestOf(args, name, feature) {
  const shape = flagValue(args, '--shape');
  if (shape === undefined) {
    const stray = ['--entity', '--fields'].find((f) => args.includes(f));
    if (stray) throw new ConstructError(`${stray} only applies with --shape, for example --shape list.`, { exitCode: EXIT_CODES.USAGE_ERROR });
    return null;
  }
  if (args.includes('--llm')) throw new ConstructError('--shape writes real code from typed templates with no model, so it cannot be combined with --llm. Run it without --llm.', { exitCode: EXIT_CODES.USAGE_ERROR });
  return { shape, name, feature, entity: flagValue(args, '--entity'), fields: flagValue(args, '--fields') };
}

/** One output line per file a shape wrote: `types.ts` is appended to (`Updated`), every other file is new (`Created`). */
const shapeLine = (root, file, dt) => `${path.basename(file) === 'types.ts' ? 'Updated' : 'Created'} ${path.relative(root, file)} (${dt})`;

/** After a shape wrote files that import the typed-contracts package, say so once when the project does not depend on it yet. */
function printTypedContractsNote(root) {
  if (!hasTypedContractsDependency(root)) console.log(`Note: the generated units import ${TYPED_CONTRACTS_SPECIFIER}: add "@line/construct-core" to your package.json dependencies before you build or type-check.`);
}

/**
 * The request of `construct create proof <Name> --feature <f> [--shape list] [--entity <E>] [--fields a:string,...] [--kind render|playwright] [--route </path>]` (#623).
 * A proof is deterministic like the shape it proves, so `--llm` is refused.
 */
function proofRequestOf(args) {
  const name = args[1];
  const feature = flagValue(args, '--feature');
  if (!name || name.startsWith('--') || !feature) throw new ConstructError('Usage: construct create proof <Name> --feature <feature> [--shape list] [--entity <Entity>] [--fields id:string,...] [--kind render|playwright] [--route </path>] [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  if (args.includes('--llm')) throw new ConstructError('A proof is written from typed templates with no model, so it cannot be combined with --llm. Run it without --llm.', { exitCode: EXIT_CODES.USAGE_ERROR });
  return { name, feature, shape: flagValue(args, '--shape'), entity: flagValue(args, '--entity'), fields: flagValue(args, '--fields'), kind: flagValue(args, '--kind'), route: flagValue(args, '--route') };
}

/** `construct create proof <Name> --feature <f> ...` (#623): write the locked proof of a shaped screen, or say why nothing was written. */
function generateProofFiles(args) {
  const root = getRoot(args);
  const t = startTimer();
  const request = proofRequestOf(args);
  const result = generateProof(root, request);
  const dt = formatDuration(elapsedSeconds(t));
  for (const key of result.regions) console.log(`Updated architecture.yml (declared ${key}: for the generated tests)`);
  for (const file of result.files) console.log(`Created ${path.relative(root, file)} (${dt})`);
  if (result.skipped) console.log(`Skipped: ${result.skipped}`);
  else if (result.kind === 'render') console.log(`Needs ${result.needs.join(', ')} in the project (esbuild comes with tsx and with vite). Run: construct test proof ${request.feature}`);
  else console.log(`Run it against your running app: construct test run ${request.feature} --area generated`);
}

/** The result document of `create proof` for `--format json`: the files written (project-relative), the regions declared and why anything was skipped. */
function proofDocument(args, attribution) {
  const root = getRoot(args);
  const request = proofRequestOf(args);
  const result = generateProof(root, request);
  return { verb: 'create', kind: 'proof', feature: request.feature, name: request.name, proofKind: result.kind, files: result.files.map((f) => path.relative(root, f)), regions: result.regions, skipped: result.skipped, needs: result.needs, attribution };
}

/** The request of `construct create route <Name> --feature <f> [--route </path>]` (#654): wire the controller of a generated screen into the route entry. No model, so `--llm` is refused. */
function routeRequestOf(args) {
  const name = args[1];
  const feature = flagValue(args, '--feature');
  if (!name || name.startsWith('--') || !feature) throw new ConstructError('Usage: construct create route <Name> --feature <feature> [--route </path>] [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  if (args.includes('--llm')) throw new ConstructError('The route entry is written from a fixed template with no model, so it cannot be combined with --llm. Run it without --llm.', { exitCode: EXIT_CODES.USAGE_ERROR });
  return { name, feature, route: flagValue(args, '--route') };
}

/** `construct create route <Name> --feature <f>` (#654): point the project's route entry at the controller, or say there was nothing to do. */
function generateRouteFiles(args) {
  const root = getRoot(args);
  const t = startTimer();
  const request = routeRequestOf(args);
  const result = generateRouteEntry(root, request);
  const dt = formatDuration(elapsedSeconds(t));
  for (const id of result.removed) console.log(result.framework === 'react-spa' ? `Removed the dangling import of ${id} from ${result.file}` : `Removed ${id} (the init scaffold's page, which rendered a controller that was never generated)`);
  console.log(result.changed ? `${result.framework === 'react-spa' ? 'Updated' : 'Created'} ${result.file} (${dt}): ${result.route} renders ${request.name}Controller` : `Unchanged ${result.file}: ${result.route} already renders ${request.name}Controller`);
}

/** The result document of `create route` for `--format json`. */
function routeDocument(args, attribution) {
  const root = getRoot(args);
  const request = routeRequestOf(args);
  const result = generateRouteEntry(root, request);
  return { verb: 'create', kind: 'route', feature: request.feature, name: request.name, route: result.route, framework: result.framework, files: result.changed ? [result.file] : [], removed: result.removed, attribution };
}

/** The request of `construct create dependency <package> --version <range>` (#654): one line in package.json, no package manager. */
function dependencyRequestOf(args) {
  const name = args[1];
  const version = flagValue(args, '--version');
  if (!name || name.startsWith('--') || !version) throw new ConstructError('Usage: construct create dependency <package> --version <range> [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  return { name, version };
}

/** `construct create dependency @line/construct-core --version ^0.9.0` (#654): add the line to package.json; never installs. */
function generateDependencyLine(args) {
  const result = addDependency(getRoot(args), dependencyRequestOf(args));
  console.log(result.changed ? `Updated ${result.file}: added ${result.line} to dependencies. Nothing is installed: run your package manager.` : `Unchanged ${result.file}: ${result.line.split(':')[0]} is already a dependency.`);
}

/** The result document of `create dependency` for `--format json`. */
function dependencyDocument(args, attribution) {
  const result = addDependency(getRoot(args), dependencyRequestOf(args));
  return { verb: 'create', kind: 'dependency', line: result.line, files: result.changed ? [result.file] : [], attribution };
}

/**
 * `construct generate <layer> <name> --feature <f>` and its siblings: one layer file, `layer <name> --layers ...` for a whole
 * slice, or `tests <feature>`. `--shape list [--entity E] [--fields a:string,...]` (#619) fills the units with real typed code for
 * a named screen shape instead of the stub template; the other forms are described where they are handled below.
 *
 * @param {string[]} args The words after `generate` (or `create`).
 * @returns {Promise<void>} Resolves once the files are written and printed.
 *
 * @example
 * await generate(['layer', 'Products', '--feature', 'shop', '--layers', 'domain,service', '--shape', 'list']);
 */
export async function generate(args) {
  if (args[0] === 'tests') return generateTests(args);
  if (args[0] === 'layer') return generateVerticalSlice(args);
  if (args[0] === 'proof') return generateProofFiles(args);
  if (args[0] === 'route') return generateRouteFiles(args);
  if (args[0] === 'dependency') return generateDependencyLine(args);
  const layer = args[0], name = args[1], fi = args.indexOf('--feature');
  if (!layer || !name || fi < 0 || !args[fi + 1]) {
    throw new ConstructError('Usage: construct generate <layer> <name> --feature <feature> [--openapi <spec>] [--llm <provider>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const feature = args[fi + 1];
  // #619: `--shape list` fills the unit with real, typed code for the shape instead of the stub template.
  const shaped = shapeRequestOf(args, name, feature);
  if (shaped) {
    const t = startTimer();
    const files = generateShapeLayer(root, { ...shaped, layer });
    const dt = formatDuration(elapsedSeconds(t));
    for (const file of files) console.log(shapeLine(root, file, dt));
    printTypedContractsNote(root);
    return;
  }
  // Ticket 7.2 (#112): `construct create/generate page <name> --feature <f> --from
  // <path>` ingests an externally-authored JSX file (e.g. a Subframe export) instead
  // of scaffolding the usual stub template -- see packages/engine/pageTransformer.mjs.
  const fromI = args.indexOf('--from');
  if (layer === 'page' && fromI >= 0 && args[fromI + 1]) {
    const t = startTimer();
    const { pageFile, propsFile, slots } = ingestPage(root, name, feature, args[fromI + 1]);
    const dt = formatDuration(elapsedSeconds(t));
    console.log(`Created ${path.relative(root, pageFile)} (${dt})`);
    console.log(`Created ${path.relative(root, propsFile)} (${dt}, ${slots.length} slot(s): ${slots.map((s) => s.name).join(', ') || 'none'})`);
    return;
  }
  // Ticket 7.3 (#113): `construct create/generate workflow <name> --feature <f>
  // --from <path-to-json>` compiles a JSON state-graph descriptor into an XState v5
  // machine file instead of scaffolding the usual stub template -- see
  // packages/engine/workflowGenerator.mjs. Mirrors the page ingestion --from convention.
  if (layer === 'workflow' && fromI >= 0 && args[fromI + 1]) {
    const descriptorPath = path.isAbsolute(args[fromI + 1]) ? args[fromI + 1] : path.resolve(args[fromI + 1]);
    if (!fs.existsSync(descriptorPath)) {
      throw new ConstructError(`Workflow descriptor not found: ${descriptorPath}`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
    let descriptor;
    try {
      descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    } catch (e) {
      throw new ConstructError(`Malformed workflow descriptor JSON at ${descriptorPath}: ${e.message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
    const t = startTimer();
    // #580: opt-in `--state-union` also emits <Name>WorkflowState.ts (typed state union + exhaustive matcher).
    const { file, events, stateFile } = generateWorkflow(root, name, feature, descriptor, { stateUnion: args.includes('--state-union') });
    console.log(`Created ${path.relative(root, file)} (${formatDuration(elapsedSeconds(t))}, ${events.length} event(s): ${events.join(', ') || 'none'})`);
    if (stateFile) console.log(`Created ${path.relative(root, stateFile)} (typed state union + exhaustive matcher)`);
    return;
  }
  // Ticket 7.4 (#114): `construct create/generate controller <name> --feature <f>
  // --bind [--envelope <path>]` auto-wires an already-generated hook (7.3) into an
  // already-generated pristine page's Props interface (7.2) via AST signature matching,
  // instead of scaffolding the usual same-named-page-only stub template. Opt-in via
  // --bind so the existing unconditional stub (and `generate layer ... --layers ...
  // controller`, which relies on it needing no prerequisite files) is unchanged.
  const bindI = args.indexOf('--bind');
  if (layer === 'controller' && bindI >= 0) {
    const envelopeI = args.indexOf('--envelope');
    let envelope;
    if (envelopeI >= 0 && args[envelopeI + 1]) {
      const envelopePath = path.isAbsolute(args[envelopeI + 1]) ? args[envelopeI + 1] : path.resolve(args[envelopeI + 1]);
      if (!fs.existsSync(envelopePath)) {
        throw new ConstructError(`Context Envelope not found: ${envelopePath}`, { exitCode: EXIT_CODES.USAGE_ERROR });
      }
      try {
        envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
      } catch (e) {
        throw new ConstructError(`Malformed Context Envelope JSON at ${envelopePath}: ${e.message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
      }
    }
    const t = startTimer();
    const { file, bindings } = generateController(root, name, feature, { envelope });
    console.log(`Created ${path.relative(root, file)} (${formatDuration(elapsedSeconds(t))})`);
    for (const b of bindings) {
      console.log(`  ${b.slot} -> ${b.handler ? `${b.handler} (${b.matchType})` : 'UNMATCHED (TODO stub written)'}`);
    }
    return;
  }
  // Ticket 7.5 (#115): `construct create/generate service <name> --feature <f>
  // --openapi <spec>` compiles an OpenAPI spec into a real RTKQ injectEndpoints
  // file plus the shared transport client, instead of scaffolding the usual stub
  // template -- see packages/core/service-generator.mjs.
  const oi = args.indexOf('--openapi');
  if (layer === 'service' && oi >= 0 && args[oi + 1]) {
    const t = startTimer();
    const files = await generateServiceFromSpec(root, name, feature, args[oi + 1]);
    const dt = formatDuration(elapsedSeconds(t));
    for (const file of files) console.log(`Created ${path.relative(root, file)} (${dt})`);
    return;
  }
  // Plain fallback: scaffold the usual template stub, optionally LLM-filled
  // (see this function's own doc comment above for the --llm contract).
  const llmI = args.indexOf('--llm');
  const llm = llmI >= 0 ? args[llmI + 1] : undefined;
  const scaffoldStart = startTimer();
  const file = generateLayer(root, layer, name, feature);
  const scaffoldSeconds = elapsedSeconds(scaffoldStart);
  if (llm) {
    const llmStart = startTimer();
    const outcome = await fillGeneratedFile(root, file, layer, { feature, name, llm });
    reportFill(root, outcome, ` (scaffold ${formatDuration(scaffoldSeconds)}, llm ${formatDuration(elapsedSeconds(llmStart))})`);
  } else {
    console.log(`Created ${path.relative(root, file)} (${formatDuration(scaffoldSeconds)})`);
  }
}

// One line per generated file for a --llm fill (#144/#141): "Created +
// LLM-filled" only when the model's output was actually written; otherwise
// the scaffolded stub was left as-is and the line says why. A rejected/failed
// fill sets a non-zero exit code so scripts and the UI notice, but never
// aborts the rest of a batch.
function reportFill(root, { file, status, reason, fixCommand }, timingNote = '') {
  const rel = path.relative(root, file);
  if (status === 'filled') {
    console.log(`Created + LLM-filled ${rel}${timingNote}`);
    if (fixCommand) printExtractExpressionHint(fixCommand);
    return;
  }
  const what = status === 'rejected' ? "the model's output was rejected" : 'the LLM call failed';
  console.log(`Created ${rel} (stub kept — ${what}: ${reason})${timingNote}`);
  setExitCode(EXIT_CODES.INTERNAL_ERROR);
}

// #522 -- printed right after a --llm fill whose own output trips PAGE-008/COMPONENT-005 (inline
// conditional/loop JSX): names the deterministic block (`construct refactor extract-expression`,
// packages/core/extractExpression.mjs, #517) that fixes it mechanically, so a human or a bot
// reading this output reaches for that block next instead of hand-writing the extraction.
function printExtractExpressionHint(fixCommand) {
  console.log(`  Note: the model's own output has inline conditional/loop JSX (PAGE-008/COMPONENT-005) — run \`${fixCommand}\` to extract it into a compliant Expression mechanically, rather than hand-editing.`);
}

// `construct generate layer <name> --feature <feature> --layers <l1,l2,...>
// [--llm <provider>]` scaffolds one logical unit across several layers in a
// single command, always in dependency order (see generators.mjs's
// LAYER_ORDER) regardless of the order --layers lists them in. `--llm`
// applies uniformly to every generated file in the unit, same as import's
// per-file fill does across a whole plan.
async function generateVerticalSlice(args) {
  const name = args[1], fi = args.indexOf('--feature'), li = args.indexOf('--layers');
  if (!name || fi < 0 || !args[fi + 1] || li < 0 || !args[li + 1]) {
    throw new ConstructError(
      'Usage: construct generate layer <name> --feature <feature> --layers <layer1,layer2,...> [--llm <provider>]',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  const feature = args[fi + 1];
  const layers = args[li + 1].split(',').map((l) => l.trim()).filter(Boolean);
  const shaped = shapeRequestOf(args, name, feature);
  if (shaped) {
    const totalStart = startTimer();
    const written = generateShapeVertical(root, shaped, layers, {
      onLayer: ({ files, elapsedSeconds: dt }) => { for (const file of files) console.log(shapeLine(root, file, formatDuration(dt))); },
    });
    console.log(`Total: ${formatDuration(elapsedSeconds(totalStart))} (${written.length} file(s))`);
    printTypedContractsNote(root);
    return;
  }
  const llmI = args.indexOf('--llm');
  const llm = llmI >= 0 ? args[llmI + 1] : undefined;
  // Per-layer scaffold timing comes from generateVertical's own onLayer hook
  // (so it reflects each layer's real write, not a guess) -- the LLM fill
  // (if any) happens in this loop afterward, same as before, timed
  // separately so its cost is never hidden inside the scaffold number.
  const totalStart = startTimer();
  const scaffoldSeconds = new Map();
  const files = generateVertical(root, name, feature, layers, {
    onLayer: ({ file, elapsedSeconds: dt }) => scaffoldSeconds.set(file, dt),
  });
  for (const file of files) {
    const scaffoldDt = scaffoldSeconds.get(file) ?? 0;
    if (llm) {
      const llmStart = startTimer();
      const outcome = await fillGeneratedFile(root, file, layerFromGeneratedFile(file), { feature, name, llm });
      reportFill(root, outcome, ` (scaffold ${formatDuration(scaffoldDt)}, llm ${formatDuration(elapsedSeconds(llmStart))})`);
    } else {
      console.log(`Created ${path.relative(root, file)} (${formatDuration(scaffoldDt)})`);
    }
  }
  console.log(`Total: ${formatDuration(elapsedSeconds(totalStart))}`);
}

function featureNames(root, config) {
  const dir = path.join(root, config.features.root || 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function sync(args) {
  const root = getRoot(args);
  const c = loadConfig(root);
  write(path.join(root, '.dependency-cruiser.cjs'), `module.exports={forbidden:[{name:'page-to-workflow',from:{path:'features/.*/pages'},to:{path:'features/.*/workflows'},severity:'error'},{name:'page-to-service',from:{path:'features/.*/pages'},to:{path:'features/.*/services'},severity:'error'},{name:'component-to-app-logic',from:{path:'features/.*/components'},to:{path:'features/.*/(controllers|workflows|services|domain)'},severity:'error'}]};\n`);
  let apiSynced = 0;
  for (const name of featureNames(root, c)) {
    const { changed } = syncPublicApi(root, name);
    if (changed) apiSynced++;
  }
  console.log(`Synced ${Object.keys(c.rules).length} Construct rules, ${apiSynced} feature public API(s) updated.`);
}

export async function validate(args) {
  const root = getRoot(args);
  const { violations, ok } = aggregateValidation(root, DEFAULT_ENFORCERS);
  const fi = args.indexOf('--format');
  const format = fi >= 0 && args[fi + 1] === 'json' ? 'json' : 'text';
  console.log(formatReport(violations, { format }));
  if (!ok) setExitCode(exitCodeForViolations(violations));
}

const UNIT_VALUE_FLAGS = new Set(['--dir', '--feature', '--format', '--since', '--kind', '--detail', '--include']);
const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positionalOf = (args) => args.find((a, i) => !a.startsWith('--') && !UNIT_VALUE_FLAGS.has(args[i - 1]));

/** `construct summarize <unit-ref> [--kind K] [--detail brief|standard|full] [--include a,b] [--format json|markdown]`,
 * `construct summarize --list [--kind K]`, `construct summarize --usage`. Deterministic unit summaries for bots and
 * humans (packages/engine/unitSummary.mjs); errors are structured JSON on stdout with a non-zero exit code. */
function summarizeUnitCommand(args, root, ref) {
  const format = flagValue(args, '--format') === 'markdown' || flagValue(args, '--format') === 'md' ? 'markdown' : 'json';
  const kind = flagValue(args, '--kind');
  let result;
  if (args.includes('--usage')) result = { ok: true, manifest: unitApiManifest() };
  else if (args.includes('--list')) result = listUnits(root, { kind });
  else {
    const include = flagValue(args, '--include');
    result = summarizeUnit(root, ref, { detail: flagValue(args, '--detail') || 'standard', kind, ...(include ? { include: include.split(',').map((s) => s.trim()) } : {}) });
  }
  console.log(result.manifest ? JSON.stringify(result.manifest, null, 2) : format === 'markdown' ? renderUnitMarkdown(result) : JSON.stringify(result, null, 2));
  if (!result.ok) setExitCode(result.error.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR);
}

export async function summarize(args) {
  const root = getRoot(args);
  const ref = positionalOf(args);
  const legacy = ['--feature', '--since'].some((f) => args.includes(f)) || ['compact', 'prose', 'md'].includes(flagValue(args, '--format'));
  if (!legacy && (ref || ['--list', '--usage', '--kind', '--detail', '--include'].some((f) => args.includes(f)))) return summarizeUnitCommand(args, root, ref);
  const fi = args.indexOf('--feature');
  const feature = fi >= 0 ? args[fi + 1] : undefined;
  const ff = args.indexOf('--format');
  const format = ff >= 0 ? args[ff + 1] : 'json';
  const si = args.indexOf('--since');
  const output = si >= 0
    ? summarizeSince(root, args[si + 1], { format })
    : format === 'compact'
      ? summarizeCompact(root, { feature })
      : format === 'prose'
        ? summarizeProse(root, { feature })
        : summarizeProject(root, { feature, format });
  console.log(output);
}

/** Read all of stdin to completion as a UTF-8 string — used by `construct
 * pipeline run`, which (unlike every other command) takes its real input as
 * a JSON payload over stdin rather than as CLI args. */
function readStdin(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

/** `construct pipeline run [--dir <path>]` -- Ticket 7.1. Reads a Context
 * Envelope (schemas/envelope.v1.json) as JSON off stdin, with an optional
 * `steps: [{layer, name}, ...]` list of generator steps to run against
 * `envelope.feature`. Every step's output is staged in one
 * transactionalWriter transaction and committed atomically: if the buffered
 * result fails `construct validate`'s own enforcer set, nothing under the
 * project root is written and the process exits non-zero. Either way, the
 * resulting envelope (status 'committed' or 'aborted', `layers`/
 * `diagnostics` populated accordingly) is written to stdout as JSON --
 * mirroring the same `JSON.stringify(..., null, 2)` shaping `validate
 * --format json` and `summarize --format json` already use, not a second
 * JSON convention. */
export async function pipeline(args) {
  if (args[0] !== 'run') {
    throw new ConstructError('Usage: construct pipeline run < envelope.json', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const raw = await readStdin(process.stdin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    throw new ConstructError(`Malformed envelope JSON on stdin: ${e.message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const { valid, errors } = validateEnvelope(input);
  if (!valid) {
    throw new ConstructError(`Invalid Context Envelope on stdin:\n  ${errors.join('\n  ')}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }

  const output = runPipeline(root, input);
  console.log(JSON.stringify(output, null, 2));
  if (output.status === 'aborted') setExitCode(exitCodeForViolations(output.diagnostics));
}

const TRACES_USAGE = 'Usage: construct traces list [--chooser <id>] [--limit <n>] [--json] | stats [--chooser <id>] [--json] | replay --provider <name> [--chooser <id>] [--min-traces <n>] [--baseline <name>] [--plugin <file.mjs>] [--json] [--dir <path>]';
const TRACES_VALUE_FLAGS = new Set(['--chooser', '--limit', '--provider', '--baseline', '--min-traces', '--plugin', '--dir', '--format']);

/**
 * `construct traces list|stats|replay` (#643): read-only, deterministic, no model and no network. The traces are the
 * `decision-trace.v1` records the chain wrote to this project's state directory (docs/DECISION-TRACES.md).
 *
 *   list [--chooser <id>] [--limit <n>]     the recorded decisions
 *   stats [--chooser <id>]                  counts per chooser, acceptance rate of suggestions, per provider
 *   replay --provider <name> [--chooser <id>] [--min-traces <n>] [--baseline <name>] [--plugin <file.mjs>]
 *                                           score a provider on the recorded summaries against the `rules` baseline
 *
 * `--json` (or `--format json`) prints one JSON document. `--plugin <file.mjs>` imports a module that registers a decision
 * provider (it calls `registerDecisionProvider`, or default-exports `{ name, suggest }`); code you name yourself, run
 * locally, so it is as trusted as any script you run. A provider that is not registered is a usage error (exit 2).
 *
 * @param {string[]} args `list`, `stats` or `replay` followed by its flags.
 * @returns {Promise<void>} Resolves after printing the report.
 * @throws {ConstructError} Usage error (exit code 2) for an unknown subcommand, a missing or unknown provider, or a bad number.
 *
 * @example
 * await traces(['replay', '--provider', 'rules', '--json']);
 */
export async function traces(args) {
  const usage = (message) => new ConstructError(`${message}\n${TRACES_USAGE}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  const sub = args.find((a, i) => !a.startsWith('--') && !TRACES_VALUE_FLAGS.has(args[i - 1]));
  if (!['list', 'stats', 'replay'].includes(sub)) throw usage(sub ? `Unknown traces command "${sub}".` : 'Say what to do with the traces.');
  const json = args.includes('--json') || flagValue(args, '--format') === 'json';
  const chooser = flagValue(args, '--chooser');
  const count = (name, fallback) => {
    const raw = flagValue(args, name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw usage(`${name} must be a whole number (got ${JSON.stringify(raw)}).`);
    return Number(raw);
  };
  const root = getRoot(args);
  const read = readTraces(root);
  const decisions = chooser ? read.decisions.filter((d) => d.chooser.id === chooser) : read.decisions;
  const print = (doc, text) => console.log(json ? JSON.stringify(doc, null, 2) : text);
  const notes = [
    ...(read.enabled ? [] : ['Recording is off for this project (traces: off in architecture.yml); what was recorded earlier is shown.']),
    ...(read.skipped ? [`${read.skipped} unreadable line(s) skipped.`] : []),
    ...(read.error ? [`Could not read the traces: ${read.error}`] : []),
  ];
  const withNotes = (text) => [text, ...(notes.length ? ['', ...notes] : [])].join('\n');
  if (sub === 'list') {
    const limit = count('--limit');
    print({ ok: true, enabled: read.enabled, total: decisions.length, skipped: read.skipped, decisions: limit ? decisions.slice(-limit) : decisions }, withNotes(`${renderTraceList(decisions, { limit })}\n(${read.dir})`));
  } else if (sub === 'stats') {
    const stats = traceStats(decisions);
    print({ ok: true, enabled: read.enabled, skipped: read.skipped, ...stats }, withNotes(renderTraceStats(stats)));
  } else {
    const provider = flagValue(args, '--provider');
    if (!provider) throw usage('replay needs --provider <name>.');
    const plugin = flagValue(args, '--plugin');
    if (plugin) {
      let mod;
      try {
        mod = await import(pathToFileURL(path.resolve(plugin)).href);
      } catch (e) {
        throw usage(`Could not load the plugin ${plugin}: ${String(e?.message ?? e).split('\n')[0]}`);
      }
      const def = mod.default;
      if (def && typeof def === 'object' && typeof def.name === 'string' && typeof def.suggest === 'function') registerDecisionProvider(def.name, def);
    }
    const report = await replayTraces(decisions, { provider, baseline: flagValue(args, '--baseline'), chooser, minTraces: count('--min-traces', DEFAULT_MIN_TRACES) });
    if (!report.ok) {
      if (json) console.log(JSON.stringify(report, null, 2));
      throw usage(report.error);
    }
    print({ ...report, enabled: read.enabled, skipped: read.skipped }, withNotes(renderReplay(report)));
  }
}

/**
 * `construct doctor [--format json] [--dir <path>]`: read-only environment check (node and npm versions, whether
 * the project has an `architecture.yml`, which enforcer modules are installed). `--format json` prints one stable
 * document, `{node, npm, architectureYml, enforcers:[{name, available}]}` (a version is `null` when the tool is
 * missing), instead of the text list; the Cockpit's `cli` execution mode reads that document (#541).
 *
 * @param {string[]} args Optional `--format json` and `--dir <path>`.
 * @returns {Promise<void>} Resolves after printing the report.
 *
 * @example
 * await doctor(['--format', 'json']);
 */
export async function doctor(args) {
  const root = getRoot(args);
  const versions = {};
  for (const c of ['node', 'npm']) {
    // #413: bounded; a `--version` that takes 30 s is not going to answer.
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    versions[c] = r.status === 0 ? r.stdout.trim() : null;
  }
  const hasConfig = fs.existsSync(path.join(root, 'architecture.yml'));
  const enforcers = ENFORCER_MODULES.map(({ name, file }) => ({ name, available: fs.existsSync(path.join(packageRoot, file)) }));
  const report = { node: versions.node, npm: versions.npm, architectureYml: hasConfig, enforcers };
  if (flagValue(args, '--format') === 'json') console.log(JSON.stringify(report, null, 2));
  else for (const line of renderDoctorText(report)) console.log(line);
}

/**
 * The text form of a `doctor` report, one string per printed line. `construct doctor` prints exactly these lines,
 * and the Cockpit's `cli` execution mode rebuilds them from the JSON document, so both modes show the same text.
 *
 * @param {{node:string|null, npm:string|null, architectureYml:boolean, enforcers:{name:string, available:boolean}[]}} report A `doctor --format json` document.
 * @returns {string[]} The lines `construct doctor` prints.
 */
export function renderDoctorText(report) {
  return [
    'Construct doctor',
    `node: ${report.node ?? 'missing'}`,
    `npm: ${report.npm ?? 'missing'}`,
    `architecture.yml: ${report.architectureYml ? 'present' : 'missing'}`,
    'Enforcer modules:',
    ...report.enforcers.map(({ name, available }) => `  ${name}: ${available ? 'available' : 'not yet available'}`),
  ];
}

/**
 * The attribution every read-only `research` report ends with. Exported so the Cockpit's `cli` execution mode
 * labels its result exactly as the in-process path does.
 */
export const READ_ONLY_ATTRIBUTION = Object.freeze({ tool: 'produced the read-only report above', llm: '0 calls' });

// ---- capability groups: create / refactor / research ----------------------
//
// Three verbs, not three new engines: each delegates straight to the
// existing, already-tested functions above (or, for `refactor`, to the
// mechanical move/rename in refactor.mjs) — this is a friendlier CLI
// grouping for the three things Construct lets you do to a project, not a
// new implementation. The flat commands (`feature`, `generate`, `summarize`,
// `doctor`) keep working unchanged.

// Every create/refactor/research/import action ends with one of these —
// the whole point being that "who did what" is legible per-command, not
// buried in a separate log a human has to go find and cross-reference.
export function printAttribution(tool, llm) {
  console.log(`[tool: ${tool}] [llm: ${llm}]`);
}

/**
 * `construct create feature <name>` | `construct create layer <name> --layers ... [--llm <provider>]`
 * | `construct create <layer> <name> --feature <feature> [--llm <provider>]`
 * | `construct create service <name> --feature <feature> --openapi <spec>` (Ticket 7.5)
 * | `construct create layer|<layer> <name> --feature <feature> --shape list [--entity <E>] [--fields id:string,...]` (#619: real typed code, no model).
 * `feature` creation has nothing fillable (just types.ts/index.ts
 * boilerplate) so `--llm` only ever applies to the layer/single-layer
 * forms, which `generate(args)` itself already handles (see its own doc
 * comment) — this just reports whether that happened.
 *
 * @param {string[]} args `feature <name>`, `layer <name> --layers ...`, `<layer> <name> --feature <f>` or `service <name> --feature <f> --openapi <spec>`, each with an optional `--llm <provider>`.
 * @returns {Promise<void>} Resolves once the files are scaffolded and the attribution line is printed.
 *
 * @example
 * await create(['feature', 'billing']);
 */
export async function create(args) {
  if (flagValue(args, '--format') === 'json') return printJsonResult(() => createDocument(args));
  if (args[0] === 'feature') {
    await feature(['create', ...args.slice(1)]);
    printAttribution(SCAFFOLD_ATTRIBUTION.tool, SCAFFOLD_ATTRIBUTION.llm);
    return;
  }
  await generate(args);
  const llmI = args.indexOf('--llm');
  const llm = llmI >= 0 ? args[llmI + 1] : undefined;
  if (llm) {
    printAttribution(
      'scaffolded the file(s) above from templates',
      `call(s) via "${llm}" to write the real implementation into each generated file — review it before trusting it`,
    );
  } else {
    printAttribution(SCAFFOLD_ATTRIBUTION.tool, SCAFFOLD_ATTRIBUTION.llm);
  }
}

/** The attribution of a deterministic `create`: templates only, no model call. */
const SCAFFOLD_ATTRIBUTION = Object.freeze({ tool: 'scaffolded the file(s) above from templates', llm: '0 calls — filling in the logic is a separate step, by you or whichever LLM you choose' });

const usageFail = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

/**
 * Run a verb body that returns its result document and print it as the verb's `--format json` output (#541): one
 * pretty-printed JSON object on stdout, `{ok: true, ...result}`, or `{ok: false, error: {code, message}}` with the
 * matching exit code for any failure. Nothing else is printed, so the Cockpit's `cli` execution mode can parse
 * stdout as a whole and compare it with its in-process twin byte for byte.
 */
async function printJsonResult(body) {
  try {
    console.log(JSON.stringify({ ok: true, ...(await body()) }, null, 2));
  } catch (e) {
    const exitCode = e instanceof ConstructError ? e.exitCode : EXIT_CODES.INTERNAL_ERROR;
    const code = exitCode === EXIT_CODES.USAGE_ERROR ? 'USAGE_ERROR' : exitCode === EXIT_CODES.VIOLATIONS ? 'VIOLATIONS' : 'INTERNAL_ERROR';
    console.log(JSON.stringify({ ok: false, error: { code, message: String(e?.message || e) } }, null, 2));
    setExitCode(exitCode);
  }
}

/** `--format json` covers the deterministic forms only; a flag that implies a model call or an external input is refused by name. */
function refuseNonDeterministicFlags(verb, args, flags) {
  const found = flags.find((f) => args.includes(f));
  if (found) throw usageFail(`${verb} --format json covers the deterministic form only, without ${flags.join(', ')} (${found} was given). Run it without --format json.`);
}

/** The result document of `create feature <name>` | `create layer <name> --feature f --layers l1,l2` | `create <layer> <name> --feature f`. */
async function createDocument(args) {
  refuseNonDeterministicFlags('create', args, ['--llm', '--from', '--bind', '--envelope', '--openapi']);
  const attribution = { ...SCAFFOLD_ATTRIBUTION };
  if (args[0] === 'feature') {
    const name = args[1];
    if (!name || name.startsWith('--')) throw usageFail('Usage: construct feature create <name>');
    const root = getRoot(args);
    return { verb: 'create', kind: 'feature', feature: name, path: path.relative(root, createFeature(root, name)), attribution };
  }
  if (args[0] === 'tests') throw usageFail('create --format json does not cover `tests`: use `construct generate tests <feature>`.');
  if (args[0] === 'proof') return proofDocument(args, attribution);
  if (args[0] === 'route') return routeDocument(args, attribution);
  if (args[0] === 'dependency') return dependencyDocument(args, attribution);
  const fi = args.indexOf('--feature');
  const feature = fi >= 0 ? args[fi + 1] : undefined;
  if (args[0] === 'layer') {
    const name = args[1], li = args.indexOf('--layers');
    if (!name || !feature || li < 0 || !args[li + 1]) throw usageFail('Usage: construct generate layer <name> --feature <feature> --layers <layer1,layer2,...> [--llm <provider>]');
    const root = getRoot(args);
    const layers = args[li + 1].split(',').map((l) => l.trim()).filter(Boolean);
    const shaped = shapeRequestOf(args, name, feature);
    const files = shaped ? generateShapeVertical(root, shaped, layers) : generateVertical(root, name, feature, layers);
    return { verb: 'create', kind: 'layer', feature, name, layers, ...(shaped ? { shape: shaped.shape } : {}), files: files.map((f) => path.relative(root, f)), attribution };
  }
  const layer = args[0], name = args[1];
  if (!layer || !name || !feature) throw usageFail('Usage: construct generate <layer> <name> --feature <feature> [--openapi <spec>] [--llm <provider>]');
  const root = getRoot(args);
  const shaped = shapeRequestOf(args, name, feature);
  if (shaped) return { verb: 'create', kind: 'single', feature, layer, name, shape: shaped.shape, files: generateShapeLayer(root, { ...shaped, layer }).map((f) => path.relative(root, f)), attribution };
  return { verb: 'create', kind: 'single', feature, layer, name, files: [path.relative(root, generateLayer(root, layer, name, feature))], attribution };
}

/** `construct research workflow <feature> [<file>] [--format prose|md|json|scenarios] [--dir <path>]`
 * (epic #185). Read-only: explains the XState machines in a feature's
 * workflows/ folder in plain English, with scenarios and health findings,
 * derived from the source every time. Returns true when it printed only JSON. */
export async function researchWorkflow(args) {
  const t = startTimer();
  const valueFlags = new Set(['--format', '--dir']);
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (valueFlags.has(args[i])) i += 1;
    else if (!args[i].startsWith('--')) positional.push(args[i]);
  }
  const [feature, file] = positional;
  const fi = args.indexOf('--format');
  const format = fi >= 0 ? args[fi + 1] : 'prose';
  if (!feature || positional.length > 2 || !['prose', 'md', 'json', 'scenarios'].includes(format)) {
    throw new ConstructError('Usage: construct research workflow <feature> [<file>] [--format prose|md|json|scenarios] [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const files = file ? [file] : listWorkflowSourceFiles(root, feature);
  const results = files.map((f) => ({ file: f, ...explainSource(readWorkflowSource(root, feature, f)) }));
  const withMachines = results.filter((r) => r.machines.length || r.error);
  if (format === 'json') {
    console.log(JSON.stringify({ feature, files: withMachines }, null, 2));
    return true;
  }
  if (!withMachines.length) {
    console.log(`No XState machines found in features/${feature}/workflows/.`);
  }
  for (const r of withMachines) {
    console.log(format === 'md' ? `# features/${feature}/workflows/${r.file}\n` : `== features/${feature}/workflows/${r.file} ==\n`);
    if (r.error) console.log(`${r.error}\n`);
    for (const m of r.machines) console.log(renderExplained(m, format));
  }
  const n = withMachines.reduce((sum, r) => sum + r.machines.length, 0);
  console.log(`Explained ${n} machine(s) in ${withMachines.length} file(s) (${formatDuration(elapsedSeconds(t))})`);
  return false;
}

/**
 * `construct research spec <file> [--generate [--feature <name>]] [--format json|text] [--dir <path>]`
 * (#576/#584/#593). Checks a machine-spec.v1 file (an English requirement broken down into states,
 * events, transitions and typed functions, see docs/machine-spec.md): structure, then meaning
 * (reachability, unknown states/events, untyped functions, uncovered sentences, ...). Deterministic,
 * no LLM. Without `--generate`, purely read-only (exit code 1 on any SPEC-* failure, 2 when the file
 * cannot be read or is not JSON). With `--generate` (#593, R2): on ANY violation, prints exactly the
 * same report and writes nothing (the generation step never even starts); on an accepted spec, calls
 * `specToCode.mjs`'s `generateFromSpec` to write the workflow (with its typed state union and named
 * guard stubs) and one function stub per `functions[]` entry, never overwriting a file that already
 * exists.
 *
 * @param {string[]} args `<file>` plus optional `--generate`, `--feature <name>` (used only when the spec has no `feature` field), `--format json|text` (default text) and `--dir <path>` (where a relative `<file>` is resolved from, and the project root `--generate` writes into; default cwd).
 * @returns {Promise<boolean>} Resolves to true when it printed only JSON (so the caller skips the attribution line).
 * @throws {ConstructError} Usage error (exit code 2) for missing/extra positionals, an unknown format, an unreadable/non-JSON file, or (with `--generate`) a missing feature name.
 *
 * @example
 * await researchSpec(['specs/sign-in.machine-spec.json', '--generate', '--feature', 'auth']);
 */
export async function researchSpec(args) {
  const usage = 'Usage: construct research spec <file> [--generate [--feature <name>]] [--format json|text] [--dir <path>]';
  const valueFlags = new Set(['--format', '--dir', '--feature']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
  const format = flagValue(args, '--format') ?? 'text';
  if (positional.length !== 1 || !['json', 'text'].includes(format)) throw new ConstructError(usage, { exitCode: EXIT_CODES.USAGE_ERROR });
  // The file is resolved from where the user stands (or --dir), not from the project root a
  // parent architecture.yml would pick: a spec is an input file, not a project unit.
  const dir = flagValue(args, '--dir');
  const file = path.resolve(dir ? path.resolve(dir) : process.cwd(), positional[0]);
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConstructError(`Could not read the spec "${positional[0]}": ${String(e.message || e)}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const result = validateMachineSpec(spec, { file: path.relative(process.cwd(), file) || positional[0] });
  const generate = args.includes('--generate');
  // #593: on any violation, --generate is a no-op -- print R1's own report and write nothing, same
  // as plain `research spec` without the flag.
  if (result.status !== 'passed' || !generate) {
    console.log(renderMachineSpecReport(result, { format }));
    if (result.status !== 'passed') setExitCode(EXIT_CODES.VIOLATIONS);
    return format === 'json';
  }
  const gen = generateFromSpec(getRoot(args), spec, { feature: flagValue(args, '--feature') });
  if (format === 'json') {
    console.log(JSON.stringify({ status: 'generated', ...gen }, null, 2));
    return true;
  }
  console.log(renderMachineSpecReport(result, { format }));
  for (const f of gen.written) console.log(`Wrote ${f}`);
  for (const f of gen.skipped) console.log(`Skipped ${f} (already exists, not overwritten)`);
  console.log(`Generated feature "${gen.feature}": ${gen.written.length} file(s) written, ${gen.skipped.length} skipped.`);
  return false;
}

/** `construct research impact <ref>... [--files a,b] [--since <git-ref>] [--ticket <text>]
 * [--ticket-file <path>] [--depth N] [--max-files N] [--format json|markdown] [--dir <path>]`
 * | `construct research impact --usage` (#288).
 *
 * Read-only blast radius: which features/layers/files a change touches, why each file is
 * implicated, what is shared across features, and what the project's rules already say. Seeds
 * given as refs or `--files`/`--since` are explicit, so every entry comes back `derived`; seeds
 * proposed from `--ticket` text are heuristic, so everything they reach is marked `inferred`.
 * Returns true when it printed only JSON. */
export async function researchImpact(args) {
  const root = getRoot(args);
  const format = ['markdown', 'md'].includes(flagValue(args, '--format')) ? 'markdown' : 'json';
  if (args.includes('--usage')) {
    console.log(JSON.stringify(impactApiManifest(), null, 2));
    return true;
  }
  const valueFlags = new Set(['--dir', '--format', '--depth', '--max-files', '--files', '--ticket', '--ticket-file', '--since', '--max-seeds']);
  const refs = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
  const seeds = refs.map((ref) => ({ ref, method: 'user', provenance: 'explicit' }));
  const filesFlag = flagValue(args, '--files');
  if (filesFlag) for (const p of filesFlag.split(',').map((s) => s.trim()).filter(Boolean)) seeds.push({ path: p, method: 'changed-files', provenance: 'explicit' });
  const since = flagValue(args, '--since');
  if (since) {
    let changed;
    try {
      // #413: bounded, so a stuck git (a lock, a prompt) cannot hang `research` forever.
      changed = spawnSync('git', ['diff', '--name-only', since], { cwd: root, encoding: 'utf8', timeout: 10 * 60 * 1000, killSignal: 'SIGKILL' });
    } catch (e) {
      throw new ConstructError(`Could not diff against "${since}": ${String(e.message || e)}`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
    if (/** @type {any} */ (changed.error)?.code === 'ETIMEDOUT') throw new ConstructError(`Could not diff against "${since}": git did not finish within 600 seconds and was stopped.`, { exitCode: EXIT_CODES.INTERNAL_ERROR });
    if (changed.status !== 0) throw new ConstructError(`Could not diff against "${since}": ${String(changed.stderr || changed.error?.message || '').trim() || 'git failed'}. Is ${root} a git repository, and does that ref exist?`, { exitCode: EXIT_CODES.USAGE_ERROR });
    for (const p of changed.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) seeds.push({ path: p, method: 'changed-files', provenance: 'explicit' });
  }
  const ticketFile = flagValue(args, '--ticket-file');
  const ticket = ticketFile ? fs.readFileSync(path.resolve(root, ticketFile), 'utf8') : flagValue(args, '--ticket');
  if (ticket) {
    const maxSeeds = flagValue(args, '--max-seeds');
    const proposal = proposeSeedsFromText(root, ticket, maxSeeds ? { maxSeeds: Number(maxSeeds) } : {});
    if (!proposal.ok) {
      console.log(JSON.stringify(proposal, null, 2));
      setExitCode(EXIT_CODES.USAGE_ERROR);
      return true;
    }
    seeds.push(...proposal.seeds);
  }
  if (!seeds.length) {
    throw new ConstructError('Usage: construct research impact <unit-ref>... [--files a,b] [--since <git-ref>] [--ticket <text>] [--ticket-file <path>] [--depth N] [--max-files N] [--format json|markdown] [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const depth = flagValue(args, '--depth');
  const maxFiles = flagValue(args, '--max-files');
  const maxSeedsLimit = flagValue(args, '--max-seeds');
  const limits = {
    ...(maxFiles !== undefined ? { maxFiles: Number(maxFiles) } : {}),
    ...(maxSeedsLimit !== undefined ? { maxSeeds: Number(maxSeedsLimit) } : {}),
  };
  const result = analyzeImpact(root, {
    seeds,
    ...(depth !== undefined ? { depth: Number(depth) } : {}),
    ...(Object.keys(limits).length ? { limits } : {}),
  });
  console.log(format === 'markdown' ? renderImpactMarkdown(result) : JSON.stringify(result, null, 2));
  if (!result.ok) setExitCode(result.error.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR);
  return format === 'json';
}

/** `construct review <base> <head> [--plan <file>] [--features a,b] [--no-merge-base] [--format json|markdown]
 * [--dir <path>]` | `construct review --usage` (#314/#316, epic #285).
 *
 * Read-only PR health: the deterministic indicators for the change from <base> to <head> (any two
 * refs; local branches need no GitHub login): declared-vs-actual scope (only with --plan/--features),
 * unexplained changes, rule regressions, public surface, and a flow diff. Findings are split into
 * mechanical (a Construct block can fix them) and conversation (a human decides). No LLM, and the
 * working tree, index and branches are never touched. Returns true when it printed only JSON. */
export async function review(args) {
  if (args.includes('--usage')) {
    console.log(JSON.stringify(prHealthApiManifest(), null, 2));
    return true;
  }
  const valueFlags = new Set(['--dir', '--format', '--plan', '--features']);
  const refs = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
  if (refs.length !== 2) {
    throw new ConstructError('Usage: construct review <base> <head> [--plan <file>] [--features a,b] [--no-merge-base] [--format json|markdown] [--dir <path>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const format = ['markdown', 'md'].includes(flagValue(args, '--format')) ? 'markdown' : 'json';
  let expected = null;
  const planFile = flagValue(args, '--plan');
  const featuresFlag = flagValue(args, '--features');
  if (planFile) {
    try {
      expected = JSON.parse(fs.readFileSync(path.resolve(root, planFile), 'utf8'));
    } catch (e) {
      throw new ConstructError(`Could not read the plan "${planFile}": ${String(e.message || e)}`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
  } else if (featuresFlag) {
    expected = featuresFlag.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const result = prHealth(root, { base: refs[0], head: refs[1], expected, mergeBase: !args.includes('--no-merge-base') });
  console.log(format === 'markdown' ? renderPrHealthMarkdown(result) : JSON.stringify(result, null, 2));
  if (!result.ok) setExitCode(result.error.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR);
  return format === 'json';
}

/** `construct test proof <feature> [--name <file>] [--format json|text] [--dir <path>]` (#623). Runs the render proof of a shaped screen
 * (no browser, no server) and says, for each failure, whether the app or the harness is at fault, then whether the chain is complete.
 * Read-only, deterministic, no LLM. Exit code 1 when any test failed, 2 when the proof could not run. */
async function testProof(rest, usage) {
  const valueFlags = new Set(['--dir', '--name', '--format']);
  const feature = rest.find((a, i) => !a.startsWith('--') && !valueFlags.has(rest[i - 1]));
  if (!feature) throw new ConstructError(usage, { exitCode: EXIT_CODES.USAGE_ERROR });
  const format = flagValue(rest, '--format') === 'json' ? 'json' : 'text';
  const result = await runProofs(getRoot(rest), feature, { name: flagValue(rest, '--name') });
  console.log(format === 'json' ? JSON.stringify(result, null, 2) : renderProofRunText(result));
  if (!result.ok) setExitCode(EXIT_CODES.USAGE_ERROR);
  else if (result.counts.failed > 0) setExitCode(EXIT_CODES.VIOLATIONS);
  return format === 'json';
}

/** `construct test run <feature> [--name <file> --area generated|yours] [--base-url <url>] [--format json|text] [--dir <path>]`
 * (#305). Runs a feature's Playwright tests against the project's own running app and says, for each failure, whether
 * the harness or the app is at fault. Read-only, deterministic, no LLM. Exit code 1 when any test failed. */
export async function testCommand(args) {
  const usage = 'Usage: construct test run <feature> [--name <file> --area generated|yours] [--base-url <url>] [--format json|text] [--dir <path>]\n       construct test proof <feature> [--name <file>] [--format json|text] [--dir <path>]';
  if (args[0] === 'proof') return testProof(args.slice(1), usage);
  if (args[0] !== 'run') throw new ConstructError(usage, { exitCode: EXIT_CODES.USAGE_ERROR });
  const rest = args.slice(1);
  const valueFlags = new Set(['--dir', '--name', '--area', '--base-url', '--format']);
  const feature = rest.find((a, i) => !a.startsWith('--') && !valueFlags.has(rest[i - 1]));
  if (!feature) throw new ConstructError(usage, { exitCode: EXIT_CODES.USAGE_ERROR });
  const format = flagValue(rest, '--format') === 'json' ? 'json' : 'text';
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const result = await runFeatureTests(getRoot(rest), feature, { name: flagValue(rest, '--name'), area: flagValue(rest, '--area'), baseUrl: flagValue(rest, '--base-url'), signal: abort.signal, onProgress: format === 'text' ? (l) => console.error(l) : undefined });
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  console.log(format === 'json' ? JSON.stringify(result, null, 2) : renderRunText(result));
  if (!result.ok) setExitCode(EXIT_CODES.USAGE_ERROR);
  else if (result.counts.failed > 0) setExitCode(EXIT_CODES.VIOLATIONS);
  return format === 'json';
}

/** `construct template list|show|instantiate` (#333). Read-only, JSON in/out, no LLM.
 *
 *   construct template list --templates <dir>
 *   construct template show <name> --templates <dir>
 *   construct template instantiate <name> --templates <dir> [--param key=value]... [--params-json '{"k":"v"}']
 *
 * A template is a named, reusable, parameterised plan; `instantiate` prints an ordinary plan.v1 (feed it
 * to the runner or `construct review --plan`). The mechanism is open; the CURATED templates are not in
 * this repo: point `--templates <dir>` (or CONSTRUCT_TEMPLATES_DIR) at wherever they live. There is no
 * default directory, and nothing here runs a plan. */
export async function template(args) {
  const usage = 'Usage: construct template list|show <name>|instantiate <name> [--param key=value]... [--params-json <json>] --templates <dir> (or CONSTRUCT_TEMPLATES_DIR)';
  const valueFlags = new Set(['--templates', '--param', '--params-json']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
  const [verb, name] = positional;
  if (!['list', 'show', 'instantiate'].includes(verb) || (verb !== 'list' && !name)) throw new ConstructError(usage, { exitCode: EXIT_CODES.USAGE_ERROR });
  const dir = flagValue(args, '--templates') ?? process.env.CONSTRUCT_TEMPLATES_DIR;
  if (!dir) throw new ConstructError(`No template directory configured. The curated flows are not bundled with the open core: pass --templates <dir> or set CONSTRUCT_TEMPLATES_DIR. ${usage}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  const params = {};
  try {
    const json = flagValue(args, '--params-json');
    if (json !== undefined) Object.assign(params, JSON.parse(json));
    args.forEach((a, i) => {
      if (a !== '--param') return;
      const kv = args[i + 1] ?? '';
      const eq = kv.indexOf('=');
      if (eq <= 0) throw new TemplateError('PARAM_INVALID', `--param expects key=value, got ${JSON.stringify(kv)}.`);
      params[kv.slice(0, eq)] = kv.slice(eq + 1);
    });
    const registry = loadTemplateDir(path.resolve(dir));
    if (verb === 'list') console.log(JSON.stringify({ ok: true, templates: registry.list() }, null, 2));
    else if (verb === 'show') console.log(JSON.stringify({ ok: true, template: registry.get(name) }, null, 2));
    else console.log(JSON.stringify(registry.instantiate(name, params), null, 2));
  } catch (e) {
    if (!(e instanceof TemplateError) && !(e instanceof SyntaxError)) throw e;
    console.log(JSON.stringify({ ok: false, error: { code: e.code || 'PARAMS_JSON_INVALID', message: e.message, errors: e.errors } }, null, 2));
    setExitCode(EXIT_CODES.USAGE_ERROR);
  }
}

/**
 * `construct research summarize ...` | `construct research doctor ...` | `construct research workflow ...`
 * | `construct research impact ...` | `construct research spec ...`.
 *
 * @param {string[]} args `summarize|doctor|workflow|impact|spec` followed by that command's own arguments.
 * @returns {Promise<void>} Resolves after printing the read-only report.
 * @throws {ConstructError} Usage error (exit code 2) for an unknown subcommand.
 *
 * @example
 * await research(['impact', '--files', 'features/plan/index.ts']);
 */
export async function research(args) {
  let jsonOnly = false;
  if (args[0] === 'summarize') await summarize(args.slice(1));
  else if (args[0] === 'doctor') await doctor(args.slice(1));
  else if (args[0] === 'workflow') jsonOnly = await researchWorkflow(args.slice(1));
  else if (args[0] === 'impact') jsonOnly = await researchImpact(args.slice(1));
  else if (args[0] === 'spec') jsonOnly = await researchSpec(args.slice(1));
  else throw new ConstructError('Usage: construct research summarize|doctor|workflow|impact|spec ...', { exitCode: EXIT_CODES.USAGE_ERROR });
  if (!jsonOnly) printAttribution(READ_ONLY_ATTRIBUTION.tool, READ_ONLY_ATTRIBUTION.llm);
}

/**
 * `construct refactor move <name> --feature <f> --from <layer> --to <layer>`
 * | `construct refactor rename <name> <newName> --feature <f> --layer <layer>`
 * | `construct refactor extract-expression <file> [--range <start:end>] [--name <Name>]`.
 * Purely mechanical (relocate + rewrite every importer's path, or hoist a
 * flagged inline conditional/loop into a named unit) — never invents new
 * business logic. Reports the result, then re-validates the changed file(s)
 * so a naming/purity mismatch in their new home shows up immediately instead
 * of on the next full `construct validate`.
 *
 * @param {string[]} args `move <name> --feature <f> --from <layer> --to <layer>`, `rename <name> <newName> --feature <f> --layer <layer>`, or `extract-expression <file> [--range <start:end>] [--name <Name>]`.
 * @returns {Promise<void>} Resolves after the change (or dry run) is reported.
 * @throws {ConstructError} Usage error (exit code 2) for an unknown subcommand.
 */
export async function refactor(args) {
  if (flagValue(args, '--format') === 'json') return printJsonResult(() => refactorDocument(args));
  if (args[0] === 'move') return refactorMove(args.slice(1));
  if (args[0] === 'rename') return refactorRename(args.slice(1));
  if (args[0] === 'extract-expression') return refactorExtractExpression(args.slice(1));
  throw new ConstructError('Usage: construct refactor move|rename|extract-expression ...', { exitCode: EXIT_CODES.USAGE_ERROR });
}

// This printed line is the entire audit trail for a refactor command by
// design (no persistent log) — every construct-driven change gets one clear,
// scannable summary; a file changed without one wasn't done by the tool.
function reportRelocation(root, verb, result) {
  const violations = result.dryRun ? [] : validateArchitecture(root, { files: [result.to] }).violations;
  for (const line of relocationLines(verb, result, violations)) console.log(line);
  if (!result.dryRun) printAttribution(RELOCATE_ATTRIBUTION.tool, RELOCATE_ATTRIBUTION.llm);
}

/** The printed lines of a relocation, without the attribution: one source for the text CLI and the Cockpit's `cli` mode. */
function relocationLines(verb, result, violations) {
  if (result.dryRun) {
    return [
      `Dry run (${result.engine}${result.tsVersion ? ` ${result.tsVersion}` : ''}): would change ${result.files.length} file(s) to move ${result.from} -> ${result.to}:`,
      ...result.files.map((f) => `  ${f}`),
      ...(result.note ? [`Note: ${result.note}`] : []),
    ];
  }
  return [
    `${verb} ${result.from} -> ${result.to} (${result.importersUpdated} importer(s) updated)`,
    ...(result.note ? [`Note: ${result.note}`] : []),
    ...(violations.length ? [formatReport(violations, { format: 'text' })] : []),
  ];
}

/**
 * The text lines of a `refactor move|rename --format json` document, as `construct refactor` prints them (without
 * the attribution line, which the document carries as `attribution`). The Cockpit's `cli` execution mode shows these.
 *
 * @param {object} doc A `refactor ... --format json` document.
 * @returns {string[]} The printed lines.
 */
export function renderRefactorText(doc) {
  return relocationLines(doc.action === 'move' ? 'Moved' : 'Renamed', doc, doc.violations ?? []);
}

/**
 * The text lines of a `create ... --format json` document: one `Created <path>` line per scaffolded file (the text
 * CLI adds per-file timings, which are not part of the deterministic document).
 *
 * @param {object} doc A `create ... --format json` document.
 * @returns {string[]} The lines to show.
 */
export function renderCreateText(doc) {
  return doc.kind === 'feature' ? [`Created feature ${doc.feature} at ${doc.path}`] : doc.files.map((f) => `Created ${f}`);
}

/**
 * The text lines of an `import ... --format json` document, as `construct import` prints them minus its timings.
 *
 * @param {object} doc An `import ... --format json` document.
 * @returns {string[]} The lines to show.
 */
export function renderImportText(doc) {
  const featureNote = doc.mode === 'plan' && doc.feature ? ` --feature ${doc.feature}` : '';
  return [
    ...doc.results.flatMap((r) => [`${r.name}: scaffolded ${r.files.length} file(s) from ${r.source}`, ...r.files.map((f) => `  ${f}`)]),
    `Next (needs judgment, not a tool): fill in each TODO(import) marker across ${doc.results.length} logical unit(s), then run validate${featureNote}.`,
  ];
}

/** The attribution of a `refactor move|rename`: mechanical, no model call. */
const RELOCATE_ATTRIBUTION = Object.freeze({ tool: "relocated/renamed the file and rewrote every importer's path", llm: '0 calls — content and the exported identifier are untouched' });

// `refactor move|rename` -- argument checks and the mechanical relocation, shared by the text form (which
// prints a line per file) and the `--format json` form (which returns the result document).
function relocateMove(args) {
  const name = args[0], fi = args.indexOf('--feature'), fromI = args.indexOf('--from'), toI = args.indexOf('--to');
  if (!name || fi < 0 || !args[fi + 1] || fromI < 0 || !args[fromI + 1] || toI < 0 || !args[toI + 1]) {
    throw new ConstructError(
      'Usage: construct refactor move <name> --feature <feature> --from <layer> --to <layer>',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  return { root, result: moveLayerFile(root, args[fi + 1], name, args[fromI + 1], args[toI + 1], { dryRun: args.includes('--dry-run') }) };
}

function relocateRename(args) {
  const name = args[0], newName = args[1], fi = args.indexOf('--feature'), li = args.indexOf('--layer');
  if (!name || !newName || fi < 0 || !args[fi + 1] || li < 0 || !args[li + 1]) {
    throw new ConstructError(
      'Usage: construct refactor rename <name> <newName> --feature <feature> --layer <layer>',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  return { root, result: renameLayerFile(root, args[fi + 1], name, newName, args[li + 1], { dryRun: args.includes('--dry-run') }) };
}

async function refactorMove(args) {
  const { root, result } = relocateMove(args);
  reportRelocation(root, 'Moved', result);
}

async function refactorRename(args) {
  const { root, result } = relocateRename(args);
  reportRelocation(root, 'Renamed', result);
}

/** The result document of `refactor move|rename ... --format json`: the relocation result, plus the architecture
 * violations re-checked in the file's new home (none for a dry run, which changes nothing). */
async function refactorDocument(args) {
  const action = args[0];
  if (action !== 'move' && action !== 'rename') throw usageFail('refactor --format json covers `move` and `rename`; `extract-expression` has no JSON form yet. Usage: construct refactor move|rename ... [--format json]');
  const { root, result } = (action === 'move' ? relocateMove : relocateRename)(args.slice(1));
  const violations = result.dryRun ? [] : validateArchitecture(root, { files: [result.to] }).violations;
  return { verb: 'refactor', action, ...result, violations, attribution: result.dryRun ? null : { ...RELOCATE_ATTRIBUTION } };
}

async function refactorExtractExpression(args) {
  const file = args[0];
  if (!file) {
    throw new ConstructError(
      'Usage: construct refactor extract-expression <file> [--range <start:end>] [--name <Name>] [--dry-run]',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  const rangeI = args.indexOf('--range');
  let range;
  if (rangeI >= 0) {
    const raw = args[rangeI + 1] || '';
    const m = raw.match(/^(\d+):(\d+)$/);
    if (!m) throw new ConstructError(`--range must be "<start>:<end>" (two source offsets), got "${raw}".`, { exitCode: EXIT_CODES.USAGE_ERROR });
    range = [Number(m[1]), Number(m[2])];
  }
  const nameI = args.indexOf('--name');
  const result = extractExpression(root, file, {
    range,
    name: nameI >= 0 ? args[nameI + 1] : undefined,
    dryRun: args.includes('--dry-run'),
  });
  if (result.dryRun) {
    console.log(`Dry run: would extract into ${result.expression.file}${result.components.length ? ` (+ ${result.components.map((c) => c.file).join(', ')})` : ''}, rewriting ${result.page.file}.`);
    printAttribution('extracted a flagged inline conditional/loop into a named @expression unit', '0 calls — the shape is copied from the flagged code itself');
    return;
  }
  console.log(`Extracted ${result.expression.name} from ${result.page.file} -> ${result.expression.file}`);
  for (const c of result.components) console.log(`  hoisted native markup -> ${c.file} (${c.name})`);
  const touched = [result.page.file, result.expression.file, ...result.components.map((c) => c.file)];
  const { violations } = validateArchitecture(root, { files: touched });
  if (violations.length) console.log(formatReport(violations, { format: 'text' }));
  printAttribution('extracted a flagged inline conditional/loop into a named @expression unit', '0 calls — the shape is copied from the flagged code itself');
}

/**
 * `construct import <name> --feature <feature> --layers <l1,l2,...> --from <path> [--llm <provider>]`
 * | `construct import --plan <path> [--llm <provider>]`.
 * Scaffolds layers exactly like `create layer` — always deterministic, same
 * as everything else in this file. With no `--llm`: prepends a TODO
 * breadcrumb to each generated file pointing at its source, and stops —
 * writing the ported logic is left to whoever (human or LLM) does it next.
 * With `--llm <provider>` (currently only "claude" is supported): calls that
 * provider once per generated file to write the ported logic directly. This
 * is the one place in Construct that ever calls an LLM, and only when this
 * flag is explicitly given — locating the source and scaffolding the files
 * themselves never involves one either way. `--plan` is the batch form: an
 * approved plan (produced by whichever LLM analyzed a whole existing
 * feature — Construct never does that analysis itself) runs the same step
 * once per unit, in one command.
 *
 * @param {string[]} args `<name> --feature <f> --layers <l1,l2,...> --from <path> [--llm <provider>]`, or `--plan <path> [--llm <provider>]` for a batch.
 * @returns {Promise<void>} Resolves once the layers are scaffolded (and filled, with `--llm`).
 * @throws {ConstructError} Usage error (exit code 2) for missing flags, or for `--route`, which must be run directly from a shell.
 */
export async function importCommand(args) {
  if (args[0] === '--route') {
    throw new ConstructError(
      'construct import --route <path> is a standalone interactive command — run it directly from your shell (not from inside `construct repl`, which is already reading its own input).',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  if (flagValue(args, '--format') === 'json') return printJsonResult(() => importDocument(args));
  const llmI = args.indexOf('--llm');
  const llm = llmI >= 0 ? args[llmI + 1] : undefined;
  const planI = args.indexOf('--plan');
  if (planI >= 0) return importFromPlan(args, llm);

  const name = args[0], fi = args.indexOf('--feature'), li = args.indexOf('--layers'), fromI = args.indexOf('--from');
  if (!name || fi < 0 || !args[fi + 1] || li < 0 || !args[li + 1] || fromI < 0 || !args[fromI + 1]) {
    throw new ConstructError(
      'Usage: construct import <name> --feature <feature> --layers <l1,l2,...> --from <path> [--llm <provider>]\n   or: construct import --plan <path> [--llm <provider>]\n   or: construct import --route <path>  (run directly, not inside repl)',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  const layers = args[li + 1].split(',').map((l) => l.trim()).filter(Boolean);
  const { source, files, fills, timings } = await importVertical(root, name, args[fi + 1], layers, args[fromI + 1], { llm });
  reportImport(root, [{ name, source, files, fills, timings }], llm);
}

async function importFromPlan(args, llm) {
  const planI = args.indexOf('--plan');
  if (!args[planI + 1]) {
    throw new ConstructError('Usage: construct import --plan <path> [--llm <provider>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const { feature, results } = await importPlan(root, args[planI + 1], { llm });
  reportImport(root, results, llm, feature);
}

// Shared reporting for both import forms — one clear tool/llm-attributed
// summary either way, matching every other capability group. `analysisSeconds`
// (#166, route-wizard only) folds the one whole-route analysis LLM call into
// the printed Total, same as every per-file LLM-fill call already is.
function reportImport(root, results, llm, feature, analysisCalls = 0, analysisSeconds = 0) {
  let totalFiles = 0;
  const problems = [];
  let totalSeconds = analysisSeconds;
  for (const r of results) {
    const unfilled = (r.fills || []).filter((f) => f.status !== 'filled');
    const scaffoldNote = r.timings ? ` (scaffold ${formatDuration(r.timings.scaffoldSeconds)})` : '';
    console.log(`${r.name}: ${llm && !unfilled.length ? 'scaffolded + LLM-filled' : 'scaffolded'} ${r.files.length} file(s) from ${r.source}${scaffoldNote}`);
    for (const file of r.files) {
      const miss = unfilled.find((f) => f.file === file);
      const ft = r.timings?.files.find((f) => f.file === file);
      const llmNote = llm && ft ? ` (llm ${formatDuration(ft.llmSeconds)})` : '';
      console.log(`  ${path.relative(root, file)}${llmNote}${miss ? `  <- ${miss.status === 'rejected' ? "model output rejected" : 'LLM call failed'}, stub + TODO(import) kept` : ''}`);
      // #522 -- same hint reportFill prints for create/generate's --llm fill, for import's.
      const fixCommand = (r.fills || []).find((f) => f.file === file)?.fixCommand;
      if (fixCommand) printExtractExpressionHint(fixCommand);
    }
    problems.push(...unfilled);
    totalFiles += r.files.length;
    if (r.timings) totalSeconds += r.timings.totalSeconds;
  }
  console.log(`Total: ${formatDuration(totalSeconds)}`);
  if (problems.length) {
    console.log(`${problems.length} of ${totalFiles} file(s) were NOT filled by "${llm}" — the scaffolded stub and its TODO(import) breadcrumb were left in place:`);
    for (const p of problems) {
      console.log(`  ${path.relative(root, p.file)}: ${p.status === 'rejected' ? "the model's output was rejected" : 'the LLM call failed'} after ${p.attempts} attempt(s) — ${p.reason}`);
    }
    setExitCode(EXIT_CODES.INTERNAL_ERROR);
  }
  const featureNote = feature ? ` --feature ${feature}` : '';
  const analysisNote = analysisCalls ? `${analysisCalls} call(s) to analyze the route + ` : '';
  if (llm) {
    console.log(
      problems.length
        ? `Next: fill in the ${problems.length} TODO(import) marker(s) listed above (by hand, or re-run import for them), review the ${totalFiles - problems.length} ported file(s) against their source, then run validate${featureNote}.`
        : `Next: review the ported logic above (diff against the source), then run validate${featureNote}.`,
    );
    printAttribution(
      `scaffolded ${totalFiles} file(s) across ${results.length} logical unit(s)`,
      `${analysisNote}${totalFiles - problems.length} of ${totalFiles} file(s) written via "${llm}" (${problems.length} left as stub + TODO) — review it before trusting it`,
    );
  } else {
    console.log(`Next (needs judgment, not a tool): fill in each TODO(import) marker across ${results.length} logical unit(s), then run validate${featureNote}.`);
    const a = noLlmImportAttribution(totalFiles, results.length, analysisNote);
    printAttribution(a.tool, a.llm);
  }
}

/** The attribution of an import that made no model call for the port (`analysisNote` names a plan-analysis call, if any). */
function noLlmImportAttribution(totalFiles, units, analysisNote = '') {
  return {
    tool: `scaffolded ${totalFiles} file(s) across ${units} logical unit(s) and wrote a TODO(import) breadcrumb in each`,
    llm: analysisNote
      ? `${analysisNote}0 calls to write the logic — that's next, by you or whichever LLM you choose`
      : '0 calls — reading the source(s) and writing the ported logic is next, by you or whichever LLM you choose',
  };
}

/** The result document of `import ... --format json` (no `--llm`): what was scaffolded, per logical unit, and where from. */
async function importDocument(args) {
  refuseNonDeterministicFlags('import', args, ['--llm', '--route']);
  const planI = args.indexOf('--plan');
  let root, results, feature, mode;
  if (planI >= 0) {
    if (!args[planI + 1]) throw usageFail('Usage: construct import --plan <path> [--llm <provider>]');
    mode = 'plan';
    root = getRoot(args);
    ({ feature, results } = await importPlan(root, args[planI + 1], {}));
  } else {
    const name = args[0], fi = args.indexOf('--feature'), li = args.indexOf('--layers'), fromI = args.indexOf('--from');
    if (!name || name.startsWith('--') || fi < 0 || !args[fi + 1] || li < 0 || !args[li + 1] || fromI < 0 || !args[fromI + 1]) {
      throw usageFail('Usage: construct import <name> --feature <feature> --layers <l1,l2,...> --from <path> [--llm <provider>]\n   or: construct import --plan <path> [--llm <provider>]\n   or: construct import --route <path>  (run directly, not inside repl)');
    }
    mode = 'unit';
    root = getRoot(args);
    feature = args[fi + 1];
    const layers = args[li + 1].split(',').map((l) => l.trim()).filter(Boolean);
    const { source, files } = await importVertical(root, name, feature, layers, args[fromI + 1], {});
    results = [{ name, source, files }];
  }
  const units = results.map((r) => ({ name: r.name, source: r.source, files: r.files.map((f) => path.relative(root, f)) }));
  const totalFiles = units.reduce((n, u) => n + u.files.length, 0);
  return { verb: 'import', mode, ...(feature ? { feature } : {}), results: units, attribution: noLlmImportAttribution(totalFiles, units.length) };
}

// ---- import --route: interactive, whole-feature import wizard -------------
//
// A standalone interactive command — packages/cli/construct.mjs dispatches it
// directly, bypassing importCommand entirely, and it consumes stdin itself
// via its own line source. Deliberately NOT runnable from inside `construct
// repl` (which is already consuming the same stdin): importCommand's
// `--route` branch below exists only to explain that redirect, not to run
// it. Asks a few questions, calls "claude" once to analyze the route and
// propose a plan, shows it, and writes nothing until you explicitly
// approve it.

function renderPlanTable(plan) {
  const lines = [`Proposed plan for feature "${plan.feature}" (${plan.units.length} unit(s)):`, ''];
  for (const [i, u] of plan.units.entries()) {
    lines.push(`  ${i + 1}. ${u.name.padEnd(24)} ${u.layers.join(', ').padEnd(28)} <- ${u.from}`);
    for (const layer of u.layers) if (u.reasons?.[layer]) lines.push(`       ${layer}: ${u.reasons[layer]}`);
  }
  return lines.join('\n');
}

function isYes(answer) {
  const a = answer.trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

/** The wizard's actual flow, decoupled from where its questions come from —
 * `ask` is an async `(promptText) => answer` function, so this is directly
 * unit-testable with a fake, scripted `ask` and never needs a real
 * terminal. `runImportRouteWizard` below is the only caller that wires it
 * to real stdin/stdout.
 *
 * Guides the whole thing end to end in one session: creates the
 * destination feature if it doesn't exist yet (never touches it if it
 * does — no re-scaffolding over real content), loops asking for as many
 * source directories as the old feature actually spans (analyzed together,
 * as one combined plan, not one call per directory), builds on approval,
 * then immediately validates and states exactly what's left — a TODO count
 * to fill in, or a reminder to review LLM-written output — rather than
 * leaving you to go find that out yourself. `seedRoute` (optional) is just
 * the first route, so `construct import --route <path>` can still seed the
 * loop instead of asking for it as question one.
 *
 * A "route" means something different per `config.project.framework`
 * (resolveRoute in route-resolver.mjs is framework-ready — #66): for the
 * default `nextjs`, a URL like `/v2/home` or, equivalently, the folder that
 * owns its `page.tsx` — a URL route needs to know where the `app/`
 * directory is, so that's asked for once, lazily, and reused for every
 * further route this session. For `react-spa`, a URL like `/dashboard`
 * (resolved through the project's centralized routes table) or an existing
 * controller file path directly — no directory question at all, since the
 * routes table is auto-located by convention from the project root. Either
 * way, the actual file list comes from tracing the real import graph
 * (route-resolver.mjs), never from "everything under a directory you point
 * at". */
export async function importRouteWizard(ask, seedRoute, { planAnalysis = 'claude', importFill = 'claude', planner = 'ai', onStep, onThought, onWritten, signal } = {}) {
  // #599 -- two SEPARATE kinds of live output, kept apart on purpose so a UI can style them
  // differently: `onStep` receives the framework's own deterministic phase markers
  // ({phase, detail}: tracing, analyzing, plan-ready, scaffolding, filling, validating,
  // auto-fixing, done, cancelled), and `onThought` receives the model's own streamed output text.
  // `signal` (an AbortSignal) cancels an in-flight model call and stops the run.
  // `reason` is the framework's own why for this block, shown under the step so the deterministic side
  // explains itself the way the model's stream does.
  const step = (phase, detail = {}, reason) => onStep?.({ phase, detail, ...(reason ? { reason } : {}) });
  const llmOptions = { ...(onThought ? { onChunk: onThought } : {}), ...(signal ? { signal } : {}) };
  // Whole-feature plan analysis is deliberately hosted-model-only (#96) — the
  // same guardrail ui/server's Settings enforces, repeated here so a direct
  // caller can't route it to a local model either.
  if (planner !== 'mechanical' && planAnalysis === 'ollama') {
    console.error('Plan analysis cannot use "ollama" — the whole-feature analysis call is hosted-model-only (see epic #96). Use "claude" for planAnalysis.');
    return;
  }
  const featureName = (await ask('Destination feature (Construct feature name): ')).trim();
  if (!featureName) {
    console.log('Cancelled — no feature name given.');
    return;
  }

  const root = getRoot([]);
  const config = loadConfig(root);
  const featuresRoot = config.features?.root || 'features';
  const framework = config.project?.framework || 'nextjs';
  const featureDir = path.join(root, featuresRoot, featureName);
  if (!fs.existsSync(featureDir)) {
    createFeature(root, featureName);
    console.log(`(feature "${featureName}" didn't exist yet — created it)`);
  }

  function isExistingDir(p) {
    try {
      return fs.statSync(path.resolve(p)).isDirectory();
    } catch {
      return false;
    }
  }

  // react-spa has no per-route entry file to point at directly the way a
  // Next.js route folder does — the equivalent "already resolved, no
  // further lookup needed" case is an existing *controller file* (mirrors
  // resolveReactSpaRoute's own existing-file branch in route-resolver.mjs).
  function isExistingFile(p) {
    try {
      return fs.statSync(path.resolve(p)).isFile();
    } catch {
      return false;
    }
  }

  let appDir;
  async function resolveAppDir() {
    if (appDir) return appDir;
    const guess = ['src/app', 'app']
      .map((p) => path.join(root, p))
      .find((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
    const answer = (
      await ask(`Path to your Next.js app/ directory (needed to resolve a URL route)${guess ? ` [${path.relative(root, guess)}]` : ''}: `, { expects: 'dir' })
    ).trim();
    appDir = answer ? path.resolve(answer) : guess;
    if (!appDir) {
      throw new ConstructError('No app directory given or found — cannot resolve a URL route.', { exitCode: EXIT_CODES.USAGE_ERROR });
    }
    return appDir;
  }

  const routeArgs = seedRoute ? [seedRoute] : [];
  while (true) {
    const prompt = routeArgs.length === 0
      ? (framework === 'react-spa'
        ? 'Route to import (a URL like /dashboard, or a controller file path): '
        : 'Route to import (a URL like /v2/home, or a route folder path): ')
      : `Another route to include (leave blank to finish — ${routeArgs.length} so far): `;
    const answer = (await ask(prompt, { expects: 'route' })).trim();
    if (!answer) {
      if (routeArgs.length === 0) {
        console.log('Cancelled — no route given.');
        return;
      }
      break;
    }
    routeArgs.push(answer);
  }

  const fillWithLlm = isYes(
    await ask('After you approve the plan, should the LLM also write the ported logic (not just TODO breadcrumbs)? [y/N]: '),
  );

  step('tracing', { routes: routeArgs }, 'Follows the real import statements from the route\'s entry file (parsed, not guessed), so only files it actually depends on are included.');
  console.log(`Tracing ${routeArgs.join(', ')} ...`);
  const traceStart = startTimer();
  const tracedFiles = new Map(); // absolute path -> true, deduped across routes
  const entryFiles = []; // each route's own entry file (first traced), the page/controller of the plan
  const folders = [];
  try {
    for (const routeArg of routeArgs) {
      let opts;
      if (framework === 'react-spa') {
        // No app/-directory question for react-spa: resolveRoute already
        // auto-locates the centralized routes table (src/App.tsx/.jsx) by
        // convention from `root` (#66) — an existing controller file needs
        // nothing further.
        opts = isExistingFile(routeArg) ? { framework } : { framework, root, featuresRoot };
      } else {
        opts = isExistingDir(routeArg) ? {} : { appDir: await resolveAppDir() };
      }
      const resolved = resolveRoute(routeArg, opts);
      folders.push(resolved.folder);
      if (resolved.files[0]) entryFiles.push(resolved.files[0]);
      for (const f of resolved.files) tracedFiles.set(f, true);
    }
  } catch (e) {
    console.error(`Route resolution failed: ${e.message}`);
    return;
  }

  console.log(
    `Found ${tracedFiles.size} file(s) across ${folders.length} route(s) in ${formatDuration(elapsedSeconds(traceStart))}: ${folders.map((f) => path.relative(root, f)).join(', ')}`,
  );
  let plan;
  const analysisStart = startTimer();
  if (planner === 'mechanical') {
    console.log('Planning mechanically — reading each file\'s syntax tree, no model call, nothing is written yet...');
    step('analyzing', { provider: 'mechanical', files: tracedFiles.size }, 'No model is involved: each file is classified from what its code does (JSX, its own state, fetch/storage, reducer shape, plain functions) and the reason is shown per layer.');
    try {
      plan = planMechanically([...tracedFiles.keys()], featureName, { entryFiles });
    } catch (e) {
      console.error(`Planning failed: ${e.message}`);
      return;
    }
    if (!plan.units.length) {
      console.error(`Planning failed: none of the ${tracedFiles.size} traced file(s) could be classified (${plan.skipped.map((k) => `${path.basename(k.file)}: ${k.reason}`).join('; ')}).`);
      return;
    }
  } else {
    console.log(
      `Analyzing via "${planAnalysis}" — one LLM call for a single combined plan across all of them, nothing is written yet...`,
    );
    step('analyzing', { provider: planAnalysis, files: tracedFiles.size }, 'One model call proposes the units and layers; the framework then checks every layer name and source file it names and repairs impossible combinations (a controller always gets its page).');
    try {
      plan = await analyzeFiles([...tracedFiles.keys()], featureName, { llm: planAnalysis, llmOptions });
    } catch (e) {
      console.error(`Analysis failed: ${e.message}`);
      return;
    }
  }
  const analysisSeconds = elapsedSeconds(analysisStart);
  console.log(planner === 'mechanical' ? `Plan ready (mechanical, ${formatDuration(analysisSeconds)}).` : `Analysis complete (llm ${formatDuration(analysisSeconds)}).`);

  step('plan-ready', { units: plan.units.length }, plan.layerAdjustments?.length ? `Repaired the plan deterministically: ${plan.layerAdjustments.map((a) => `added ${a.added.join(', ')} to ${a.unit}`).join('; ')} (a controller composes a same-named page). Nothing is written until you approve.` : 'Nothing is written until you approve this plan.');
  console.log('');
  console.log(renderPlanTable(plan));
  if (plan.skipped?.length) console.log(`Left out (not a layer of their own): ${plan.skipped.map((k) => `${path.basename(k.file)} — ${k.reason}`).join('; ')}`);
  console.log('');

  if (!isYes(await ask('Approve this plan and build it now? [y/N]: '))) {
    console.log('Import cancelled — nothing written.');
    return;
  }

  step('scaffolding', { feature: plan.feature }, 'Layer files come from Construct\'s own templates in build order (domain → service → workflow → hook → component → page → controller); no model is involved.');
  const { results, cancelled: fillCancelled } = await executeImportPlan(root, plan, { llm: fillWithLlm ? importFill : undefined, llmOptions, onStep: (s) => step(s.phase, s.detail, s.phase === 'filling' ? 'The model ports this one file; if its output is unusable the file keeps its scaffolded stub and breadcrumb.' : undefined) });
  reportImport(root, results, fillWithLlm ? importFill : undefined, plan.feature, planner === 'mechanical' ? 0 : 1, analysisSeconds);
  onWritten?.({ root, plan, results });
  if (fillCancelled) {
    step('cancelled', { during: 'filling' });
    console.log('Cancelled — files not yet filled were left as their TODO(import) stubs; nothing was half-written.');
    return;
  }

  console.log('');
  // A model's most common slip is the spelling of a sibling import (`../services/ordersApi` for `OrdersApi.tsx`); fixing it is exact-match work, so it is done here instead of by a retry.
  const importRepairs = repairRelativeImports(results.flatMap((r) => r.files));
  if (importRepairs.length) {
    step('validating', { feature: plan.feature }, `Fixed the spelling of ${importRepairs.length} relative import(s) that matched a generated file only by case; no model call was needed.`);
    for (const r of importRepairs) console.log(`Import repaired in ${path.relative(root, r.file)}: '${r.from}' -> '${r.to}'`);
  }
  // The public API is deterministic work, not a model's: export every new layer file from index.ts (with a JSDoc line each) so SLICE-003/READ-003 never fire on what we just generated.
  const apiSync = syncPublicApi(root, plan.feature);
  if (apiSync.changed) console.log(`Updated ${apiSync.path} (the feature's public API) with the new exports.`);
  step('validating', { feature: plan.feature }, 'Runs every construct-validate enforcer on the new feature. The model\'s output is only trusted once this passes.');
  console.log(`Running validate --feature ${plan.feature} ...`);
  const validateStart = startTimer();
  const { violations } = aggregateValidation(root, DEFAULT_ENFORCERS);
  let scoped = violations.filter((v) => v.file.startsWith(`${featuresRoot}/${plan.feature}/`));
  console.log(formatReport(scoped, { format: 'text' }));
  console.log(`Validated in ${formatDuration(elapsedSeconds(validateStart))}.`);

  // #496/#601 -- offer a real correction pass, not just the report: only when this run already
  // called the model once (fillWithLlm) and only against files this import itself just wrote, so
  // a pre-existing violation elsewhere in the project is never silently "fixed" without being asked
  // about. Bounded (autoFixViolations' own maxAttempts, default 2) and interruptible the same way
  // the rest of this wizard is -- Ctrl+C at any point stops it; there is no separate stop control
  // to build here.
  const importedRelFiles = new Set(results.flatMap((r) => r.files).map((f) => path.relative(root, f)));
  const fixableViolations = scoped.filter((v) => importedRelFiles.has(v.file));
  if (fillWithLlm && fixableViolations.length) {
    const affectedFiles = [...new Set(fixableViolations.map((v) => v.file))];
    const wantsFix = isYes(
      await ask(
        `Try to auto-fix ${fixableViolations.length} violation(s) in ${affectedFiles.length} file(s) with "${importFill}"? It plans first, then keeps trying each file (up to 5 attempts, each told what earlier attempts left behind) and stops early if it stops making progress. Cancel or Ctrl+C stops it at any time. [y/N]: `,
      ),
    );
    if (wantsFix) {
      step('auto-fixing', { files: affectedFiles }, 'Errors first, then files with the most violations. Each retry is told what earlier attempts left behind and sees the other files of this unit; it stops early if two attempts in a row change nothing.');
      const { fixed, stillFailing, cancelled: fixCancelled } = await autoFixViolations(
        root,
        affectedFiles,
        (r) => aggregateValidation(r, DEFAULT_ENFORCERS),
        {
          llm: importFill,
          llmOptions,
          siblingFiles: [...importedRelFiles],
          onPlan: (plan) => {
            console.log(`Fix plan (${plan.length} file(s), errors first):`);
            for (const item of plan) {
              console.log(`  ${item.file}`);
              for (const v of item.violations) console.log(`    - ${v.rule} (line ${v.line}): ${v.message}${v.suggestedFix ? ` → ${v.suggestedFix}` : ''}`);
            }
          },
          onAttempt: ({ file, attempt, violations: v }) => {
            step('auto-fixing', { files: affectedFiles, file, attempt });
            console.log(`  Attempt ${attempt} on ${file}: fixing ${v.length} violation(s) (${v.map((x) => x.rule).join(', ')})...`);
          },
        },
      );
      if (fixCancelled) {
        step('cancelled', { during: 'auto-fixing' });
        console.log('Cancelled — auto-fix stopped; files keep their last valid content.');
        return;
      }
      if (fixed.length) console.log(`Fixed: ${fixed.map((f) => `${f.file} (${f.attempts} attempt(s))`).join(', ')}`);
      if (stillFailing.length) {
        console.log(`Still failing after auto-fix — review manually: ${stillFailing.map((f) => `${f.file} (${f.reason}, ${f.attempts} attempt(s))`).join(', ')}`);
      }
      const revalidated = aggregateValidation(root, DEFAULT_ENFORCERS);
      scoped = revalidated.violations.filter((v) => v.file.startsWith(`${featuresRoot}/${plan.feature}/`));
      console.log(formatReport(scoped, { format: 'text' }));
    }
  }

  const allFiles = results.flatMap((r) => r.files);
  const todoFiles = allFiles.filter((f) => fs.readFileSync(f, 'utf8').includes('TODO(import)'));
  if (fillWithLlm) {
    console.log(`Review the ${allFiles.length - todoFiles.length} LLM-written file(s) above against their source before trusting them.`);
  }
  if (fillWithLlm && !todoFiles.length) {
    step('done', { files: allFiles.length, todo: 0 });
    return;
  }
  console.log(
    todoFiles.length
      ? `${todoFiles.length} of ${allFiles.length} file(s) still have a TODO(import) marker to fill in — that's what's left before this feature is done:`
      : 'No TODO(import) markers left — nothing further needed from this pass.',
  );
  for (const f of todoFiles) console.log(`  ${path.relative(root, f)}`);
  step('done', { files: allFiles.length, todo: todoFiles.length });
}

export async function runImportRouteWizard(routeArg, options = {}) {
  const lineSource = makeLineSource(process.stdin);
  async function ask(promptText) {
    process.stdout.write(promptText);
    const { done, value } = await lineSource.next();
    return done ? '' : value;
  }
  await importRouteWizard(ask, routeArg, options);
}

// ---- event-driven adapter for non-terminal callers (e.g. a chat UI) -------
//
// `importRouteWizard(ask, seedRoute)` above is already decoupled from real
// stdin/stdout via its abstract `ask` callback, but it's still shaped for a
// blocking terminal session: every prompt and every progress line goes out
// via a synchronous `console.log`/`console.warn`/`console.error` call
// interleaved with `await ask(...)`. A chat UI instead needs a running,
// incremental conversation — each progress line delivered the moment it
// happens, and the "next question" delivered as its own event rather than
// blocking a request/response cycle on the terminal's stdin.
//
// This wraps the *existing*, unmodified `importRouteWizard` rather than
// rewriting it: every console call made anywhere inside the wizard's run
// (including from functions it calls into, like `reportImport` and
// `formatReport`) is captured as an ordered `{ type: 'log', text }` event,
// and `ask` is driven by an externally-resolved promise instead of a real
// line source. The REPL/CLI/wizard tests exercise `importRouteWizard` and
// `runImportRouteWizard` directly and are completely unaffected by this.
//
// #80 — per-session log capture instead of a global monkey-patch. Directly
// reassigning console.log/warn/error per call (the original shape of this
// adapter) corrupts concurrent sessions, not just serializes them: a second
// call's "original" is actually the first call's already-wrapped functions
// (so session A's output leaks into session B's captured events too), and
// whichever session's `finally` runs first restores the *real* original
// console methods out from under the other session, which is still mid-run.
// Node's AsyncLocalStorage instead keeps a per-session `onEvent` scoped to
// the exact async call chain it was started in (correctly propagated across
// every `await` inside that chain, including into functions the wizard
// calls into) — console.log/warn/error are wrapped exactly ONCE, at module
// load, and every wrapper always calls the real original *and*, only if a
// store is active for the currently-executing async chain, forwards to it.
const wizardLogStore = new AsyncLocalStorage();
let wizardConsolePatched = false;

function ensureWizardConsolePatched() {
  if (wizardConsolePatched) return;
  wizardConsolePatched = true;
  for (const kind of ['log', 'warn', 'error']) {
    const original = console[kind].bind(console);
    console[kind] = (...parts) => {
      original(...parts);
      const onEvent = wizardLogStore.getStore();
      if (onEvent) onEvent({ kind, type: 'log', text: parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ') });
    };
  }
}

/**
 * Run the interactive `construct import --route` wizard as an event stream instead of a terminal session, so the Cockpit can drive it over a WebSocket: every prompt arrives as a `{type: 'question', text}` event and every console line the wizard prints as a `{type: 'log', kind, text}` event.
 *
 * @param {(event: object) => void} onEvent Receives questions and log lines.
 * @param {string} [seedRoute] Route to start from, when the caller already knows it.
 * @param {object} [providers] Injectable dependencies (LLM provider and friends) for tests.
 * @returns {{answer:(text:string) => boolean, cancel:() => void, done:Promise<any>, review:() => Promise<void>}} `review` runs the read-only plan-vs-written review (#603); `answer` feeds the reply to the pending question (`false` when none is pending); `cancel` aborts an in-flight model call and stops the run (#599); `done` settles when the wizard finishes.
 */
export function runImportRouteWizardEventDriven(onEvent, seedRoute, providers) {
  ensureWizardConsolePatched();
  let pendingResolve = null;

  function ask(promptText, hint) {
    onEvent({ type: 'question', text: promptText, ...(hint?.expects ? { expects: hint.expects } : {}) });
    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  }

  /** Feed the user's answer to whichever `ask()` call is currently pending.
   * Returns false (a no-op) if the wizard isn't currently waiting on one —
   * e.g. an answer arriving after the session already finished. */
  function answer(text) {
    if (!pendingResolve) return false;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(text);
    return true;
  }

  // #599 -- framework steps and the model's own output are two different event types on purpose:
  // `{type:'step', phase, detail}` vs `{type:'thought', text}`, so a UI can render them distinctly.
  const controller = new AbortController();
  let reviewable = null; // what the wizard has written so far, once something has been (#603)
  let reviewController = null;
  /** Cancel the run: aborts an in-flight model call and declines any pending question. */
  function cancel() {
    controller.abort();
    reviewController?.abort();
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve('');
    }
  }

  const done = wizardLogStore
    .run(onEvent, () => importRouteWizard(ask, seedRoute, {
      ...providers,
      signal: controller.signal,
      onStep: (s) => onEvent({ type: 'step', ...s }),
      onThought: (text) => onEvent({ type: 'thought', text }),
      onWritten: (written) => {
        reviewable = written;
        onEvent({ type: 'reviewable' });
      },
    }))
    .catch((e) => {
      onEvent({ type: 'log', kind: 'error', text: `Error: ${e.message}` });
    })
    .finally(() => {
      onEvent({ type: 'done' });
    });

  /** #603 -- a read-only model review of what has been written against the approved plan; available as soon as one file exists, including while a later question is still pending. Findings arrive as one `{type:'review'}` event. */
  async function review() {
    if (!reviewable) {
      onEvent({ type: 'log', kind: 'error', text: 'Nothing to review yet -- a review is available once the wizard has written at least one file.' });
      return;
    }
    if (reviewController) return;
    reviewController = new AbortController();
    onEvent({ type: 'review', phase: 'running' });
    try {
      const provider = providers?.planAnalysis && providers.planAnalysis !== 'ollama' ? providers.planAnalysis : 'claude';
      const { findings } = await reviewImport(reviewable.root, reviewable.plan, reviewable.results, { llm: provider, llmOptions: { signal: reviewController.signal } });
      onEvent({ type: 'review', phase: 'done', findings });
    } catch (e) {
      onEvent({ type: 'review', phase: 'failed' });
      onEvent({ type: 'log', kind: 'error', text: e.cancelled ? 'Review cancelled.' : `Review failed: ${e.message}` });
    } finally {
      reviewController = null;
    }
  }

  return { answer, cancel, done, review };
}
