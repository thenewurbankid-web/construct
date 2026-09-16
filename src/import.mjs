// Import capability — scaffolds a vertical slice for an existing,
// non-Construct file. Locating the source, scaffolding the layer files, and
// wiring the breadcrumb are always deterministic (reuses generateVertical
// exactly — no new templating), same as create/refactor/research. Writing
// the real ported logic is the one place an LLM call is even offered, and
// only when the caller explicitly opts in with `{ llm: '<provider>' }` —
// the default (no `llm` option) leaves a TODO breadcrumb for a human or a
// separate LLM session to fill in later, same as before this existed.
import fs from 'node:fs';
import path from 'node:path';
import { generateVertical } from './generators.mjs';
import { walk } from './fs.mjs';
import { callLlm, stripCodeFence } from './llm.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

const FOLDER_TO_LAYER = {
  controllers: 'controller', workflows: 'workflow', hooks: 'hook',
  domain: 'domain', services: 'service', pages: 'page', components: 'component',
};

const KNOWN_LAYERS = new Set(Object.values(FOLDER_TO_LAYER));
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
// Test files carry no portable business logic and just waste analysis
// context (or worse, tempt the LLM into proposing a unit "from" a test) —
// a real route directory routinely has them sitting right next to the
// source they cover (e.g. useCpoGate.ts + useCpoGate.test.ts).
const TEST_FILE_RE = /\.(test|spec)\.[^./]+$/;

const LAYER_CONSTRAINTS = {
  domain: 'Pure function(s) only. Never write the words fetch, window, document, localStorage, sessionStorage, or navigator anywhere in the file, even in a comment. No React import.',
  service: 'Owns an external effect on behalf of the feature. Never import React or any react-related package.',
  workflow: 'A state machine (e.g. via xstate\'s setup/createMachine). Never import "react" or any package path containing "react/".',
  hook: 'A React hook — the exported function name must start with "use". May import anything.',
  component: 'Presentation-only, from props. Never write the substring "controllers/", "workflows/", "services/", or "domain/" anywhere in the file, even in a comment.',
  page: 'Presentation composition from props only. Never write "workflows/", "services/", or "domain/" anywhere in the file (even in a comment), never call fetch(), never use useMachine/useActor/createMachine.',
  controller: 'Composes hooks/domain/pages for a route. No import restrictions.',
};

function layerFromGeneratedFile(file) {
  return FOLDER_TO_LAYER[path.basename(path.dirname(file))] || 'component';
}

function breadcrumb(fromAbsPath, intoAbsPath) {
  const relPath = path.relative(path.dirname(intoAbsPath), fromAbsPath).split(path.sep).join('/');
  // Deliberately plain wording — DOMAIN-001 bans certain words (fetch,
  // window, document, ...) anywhere in a domain file, even in a comment, so
  // this stays generic rather than describing what the old file does.
  return `/** TODO(import): port the relevant logic from ${relPath} into this file. */\n`;
}

function buildPortPrompt({ layer, relFile, stubContent, oldContent, oldRelPath }) {
  return [
    'You are porting existing code into one file of a Construct-architecture project.',
    `Target file: ${relFile} (layer: "${layer}").`,
    `Layer constraint: ${LAYER_CONSTRAINTS[layer] || 'none.'}`,
    'Keep the exact exported identifier name(s) already present in the current stub below unchanged — replace only the body with real logic ported from the old source file. Do not invent behavior the old file does not have.',
    '',
    '=== CURRENT STUB (this is the file you are rewriting) ===',
    stubContent,
    '',
    `=== OLD SOURCE FILE (${oldRelPath}, relative to the target file) ===`,
    oldContent,
    '',
    'Return ONLY the new, complete file content. No markdown code fences, no explanation, no commentary — just the raw file content that will be written as-is.',
  ].join('\n');
}

/** Scaffold `layers` for one logical unit (exactly like generateVertical).
 * With no `llm` option: prepends a TODO breadcrumb pointing at `fromPath` to
 * each generated file — deterministic, never reads `fromPath`'s content
 * beyond confirming it exists. With `{ llm: '<provider>' }`: additionally
 * calls that provider once per generated file to write the ported logic
 * directly, replacing the stub. Either way, locating the source and
 * scaffolding the files themselves never involves an LLM call. */
