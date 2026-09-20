import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { makeLineSource } from './line-source.mjs';
import { createFeature, generateLayer, generateVertical, layerFromGeneratedFile, fillGeneratedFile } from './generators.mjs';
import { generateServiceFromSpec } from './service-generator.mjs';
import { write, ensureDir } from './fs.mjs';
import { loadConfig, findProjectRoot, DEFAULT_RULES, normalizeFramework } from './config.mjs';
import { formatReport, exitCodeForViolations, ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { aggregateValidation } from './registry.mjs';
import { validateArchitecture } from './architecture-enforcer.mjs';
import { syncPublicApi } from './api-composer.mjs';
import { summarizeUnit, listUnits, unitApiManifest, renderUnitMarkdown } from './engine/unitSummary.mjs';
import { analyzeImpact, proposeSeedsFromText, impactApiManifest, renderImpactMarkdown } from './engine/impact.mjs';
import { prHealth, renderPrHealthMarkdown, prHealthApiManifest } from './engine/prHealth.mjs';
import { summarizeProject, summarizeCompact, summarizeProse, summarizeSince } from './summarize.mjs';
import { moveLayerFile, renameLayerFile } from './refactor.mjs';
import { importVertical, importPlan, analyzeFiles, executeImportPlan } from './import.mjs';
import { resolveRoute } from './route-resolver.mjs';
import { DEFAULT_ENFORCERS } from './engine/defaultEnforcers.mjs';
import { runPipeline } from './engine/pipeline.mjs';
import { validateEnvelope } from './engine/envelope.mjs';
import { ingestPage } from './engine/pageTransformer.mjs';
import { generateWorkflow } from './engine/workflowGenerator.mjs';
import { generateController } from './engine/controllerBinder.mjs';
import { startTimer, elapsedSeconds, formatDuration } from './timing.mjs';
import { explainSource, renderExplained } from './engine/workflowExplain.mjs';
import { listWorkflowSourceFiles, readWorkflowSource } from './engine/workflowSource.mjs';

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
  // Only real severity-bearing rules get a scaffolded `<id>: <severity>` line — a
  // numeric-override entry like READ-002-max-loc (see config.mjs's DEFAULT_RULES) has
  // no severity to print and is left out entirely; the project inherits its default
  // (200) until someone opts into an override themselves.
  const arch = `version: 1\npreset: strict-nextjs\n\nproject:\n  framework: ${framework}\n  language: typescript\n\nfeatures:\n  root: features\n\nrules:\n${Object.entries(DEFAULT_RULES).filter(([, v]) => !v.numeric).map(([k, v]) => `  ${k}: ${v.severity}`).join('\n')}\n\nexceptions: []\n`;
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
  const t = startTimer();
  const p = createFeature(root, args[1]);
  console.log(`Created feature ${args[1]} at ${path.relative(root, p)} (${formatDuration(elapsedSeconds(t))})`);
}

