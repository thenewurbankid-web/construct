import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { makeLineSource } from './line-source.mjs';
import { createFeature, generateLayer, generateVertical } from './generators.mjs';
import { write, ensureDir } from './fs.mjs';
import { loadConfig, findProjectRoot, DEFAULT_RULES, normalizeFramework } from './config.mjs';
import { formatReport, exitCodeForViolations, ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { aggregateValidation } from './registry.mjs';
import { validateArchitecture } from './architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from './soc-enforcer.mjs';
import { validateReadability } from './readability-enforcer.mjs';
import { syncPublicApi, checkPublicApiDrift } from './api-composer.mjs';
import { summarizeProject, summarizeCompact, summarizeProse, summarizeSince } from './summarize.mjs';
import { moveLayerFile, renameLayerFile } from './refactor.mjs';
import { importVertical, importPlan, analyzeFiles, executeImportPlan } from './import.mjs';
import { resolveRoute } from './route-resolver.mjs';

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
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files that mark a module as "available" for construct doctor. These are
// existence checks only (never imports), so they report accurately even
// before the owning module has landed in the working tree.
const ENFORCER_MODULES = [
  { name: 'architecture-enforcer', file: 'src/architecture-enforcer.mjs' },
  { name: 'soc-enforcer', file: 'src/soc-enforcer.mjs' },
  { name: 'api-composer', file: 'src/api-composer.mjs' },
  { name: 'readability-enforcer', file: 'src/readability-enforcer.mjs' },
  { name: 'summarize', file: 'src/summarize.mjs' },
];

// `construct init [dir] [--framework nextjs|react-spa]` — the entry-point
// scaffold this writes is the one genuinely framework-specific part of
// init: nextjs gets a physical app/page.tsx (Next.js's own file-system
// routing); react-spa gets src/main.tsx (the real Vite/CRA-style bootstrap
// entry) + src/App.tsx (the centralized react-router table #65/#66/#67
// treat as that framework's "route" layer) with the core feature's
// controller actually registered in it — not just a page.tsx clone. Framework
// defaults to nextjs when --framework is omitted, so every existing caller
// of `construct init` keeps getting exactly what it got before.
export async function init(args) {
  const dir = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
  const fi = args.indexOf('--framework');
  const framework = normalizeFramework(fi >= 0 ? args[fi + 1] : undefined);
  ensureDir(dir);
  const arch = `version: 1\npreset: strict-nextjs\n\nproject:\n  framework: ${framework}\n  language: typescript\n\nfeatures:\n  root: features\n\nrules:\n${Object.entries(DEFAULT_RULES).map(([k, v]) => `  ${k}: ${v.severity}`).join('\n')}\n\nexceptions: []\n`;
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
}

export async function feature(args) {
  if (args[0] !== 'create' || !args[1]) {
    throw new ConstructError('Usage: construct feature create <name>', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const p = createFeature(root, args[1]);
  console.log(`Created feature ${args[1]} at ${path.relative(root, p)}`);
}

export async function generate(args) {
  if (args[0] === 'layer') return generateVerticalSlice(args);
  const layer = args[0], name = args[1], fi = args.indexOf('--feature');
  if (!layer || !name || fi < 0 || !args[fi + 1]) {
    throw new ConstructError('Usage: construct generate <layer> <name> --feature <feature>', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  console.log(`Created ${path.relative(root, generateLayer(root, layer, name, args[fi + 1]))}`);
}

// `construct generate layer <name> --feature <feature> --layers <l1,l2,...>`
// scaffolds one logical unit across several layers in a single command,
// always in dependency order (see generators.mjs's LAYER_ORDER) regardless of
// the order --layers lists them in.
async function generateVerticalSlice(args) {
  const name = args[1], fi = args.indexOf('--feature'), li = args.indexOf('--layers');
  if (!name || fi < 0 || !args[fi + 1] || li < 0 || !args[li + 1]) {
    throw new ConstructError(
      'Usage: construct generate layer <name> --feature <feature> --layers <layer1,layer2,...>',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  const layers = args[li + 1].split(',').map((l) => l.trim()).filter(Boolean);
  for (const file of generateVertical(root, name, args[fi + 1], layers)) {
    console.log(`Created ${path.relative(root, file)}`);
  }
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

const DEFAULT_ENFORCERS = [
  { name: 'architecture', validate: validateArchitecture },
  { name: 'separation-of-concerns', validate: validateSeparationOfConcerns },
  { name: 'readability', validate: validateReadability },
  { name: 'public-api-drift', validate: checkPublicApiDrift },
];

export async function validate(args) {
  const root = getRoot(args);
  const { violations, ok } = aggregateValidation(root, DEFAULT_ENFORCERS);
  const fi = args.indexOf('--format');
  const format = fi >= 0 && args[fi + 1] === 'json' ? 'json' : 'text';
  console.log(formatReport(violations, { format }));
  if (!ok) process.exitCode = exitCodeForViolations(violations);
}

export async function summarize(args) {
  const root = getRoot(args);
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

export async function doctor(args) {
  console.log('Construct doctor');
  const root = getRoot(args);
  for (const c of ['node', 'npm']) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    console.log(`${c}: ${r.status === 0 ? r.stdout.trim() : 'missing'}`);
  }
  console.log(`architecture.yml: ${fs.existsSync(path.join(root, 'architecture.yml')) ? 'present' : 'missing'}`);
  console.log('Enforcer modules:');
  for (const { name, file } of ENFORCER_MODULES) {
    const available = fs.existsSync(path.join(packageRoot, file));
    console.log(`  ${name}: ${available ? 'available' : 'not yet available'}`);
  }
}

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

/** `construct create feature <name>` | `construct create layer <name> --layers ...`
 * | `construct create <layer> <name> --feature <feature>`. */
export async function create(args) {
  if (args[0] === 'feature') await feature(['create', ...args.slice(1)]);
  else await generate(args);
  printAttribution('scaffolded the file(s) above from templates', '0 calls — filling in the logic is a separate step, by you or whichever LLM you choose');
}

/** `construct research summarize ...` | `construct research doctor ...`. */
export async function research(args) {
  if (args[0] === 'summarize') await summarize(args.slice(1));
  else if (args[0] === 'doctor') await doctor(args.slice(1));
  else throw new ConstructError('Usage: construct research summarize|doctor ...', { exitCode: EXIT_CODES.USAGE_ERROR });
  printAttribution('produced the read-only report above', '0 calls');
}

/** `construct refactor move <name> --feature <f> --from <layer> --to <layer>`
 * | `construct refactor rename <name> <newName> --feature <f> --layer <layer>`.
 * Purely mechanical (relocate + rewrite every importer's path) — never
 * touches a file's own content. Reports the result, then re-validates just
 * the moved/renamed file so a naming/purity mismatch in its new home shows
 * up immediately instead of on the next full `construct validate`. */
export async function refactor(args) {
  if (args[0] === 'move') return refactorMove(args.slice(1));
  if (args[0] === 'rename') return refactorRename(args.slice(1));
  throw new ConstructError('Usage: construct refactor move|rename ...', { exitCode: EXIT_CODES.USAGE_ERROR });
}

// This printed line is the entire audit trail for a refactor command by
// design (no persistent log) — every construct-driven change gets one clear,
// scannable summary; a file changed without one wasn't done by the tool.
function reportRelocation(root, verb, result) {
  console.log(`${verb} ${result.from} -> ${result.to} (${result.importersUpdated} importer(s) updated)`);
  const { violations } = validateArchitecture(root, { files: [result.to] });
  if (violations.length) console.log(formatReport(violations, { format: 'text' }));
  printAttribution('relocated/renamed the file and rewrote every importer\'s path', '0 calls — content and the exported identifier are untouched');
}

async function refactorMove(args) {
  const name = args[0], fi = args.indexOf('--feature'), fromI = args.indexOf('--from'), toI = args.indexOf('--to');
  if (!name || fi < 0 || !args[fi + 1] || fromI < 0 || !args[fromI + 1] || toI < 0 || !args[toI + 1]) {
    throw new ConstructError(
      'Usage: construct refactor move <name> --feature <feature> --from <layer> --to <layer>',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  reportRelocation(root, 'Moved', moveLayerFile(root, args[fi + 1], name, args[fromI + 1], args[toI + 1]));
}

async function refactorRename(args) {
  const name = args[0], newName = args[1], fi = args.indexOf('--feature'), li = args.indexOf('--layer');
  if (!name || !newName || fi < 0 || !args[fi + 1] || li < 0 || !args[li + 1]) {
    throw new ConstructError(
      'Usage: construct refactor rename <name> <newName> --feature <feature> --layer <layer>',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const root = getRoot(args);
  reportRelocation(root, 'Renamed', renameLayerFile(root, args[fi + 1], name, newName, args[li + 1]));
}

/** `construct import <name> --feature <feature> --layers <l1,l2,...> --from <path> [--llm <provider>]`
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
 * once per unit, in one command. */
export async function importCommand(args) {
  if (args[0] === '--route') {
    throw new ConstructError(
      'construct import --route <path> is a standalone interactive command — run it directly from your shell (not from inside `construct repl`, which is already reading its own input).',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
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
  const { source, files, llmFilled } = importVertical(root, name, args[fi + 1], layers, args[fromI + 1], { llm });
  reportImport(root, [{ name, source, files }], llmFilled ? llm : undefined);
}

async function importFromPlan(args, llm) {
  const planI = args.indexOf('--plan');
  if (!args[planI + 1]) {
    throw new ConstructError('Usage: construct import --plan <path> [--llm <provider>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const { feature, results } = importPlan(root, args[planI + 1], { llm });
  reportImport(root, results, llm, feature);
}

// Shared reporting for both import forms — one clear tool/llm-attributed
// summary either way, matching every other capability group.
function reportImport(root, results, llm, feature, analysisCalls = 0) {
  let totalFiles = 0;
  for (const r of results) {
    console.log(`${r.name}: ${llm ? 'scaffolded + LLM-filled' : 'scaffolded'} ${r.files.length} file(s) from ${r.source}`);
    for (const file of r.files) console.log(`  ${path.relative(root, file)}`);
    totalFiles += r.files.length;
  }
  const featureNote = feature ? ` --feature ${feature}` : '';
  const analysisNote = analysisCalls ? `${analysisCalls} call(s) to analyze the route + ` : '';
  if (llm) {
    console.log(`Next: review the ported logic above (diff against the source), then run validate${featureNote}.`);
    printAttribution(
      `scaffolded ${totalFiles} file(s) across ${results.length} logical unit(s)`,
      `${analysisNote}${totalFiles} call(s) via "${llm}" to write the ported logic into each file — review it before trusting it`,
    );
  } else {
    console.log(`Next (needs judgment, not a tool): fill in each TODO(import) marker across ${results.length} logical unit(s), then run validate${featureNote}.`);
    printAttribution(
      `scaffolded ${totalFiles} file(s) across ${results.length} logical unit(s) and wrote a TODO(import) breadcrumb in each`,
      analysisCalls
        ? `${analysisNote}0 calls to write the logic — that's next, by you or whichever LLM you choose`
        : '0 calls — reading the source(s) and writing the ported logic is next, by you or whichever LLM you choose',
    );
  }
}

// ---- import --route: interactive, whole-feature import wizard -------------
//
// A standalone interactive command — bin/construct.mjs dispatches it
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
export async function importRouteWizard(ask, seedRoute) {
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
      await ask(`Path to your Next.js app/ directory (needed to resolve a URL route)${guess ? ` [${path.relative(root, guess)}]` : ''}: `)
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
    const answer = (await ask(prompt)).trim();
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

  console.log(`Tracing ${routeArgs.join(', ')} ...`);
  const tracedFiles = new Map(); // absolute path -> true, deduped across routes
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
      for (const f of resolved.files) tracedFiles.set(f, true);
    }
  } catch (e) {
    console.error(`Route resolution failed: ${e.message}`);
    return;
  }

  console.log(
    `Found ${tracedFiles.size} file(s) across ${folders.length} route(s): ${folders.map((f) => path.relative(root, f)).join(', ')}`,
  );
  console.log(
    `Analyzing via "claude" — one LLM call for a single combined plan across all of them, nothing is written yet...`,
  );
  let plan;
  try {
    plan = analyzeFiles([...tracedFiles.keys()], featureName, { llm: 'claude' });
  } catch (e) {
    console.error(`Analysis failed: ${e.message}`);
    return;
  }

  console.log('');
  console.log(renderPlanTable(plan));
  console.log('');

  if (!isYes(await ask('Approve this plan and build it now? [y/N]: '))) {
    console.log('Import cancelled — nothing written.');
    return;
  }

  const { results } = executeImportPlan(root, plan, { llm: fillWithLlm ? 'claude' : undefined });
  reportImport(root, results, fillWithLlm ? 'claude' : undefined, plan.feature, 1);

  console.log('');
  console.log(`Running validate --feature ${plan.feature} ...`);
  const { violations } = aggregateValidation(root, DEFAULT_ENFORCERS);
  const scoped = violations.filter((v) => v.file.startsWith(`${featuresRoot}/${plan.feature}/`));
  console.log(formatReport(scoped, { format: 'text' }));

  const allFiles = results.flatMap((r) => r.files);
  if (fillWithLlm) {
    console.log(`Review the ${allFiles.length} LLM-written file(s) above against their source before trusting them — that's what's left.`);
  } else {
    const todoFiles = allFiles.filter((f) => fs.readFileSync(f, 'utf8').includes('TODO(import)'));
    console.log(
      todoFiles.length
        ? `${todoFiles.length} of ${allFiles.length} file(s) still have a TODO(import) marker to fill in — that's what's left before this feature is done:`
        : 'No TODO(import) markers left — nothing further needed from this pass.',
    );
    for (const f of todoFiles) console.log(`  ${path.relative(root, f)}`);
  }
}

export async function runImportRouteWizard(routeArg) {
  const lineSource = makeLineSource(process.stdin);
  async function ask(promptText) {
    process.stdout.write(promptText);
    const { done, value } = await lineSource.next();
    return done ? '' : value;
  }
  await importRouteWizard(ask, routeArg);
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

export function runImportRouteWizardEventDriven(onEvent, seedRoute) {
  ensureWizardConsolePatched();
  let pendingResolve = null;

  function ask(promptText) {
    onEvent({ type: 'question', text: promptText });
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

  const done = wizardLogStore
    .run(onEvent, () => importRouteWizard(ask, seedRoute))
    .catch((e) => {
      onEvent({ type: 'log', kind: 'error', text: `Error: ${e.message}` });
    })
    .finally(() => {
      onEvent({ type: 'done' });
    });

  return { answer, done };
}