export function importVertical(root, name, feature, layers, fromPath, { llm } = {}) {
  const fromAbs = path.resolve(fromPath);
  if (!fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isFile()) {
    throw new ConstructError(`Source file not found: ${fromPath}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const files = generateVertical(root, name, feature, layers);
  const oldContent = llm ? fs.readFileSync(fromAbs, 'utf8') : null;

  for (const file of files) {
    const stubContent = fs.readFileSync(file, 'utf8');
    if (!llm) {
      fs.writeFileSync(file, breadcrumb(fromAbs, file) + stubContent);
      continue;
    }
    const layer = layerFromGeneratedFile(file);
    const prompt = buildPortPrompt({
      layer,
      relFile: path.relative(root, file),
      stubContent,
      oldContent,
      oldRelPath: path.relative(path.dirname(file), fromAbs).split(path.sep).join('/'),
    });
    fs.writeFileSync(file, stripCodeFence(callLlm(llm, prompt)));
  }
  return { source: fromAbs, files, llmFilled: !!llm };
}

/** Shape-check a plan object (from a file, or an LLM's analysis response) —
 * shared by the file-based `importPlan` and the interactive route wizard, so
 * both reject the same malformed shapes with the same message. Never throws
 * on content it merely disagrees with (e.g. an unrecognized layer name) —
 * that's `construct validate`'s job once the plan is executed; this only
 * checks the plan is structurally usable at all. */
export function validatePlanShape(plan, sourceDescription) {
  const { feature, units } = plan || {};
  if (!feature || !Array.isArray(units) || !units.length) {
    throw new ConstructError(
      `Plan${sourceDescription ? ` at ${sourceDescription}` : ''} must be { "feature": <name>, "units": [{ "name", "layers", "from" }, ...] }`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  for (const unit of units) {
    const { name, layers, from } = unit || {};
    if (!name || !Array.isArray(layers) || !layers.length || !from) {
      throw new ConstructError(
        `Invalid plan unit ${JSON.stringify(unit)} — each unit needs "name", "layers" (non-empty array), and "from".`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
  }
  return plan;
}

/** Execute an already-validated plan object — the deterministic half of
 * importing a non-Construct feature. The plan itself (which old files map to
 * which logical units/layers) is judgment, produced by whichever LLM
 * analyzed the old feature and approved by a human; this function only ever
 * runs `importVertical` once per already-decided unit, in the order given.
 * `{ llm }` applies uniformly to every unit (writes ported logic instead of
 * a breadcrumb) if given. */
export function executeImportPlan(root, plan, { llm } = {}) {
  const { feature, units } = plan;
  const results = units.map((unit) => ({
    name: unit.name,
    ...importVertical(root, unit.name, feature, unit.layers, unit.from, { llm }),
  }));
  return { feature, results };
}

/** Load a plan from a JSON file, validate its shape, and execute it.
 * Plan shape: `{ feature: string, units: [{ name, layers: string[], from }] }`. */
export function importPlan(root, planPath, { llm } = {}) {
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8'));
  } catch (e) {
    throw new ConstructError(`Could not read/parse plan at ${planPath}: ${e.message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  validatePlanShape(plan, planPath);
  return executeImportPlan(root, plan, { llm });
}

// ~125k tokens at a conservative 4 chars/token — comfortably fits a whole
// real feature (CPO v2's 15 files across two directories, for reference,
// is ~189k chars total) well within a Sonnet/Opus-class context window,
// while still bounding a truly runaway directory. The first cut of this
// (60k chars) was too conservative in practice: it silently dropped over
// half of CPO v2's files from the analysis with no visible warning, so
// `analyzeRoute` below now also reports (not just quietly swallows) it if
// this ever does get hit.
const MAX_ANALYSIS_CHARS = 500000;

function buildAnalysisPrompt(featureName, files) {
  let budget = MAX_ANALYSIS_CHARS;
  const included = [];
  const omitted = [];
  for (const f of files) {
    if (budget <= 0) {
      omitted.push(f.relPath);
      continue;
    }
    const chunk = f.content.length > budget ? f.content.slice(0, budget) : f.content;
    if (chunk.length < f.content.length) omitted.push(`${f.relPath} (partial)`);
    included.push({ relPath: f.relPath, content: chunk });
    budget -= chunk.length;
  }
  const fileBlocks = included
    .map((f) => `=== ${f.relPath} ===\n${f.content}`)
    .join('\n\n');
  const prompt = [
    'You are analyzing an existing, non-Construct-architecture feature so it can be imported into Construct.',
    'Construct organizes a feature into up to 7 layers, each a folder: domain (pure functions), service (owns an external effect), workflow (a state machine, no React), hook (a React hook, name starts with "use"), component (presentation from props), page (presentation composition from props), controller (composes hooks/domain/pages for a route, no restrictions).',
    `Decompose the files below into logical units for a Construct feature named "${featureName}". Each unit is one cohesive piece of functionality (e.g. one hook plus the pure helper it depends on) and lists which of the 7 layers it needs and which single existing file it should be ported from.`,
    '',
    ...(omitted.length ? ['(Some file content was truncated for length — use what is shown, note if a decision is uncertain by keeping the unit small rather than guessing.)', ''] : []),
    fileBlocks,
    '',
    'Respond with ONLY a JSON object, no markdown code fences, no commentary, matching exactly this shape:',
    `{"feature":"${featureName}","units":[{"name":"PascalCaseName","layers":["domain","hook"],"from":"relative/path/from/the/list/above"}]}`,
    'Every "from" value must be exactly one of the file paths listed above (relative, as shown in the === headers). Use only the 7 layer names given above.',
  ].join('\n');
  return { prompt, omitted };
}

/** Read every code file directly under `routeDirs` (a single directory, or
 * an array of them — e.g. a feature whose hooks and pages live in two
 * separate old-code directories) and ask `llm` to propose ONE combined
 * import plan covering all of them. Returns a shape-validated plan with
 * every unit's `from` resolved to an absolute path. Never writes anything —
 * purely analysis. With more than one directory, each file's label in the
 * prompt is prefixed with its own directory's basename so same-named files
 * across directories (and the model's response) stay unambiguous; with
 * just one directory the label is the bare relative path, unchanged from
 * before this accepted more than one. */
export function analyzeRoute(routeDirs, featureName, { llm = 'claude' } = {}) {
  const dirs = (Array.isArray(routeDirs) ? routeDirs : [routeDirs]).map((d) => path.resolve(d));
  for (const d of dirs) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
      throw new ConstructError(`Route not found or not a directory: ${d}`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
  }

  const multi = dirs.length > 1;
  const fileMap = new Map(); // labeled relPath -> absolute path
  for (const routeAbs of dirs) {
    const prefix = multi ? `${path.basename(routeAbs)}/` : '';
    for (const abs of walk(routeAbs)) {
      if (!CODE_EXTENSIONS.has(path.extname(abs)) || TEST_FILE_RE.test(path.basename(abs))) continue;
      fileMap.set(`${prefix}${path.relative(routeAbs, abs).split(path.sep).join('/')}`, abs);
    }
  }
  if (!fileMap.size) {
    throw new ConstructError(
      `No code files (${[...CODE_EXTENSIONS].join(', ')}) found under ${dirs.join(', ')}`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return runAnalysis(fileMap, featureName, llm, `analysis of ${dirs.join(', ')}`);
}

/** Build a { label -> absolute path } map for an arbitrary list of already-
 * resolved files (e.g. from route-resolver.mjs's traceRouteFiles) — unlike
 * analyzeRoute's directory walk, these files can be scattered anywhere, so
 * there's no single relative-path base to label them by. Labels default to
 * a file's own basename; on a collision (two different files sharing one),
 * both (and only those) get their parent folder's name prefixed too, kept
 * to the minimum needed to stay unique rather than always qualifying every
 * label. */
function labelFiles(absPaths) {
  const byBasename = new Map();
  for (const abs of absPaths) {
    const base = path.basename(abs);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(abs);
  }
  const labeled = new Map();
  for (const [base, group] of byBasename) {
    if (group.length === 1) {
      labeled.set(base, group[0]);
    } else {
      for (const abs of group) labeled.set(`${path.basename(path.dirname(abs))}/${base}`, abs);
    }
  }
  return labeled;
}

/** Analyze an explicit list of already-resolved absolute file paths — the
 * counterpart to analyzeRoute for callers (the route-tracing wizard) that
 * already know exactly which files matter, rather than "everything under
 * this directory." */
export function analyzeFiles(absPaths, featureName, { llm = 'claude' } = {}) {
  if (!absPaths.length) {
    throw new ConstructError('No files to analyze.', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const fileMap = labelFiles(absPaths.map((p) => path.resolve(p)));
  return runAnalysis(fileMap, featureName, llm, `analysis of ${absPaths.length} traced file(s)`);
}

/** Shared core: given a { label -> absolute path } map, build the prompt,
 * call the LLM, and validate the response into a plan whose every unit's
 * `from` is resolved back to a real absolute path. */
function runAnalysis(fileMap, featureName, llm, sourceDescription) {
  const files = [...fileMap.entries()].map(([relPath, abs]) => ({ relPath, content: fs.readFileSync(abs, 'utf8') }));
  const { prompt, omitted } = buildAnalysisPrompt(featureName, files);
  if (omitted.length) {
    console.warn(
      `Warning: ${omitted.length} file(s) were too long to fit in this analysis and were left out (or partially cut): ${omitted.join(', ')}. Consider running import --route again scoped to just those, or splitting the analysis.`,
    );
  }
  const raw = callLlm(llm, prompt);
  let plan;
  try {
    plan = JSON.parse(stripCodeFence(raw));
  } catch (e) {
    throw new ConstructError(
      `"${llm}" did not return valid JSON for the plan (${e.message}). Raw response started with: ${raw.slice(0, 200)}`,
      { exitCode: EXIT_CODES.INTERNAL_ERROR },
    );
  }
  validatePlanShape(plan, `${llm}'s ${sourceDescription}`);
  for (const unit of plan.units) {
    const unknown = unit.layers.filter((l) => !KNOWN_LAYERS.has(l));
    if (unknown.length) {
      throw new ConstructError(
        `"${llm}" proposed unknown layer(s) ${JSON.stringify(unknown)} for unit "${unit.name}". Known layers: ${[...KNOWN_LAYERS].join(', ')}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    const abs = fileMap.get(unit.from);
    if (!abs) {
      throw new ConstructError(
        `"${llm}" proposed unit "${unit.name}" from "${unit.from}", which doesn't match any listed file (expected exactly one of the "=== ... ===" labels it was shown).`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    unit.from = abs;
  }
  return plan;
}