// Ticket 7.2/7.3/7.4/7.5's `--from`/`--bind`/`--openapi` paths below are all
// zero-LLM: they compile a real input (JSX export, JSON state graph, an
// already-generated Props interface, an OpenAPI spec) deterministically via
// the src/engine/* modules or service-generator.mjs. `--llm <provider>`
// (optional, mirrors `construct import`'s flag) only applies to the plain
// fallback path at the bottom of this function: when given, it calls that
// provider once to write a real implementation in place of the template
// stub — scoped strictly to that one file's own body (generators.mjs's
// fillGeneratedFile). Which layers/files get created is decided the exact
// same deterministic way regardless of --llm; the flag only changes what
// ends up *inside* a file generate() was already going to create via the
// plain stub path. Omitting --llm leaves the scaffolded template stub
// exactly as before this existed.
export async function generate(args) {
  if (args[0] === 'layer') return generateVerticalSlice(args);
  const layer = args[0], name = args[1], fi = args.indexOf('--feature');
  if (!layer || !name || fi < 0 || !args[fi + 1]) {
    throw new ConstructError('Usage: construct generate <layer> <name> --feature <feature> [--openapi <spec>] [--llm <provider>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot(args);
  const feature = args[fi + 1];
  // Ticket 7.2 (#112): `construct create/generate page <name> --feature <f> --from
  // <path>` ingests an externally-authored JSX file (e.g. a Subframe export) instead
  // of scaffolding the usual stub template -- see src/engine/pageTransformer.mjs.
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
  // src/engine/workflowGenerator.mjs. Mirrors the page ingestion --from convention.
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
    const { file, events } = generateWorkflow(root, name, feature, descriptor);
    console.log(`Created ${path.relative(root, file)} (${formatDuration(elapsedSeconds(t))}, ${events.length} event(s): ${events.join(', ') || 'none'})`);
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
  // template -- see src/service-generator.mjs.
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
function reportFill(root, { file, status, reason }, timingNote = '') {
  const rel = path.relative(root, file);
  if (status === 'filled') {
    console.log(`Created + LLM-filled ${rel}${timingNote}`);
    return;
  }
  const what = status === 'rejected' ? "the model's output was rejected" : 'the LLM call failed';
  console.log(`Created ${rel} (stub kept — ${what}: ${reason})${timingNote}`);
  process.exitCode = EXIT_CODES.INTERNAL_ERROR;
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
  if (!ok) process.exitCode = exitCodeForViolations(violations);
}

const UNIT_VALUE_FLAGS = new Set(['--dir', '--feature', '--format', '--since', '--kind', '--detail', '--include']);
const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positionalOf = (args) => args.find((a, i) => !a.startsWith('--') && !UNIT_VALUE_FLAGS.has(args[i - 1]));

/** `construct summarize <unit-ref> [--kind K] [--detail brief|standard|full] [--include a,b] [--format json|markdown]`,
 * `construct summarize --list [--kind K]`, `construct summarize --usage`. Deterministic unit summaries for bots and
 * humans (src/engine/unitSummary.mjs); errors are structured JSON on stdout with a non-zero exit code. */
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
  if (!result.ok) process.exitCode = result.error.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR;
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
  if (output.status === 'aborted') process.exitCode = exitCodeForViolations(output.diagnostics);
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

/** `construct create feature <name>` | `construct create layer <name> --layers ... [--llm <provider>]`
 * | `construct create <layer> <name> --feature <feature> [--llm <provider>]`
 * | `construct create service <name> --feature <feature> --openapi <spec>` (Ticket 7.5).
 * `feature` creation has nothing fillable (just types.ts/index.ts
 * boilerplate) so `--llm` only ever applies to the layer/single-layer
 * forms, which `generate(args)` itself already handles (see its own doc
 * comment) — this just reports whether that happened. */
export async function create(args) {
  if (args[0] === 'feature') {
    await feature(['create', ...args.slice(1)]);
    printAttribution('scaffolded the file(s) above from templates', '0 calls — filling in the logic is a separate step, by you or whichever LLM you choose');
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
    printAttribution('scaffolded the file(s) above from templates', '0 calls — filling in the logic is a separate step, by you or whichever LLM you choose');
  }
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
      changed = spawnSync('git', ['diff', '--name-only', since], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      throw new ConstructError(`Could not diff against "${since}": ${String(e.message || e)}`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
    if (changed.status !== 0) throw new ConstructError(`Could not diff against "${since}": ${String(changed.stderr || '').trim() || 'git failed'}. Is ${root} a git repository, and does that ref exist?`, { exitCode: EXIT_CODES.USAGE_ERROR });
    for (const p of changed.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) seeds.push({ path: p, method: 'changed-files', provenance: 'explicit' });
  }
  const ticketFile = flagValue(args, '--ticket-file');
  const ticket = ticketFile ? fs.readFileSync(path.resolve(root, ticketFile), 'utf8') : flagValue(args, '--ticket');
  if (ticket) {
    const maxSeeds = flagValue(args, '--max-seeds');
    const proposal = proposeSeedsFromText(root, ticket, maxSeeds ? { maxSeeds: Number(maxSeeds) } : {});
    if (!proposal.ok) {
      console.log(JSON.stringify(proposal, null, 2));
      process.exitCode = EXIT_CODES.USAGE_ERROR;
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
  if (!result.ok) process.exitCode = result.error.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR;
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
  if (!result.ok) process.exitCode = result.error.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR;
  return format === 'json';
}

/** `construct research summarize ...` | `construct research doctor ...` | `construct research workflow ...`
 * | `construct research impact ...`. */
export async function research(args) {
  let jsonOnly = false;
  if (args[0] === 'summarize') await summarize(args.slice(1));
  else if (args[0] === 'doctor') await doctor(args.slice(1));
  else if (args[0] === 'workflow') jsonOnly = await researchWorkflow(args.slice(1));
  else if (args[0] === 'impact') jsonOnly = await researchImpact(args.slice(1));
  else throw new ConstructError('Usage: construct research summarize|doctor|workflow|impact ...', { exitCode: EXIT_CODES.USAGE_ERROR });
  if (!jsonOnly) printAttribution('produced the read-only report above', '0 calls');
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
    process.exitCode = EXIT_CODES.INTERNAL_ERROR;
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
export async function importRouteWizard(ask, seedRoute, { planAnalysis = 'claude', importFill = 'claude' } = {}) {
  // Whole-feature plan analysis is deliberately hosted-model-only (#96) — the
  // same guardrail ui/server's Settings enforces, repeated here so a direct
  // caller can't route it to a local model either.
  if (planAnalysis === 'ollama') {
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
  const traceStart = startTimer();
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
    `Found ${tracedFiles.size} file(s) across ${folders.length} route(s) in ${formatDuration(elapsedSeconds(traceStart))}: ${folders.map((f) => path.relative(root, f)).join(', ')}`,
  );
  console.log(
    `Analyzing via "${planAnalysis}" — one LLM call for a single combined plan across all of them, nothing is written yet...`,
  );
  let plan;
  const analysisStart = startTimer();
  try {
    plan = await analyzeFiles([...tracedFiles.keys()], featureName, { llm: planAnalysis });
  } catch (e) {
    console.error(`Analysis failed: ${e.message}`);
    return;
  }
  const analysisSeconds = elapsedSeconds(analysisStart);
  console.log(`Analysis complete (llm ${formatDuration(analysisSeconds)}).`);

  console.log('');
  console.log(renderPlanTable(plan));
  console.log('');

  if (!isYes(await ask('Approve this plan and build it now? [y/N]: '))) {
    console.log('Import cancelled — nothing written.');
    return;
  }

  const { results } = await executeImportPlan(root, plan, { llm: fillWithLlm ? importFill : undefined });
  reportImport(root, results, fillWithLlm ? importFill : undefined, plan.feature, 1, analysisSeconds);

  console.log('');
  console.log(`Running validate --feature ${plan.feature} ...`);
  const validateStart = startTimer();
  const { violations } = aggregateValidation(root, DEFAULT_ENFORCERS);
  const scoped = violations.filter((v) => v.file.startsWith(`${featuresRoot}/${plan.feature}/`));
  console.log(formatReport(scoped, { format: 'text' }));
  console.log(`Validated in ${formatDuration(elapsedSeconds(validateStart))}.`);

  const allFiles = results.flatMap((r) => r.files);
  const todoFiles = allFiles.filter((f) => fs.readFileSync(f, 'utf8').includes('TODO(import)'));
  if (fillWithLlm) {
    console.log(`Review the ${allFiles.length - todoFiles.length} LLM-written file(s) above against their source before trusting them.`);
  }
  if (fillWithLlm && !todoFiles.length) return;
  console.log(
    todoFiles.length
      ? `${todoFiles.length} of ${allFiles.length} file(s) still have a TODO(import) marker to fill in — that's what's left before this feature is done:`
      : 'No TODO(import) markers left — nothing further needed from this pass.',
  );
  for (const f of todoFiles) console.log(`  ${path.relative(root, f)}`);
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

export function runImportRouteWizardEventDriven(onEvent, seedRoute, providers) {
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
    .run(onEvent, () => importRouteWizard(ask, seedRoute, providers))
    .catch((e) => {
      onEvent({ type: 'log', kind: 'error', text: `Error: ${e.message}` });
    })
    .finally(() => {
      onEvent({ type: 'done' });
    });

  return { answer, done };
}
