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
import { generateVertical, LAYER_ORDER, LAYER_PREREQUISITES, LAYER_CONSTRAINTS, layerFromGeneratedFile, layerTargetFile, extractExpressionHint } from './generators.mjs';
import { walk } from './fs.mjs';
import { callLlm, stripCodeFence, PROVIDERS } from './llm.mjs';
import { requestFileText } from './llm-fill.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { startTimer, elapsedSeconds } from './timing.mjs';

// LAYER_CONSTRAINTS and layerFromGeneratedFile now live in generators.mjs
// (#101) — shared, single-source-of-truth versions, since generators.mjs's
// own create/generate fill (fillGeneratedFile) needs exactly the same
// layer-constraint text import's fill has always used. Behavior here is
// unchanged; only where these two live moved.
const KNOWN_LAYERS = new Set(LAYER_ORDER);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
// Test files carry no portable business logic and just waste analysis
// context (or worse, tempt the LLM into proposing a unit "from" a test) —
// a real route directory routinely has them sitting right next to the
// source they cover (e.g. useCpoGate.ts + useCpoGate.test.ts).
const TEST_FILE_RE = /\.(test|spec)\.[^./]+$/;

// Marks a scaffolded-but-unfilled stub (see breadcrumb() below and
// requestFileText's per-file writes) — the one signal `existingRealFiles`
// (#519) trusts to tell "nobody has touched this yet, safe to redo" apart
// from "a human or an earlier LLM fill already wrote something real here."
const IMPORT_TODO_MARKER = 'TODO(import):';

function breadcrumb(fromAbsPath, intoAbsPath) {
  const relPath = path.relative(path.dirname(intoAbsPath), fromAbsPath).split(path.sep).join('/');
  // Deliberately plain wording — DOMAIN-001 bans certain words (fetch,
  // window, document, ...) anywhere in a domain file, even in a comment, so
  // this stays generic rather than describing what the old file does.
  return `/** ${IMPORT_TODO_MARKER} port the relevant logic from ${relPath} into this file. */\n`;
}

/** Target files (for `layers`) that already exist with real content — i.e.
 * NOT just an earlier, still-unfilled import stub (one that still carries
 * the TODO(import) breadcrumb, which importVertical is always free to
 * rewrite). #519 found that re-running `construct import` for the same
 * name/feature/layer silently overwrote whatever was already there,
 * including a file a human had already hand-ported or an earlier `--llm`
 * fill had already written — real work destroyed with no warning, purely
 * because generateVertical's write() has no existence check. Read-only:
 * never writes, so it's safe to call before anything is scaffolded. */
function existingRealFiles(root, name, feature, layers) {
  const hits = [];
  for (const layer of layers) {
    const file = layerTargetFile(root, layer, name, feature);
    if (!fs.existsSync(file)) continue;
    if (!fs.readFileSync(file, 'utf8').includes(IMPORT_TODO_MARKER)) hits.push(file);
  }
  return hits;
}

// Sibling files are shown to the model so a later layer composes an earlier one instead of
// re-implementing it (the controller that copied the hook's try/catch, #601 follow-up). Each is
// truncated so a big unit cannot crowd out the actual task.
const SIBLING_MAX_CHARS = 6000;
function siblingSection(siblings) {
  if (!siblings?.length) return [];
  return [
    '=== FILES OF THIS SAME UNIT, ALREADY FILLED (compose them: import and call what they export; do NOT re-implement their logic here) ===',
    ...siblings.flatMap((f) => [`--- ${f.relFile} ---`, f.content.length > SIBLING_MAX_CHARS ? `${f.content.slice(0, SIBLING_MAX_CHARS)}\n/* ...truncated... */` : f.content, '']),
  ];
}

function buildPortPrompt({ layer, relFile, stubContent, oldContent, oldRelPath, siblings = [] }) {
  return [
    'You are porting existing code into one file of a Construct-architecture project. The old file\'s',
    'logic is split across SEVERAL files by layer — this prompt fills only ONE of them. Every other',
    'layer file for this same unit is filled by a separate, independent call exactly like this one, so',
    'nothing you decide not to include here is lost — it will be (or already has been) ported into the',
    'file whose layer actually owns it.',
    `Target file: ${relFile} (layer: "${layer}").`,
    `Layer constraint: ${LAYER_CONSTRAINTS[layer] || 'none.'}`,
    'Keep the exact exported identifier name(s) already present in the current stub below unchanged — replace only the body with real logic ported from the old source file. Do not invent behavior the old file does not have.',
    // #<import-composition-fix> -- the root cause: a controller stub already composes this unit's own
    // Page component by construction (see generators.mjs's controllerTemplates), but nothing told the
    // model that composition was load-bearing, not scaffolding to discard — a "port the old file's
    // logic" instruction alone reproduced the old file's JSX return statement verbatim in the
    // controller, orphaning the real Page file. This line is the fix: preserve it explicitly.
    'If the current stub already imports and renders another generated file from this same unit (for',
    'example a controller stub rendering its own `<XPage />`), that composition is load-bearing, not',
    'placeholder scaffolding — keep it. Port only the logic that belongs to THIS layer\'s own',
    'responsibility (per the layer constraint above) into this file, passing whatever a lower layer',
    'needs as props/arguments through that existing composition; do not inline another layer\'s UI or',
    'move a call out of the layer that owns it just because the old file had it in one place.',
    '',
    ...siblingSection(siblings),
    '=== CURRENT STUB (this is the file you are rewriting) ===',
    stubContent,
    '',
    `=== OLD SOURCE FILE (${oldRelPath}, relative to the target file) ===`,
    oldContent,
    '',
    'Return ONLY the new, complete file content. No markdown code fences, no explanation, no commentary — just the raw file content that will be written as-is.',
  ].join('\n');
  // (requestFileText in llm-fill.mjs appends the stdout-only/no-file-access contract.)
}

/**
 * #496/#601 — a targeted correction prompt: fix exactly the violations `construct validate` found
 * in one already-filled file, not a fresh port. Each violation's own `suggestedFix` (when the rule
 * provides one) is passed through verbatim, so a retry is grounded in a concrete, deterministic
 * signal rather than the model guessing again from scratch.
 *
 * @param {{layer: string, relFile: string, currentContent: string, violations: object[], history?: object[]}} options
 *   `layer` names the target file's layer (for its constraint text); `relFile` is its root-relative
 *   path; `currentContent` is what's on disk now (the file this prompt is asking to be rewritten);
 *   `violations` is the subset of `construct validate`'s violations for this file (each with at
 *   least `rule`, `line`, `message`, and optionally `suggestedFix`); `history` (optional) is the earlier
 *   attempts on this same file, `{attempt, remaining: violations[]}` each, so a retry knows what was
 *   already tried and what it left behind instead of guessing again from scratch.
 * @returns {string} The complete prompt text, ready for `requestFileText`.
 */
export function buildFixPrompt({ layer, relFile, currentContent, violations, history = [], siblings = [] }) {
  const violationText = violations
    .map((v) => `- ${v.rule} (line ${v.line}): ${v.message}${v.suggestedFix ? ` — suggested fix: ${v.suggestedFix}` : ''}`)
    .join('\n');
  return [
    'You are fixing specific construct-validate violations in one file of a Construct-architecture project.',
    'Make the smallest change that resolves every violation listed below. Do not rewrite unrelated code,',
    'do not change the exported identifier name(s), and do not introduce new behavior beyond what fixing',
    'the violation requires.',
    `Target file: ${relFile} (layer: "${layer}").`,
    `Layer constraint: ${LAYER_CONSTRAINTS[layer] || 'none.'}`,
    '',
    '=== VIOLATIONS TO FIX ===',
    violationText,
    '',
    ...(history.length
      ? [
        '=== EARLIER ATTEMPTS ON THIS FILE (each left violations behind — do NOT repeat the same change) ===',
        ...history.map((h) => `Attempt ${h.attempt} left: ${h.remaining.map((v) => `${v.rule} (line ${v.line}): ${v.message}`).join('; ') || 'nothing'}`),
        '',
      ]
      : []),
    ...siblingSection(siblings),
    ...(siblings.length ? ['If a violation says to move logic into another layer, that layer\'s file is shown above: call what it already exports from here and delete the duplicate — do not paste the logic into this file again.', ''] : []),
    '=== CURRENT FILE CONTENT ===',
    currentContent,
    '',
    'Return ONLY the new, complete file content with every violation above resolved. No markdown code fences, no explanation, no commentary — just the raw file content that will be written as-is.',
  ].join('\n');
}

/**
 * The deterministic fix plan (#496): every violation grouped by file, files with errors first and
 * then by how many violations they carry, each with the rule's own suggested fix. No model is
 * involved — this is what auto-fix is about to attempt, shown before any call is made.
 *
 * @param {object[]} violations `construct validate` violations for the files about to be fixed.
 * @returns {{file: string, errors: number, violations: object[]}[]} One entry per file, in the order they will be attempted.
 */
export function buildFixPlan(violations) {
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }
  return [...byFile.entries()]
    .map(([file, vs]) => ({ file, errors: vs.filter((v) => v.severity === 'error').length, violations: vs }))
    .sort((a, b) => b.errors - a.errors || b.violations.length - a.violations.length || a.file.localeCompare(b.file));
}

const violationKey = (v) => `${v.rule}|${v.line}|${v.message}`;

/**
 * Fix files with real construct-validate violations, feeding each violation's own message and
 * suggestedFix back as correction context (#496) — a real correction, not the identical prompt
 * rerun. It keeps trying while it is making progress: each retry is also told what the earlier
 * attempts left behind, the whole project is re-validated after every attempt (fixing one file can
 * resolve or introduce another's violations), and it stops early only when two attempts in a row
 * leave the very same violations (`no progress`) or `maxAttempts` is reached. A caller's own cancel
 * (a CLI's Ctrl+C, the Cockpit's Cancel via the AbortSignal in `llmOptions`, #599) stops it at any
 * point — nothing here catches or suppresses that.
 *
 * `validate` is injected rather than imported so this stays a core module with no dependency on
 * packages/engine's enforcer set — the same pattern packages/engine/transactionalWriter.mjs's
 * commit() and approvalGate.mjs's createApprovalGate() already use for their own injected
 * validate option. Pass `(root) => aggregateValidation(root, DEFAULT_ENFORCERS)`.
 *
 * @param {string} root Project root.
 * @param {string[]} relFiles Root-relative paths of files from this import to consider for auto-fix.
 * @param {(root: string) => {violations: object[]}} validate Injected validator.
 * @param {{llm: string, llmOptions?: object, maxAttempts?: number, onPlan?: (plan: object[]) => void, onAttempt?: (info: object) => void, siblingFiles?: string[]}} options
 *   `siblingFiles` are the other root-relative files of the same import, shown to the model so a fix can call
 *   what another layer already exports instead of duplicating it. `maxAttempts` (default 5) is per file. `onPlan` fires once with buildFixPlan's result before the
 *   first call; `onAttempt` fires before each retry with `{file, attempt, violations}` — a caller
 *   uses them to print progress (or to drive the live step tracker, #599).
 * @returns {Promise<{fixed: object[], stillFailing: object[], cancelled: boolean}>} `fixed`: `{file, attempts}` for
 *   every file that ended up clean. `stillFailing`: `{file, violations, attempts, reason}` for every
 *   file that still has a violation, with `reason` one of `no progress`, `attempt limit`, or the fill
 *   call's own failure/rejection reason. `cancelled` is true when the caller's AbortSignal stopped it.
 *
 * @example
 * const { fixed, stillFailing } = await autoFixViolations(
 *   root, relFiles, (r) => aggregateValidation(r, DEFAULT_ENFORCERS), { llm: 'claude' },
 * );
 */
export async function autoFixViolations(root, relFiles, validate, { llm, llmOptions, maxAttempts = 5, onPlan, onAttempt, siblingFiles = [] } = {}) {
  const fixed = [];
  const stillFailing = [];
  let cancelled = false;
  const initial = validate(root).violations.filter((v) => relFiles.includes(v.file));
  const plan = buildFixPlan(initial);
  onPlan?.(plan);
  for (const { file: relFile } of plan) {
    const file = path.join(root, relFile);
    let attempt = 0;
    let stalled = 0;
    let reason = '';
    const history = [];
    let mine = validate(root).violations.filter((v) => v.file === relFile);
    while (mine.length && attempt < maxAttempts) {
      attempt += 1;
      onAttempt?.({ file: relFile, attempt, violations: mine });
      const layer = layerFromGeneratedFile(file);
      const currentContent = fs.readFileSync(file, 'utf8');
      const siblings = siblingFiles
        .filter((f) => f !== relFile && fs.existsSync(path.join(root, f)))
        .map((f) => ({ relFile: f, content: fs.readFileSync(path.join(root, f), 'utf8') }));
      const prompt = buildFixPrompt({ layer, relFile, currentContent, violations: mine, history, siblings });
      const outcome = await requestFileText(llm, prompt, llmOptions);
      if (outcome.status === 'cancelled') cancelled = true; // #599
      if (outcome.status !== 'filled') {
        reason = outcome.status === 'cancelled' ? 'cancelled' : outcome.reason || outcome.status;
        break; // the call itself failed/was rejected/cancelled — retrying identically won't help
      }
      fs.writeFileSync(file, outcome.code + '\n');
      const before = new Set(mine.map(violationKey));
      mine = validate(root).violations.filter((v) => v.file === relFile);
      history.push({ attempt, remaining: mine });
      // No progress = the attempt left exactly the same violations behind. Two in a row is a model
      // that is not going to get there by being asked again the same way.
      const same = mine.length === before.size && mine.every((v) => before.has(violationKey(v)));
      stalled = same ? stalled + 1 : 0;
      if (mine.length && stalled >= 2) {
        reason = 'no progress';
        break;
      }
    }
    if (mine.length) stillFailing.push({ file: relFile, violations: mine, attempts: attempt, reason: reason || 'attempt limit' });
    else if (attempt > 0) fixed.push({ file: relFile, attempts: attempt });
    if (cancelled) break;
  }
  return { fixed, stillFailing, cancelled };
}

/**
 * Scaffold `layers` for one logical unit (exactly like generateVertical).
 * With no `llm` option: prepends a TODO breadcrumb pointing at `fromPath` to
 * each generated file — deterministic, never reads `fromPath`'s content
 * beyond confirming it exists. With `{ llm: '<provider>' }`: additionally
 * calls that provider once per generated file to write the ported logic
 * directly, replacing the stub. Either way, locating the source and
 * scaffolding the files themselves never involves an LLM call.
 *
 * Refuses (writing nothing) if any target file already has real content —
 * i.e. exists and does NOT still carry the TODO(import) breadcrumb — so
 * re-running this for the same name/feature/layer never silently discards
 * a hand-port or an earlier LLM fill (#519).
 *
 * Async because `callLlm` is (providers like `ollama` make a real HTTP
 * call) — with no `llm` option this still resolves on the same tick's
 * microtask queue as before, no behavior change, just a Promise wrapper.
 *
 * @param {string} root Project root.
 * @param {string} name Unit name.
 * @param {string} feature Feature that owns the files.
 * @param {string[]} layers Layers to scaffold.
 * @param {string} fromPath The existing source file being ported; must exist.
 * @param {{llm?: string, llmOptions?: object}} [options] `llm` names a provider that writes the ported logic into each stub.
 * @returns {Promise<{source:string, files:string[], llmFilled:boolean, fills:object[], timings:object}>} The scaffolded files and, with `llm`, what each fill did.
 * @throws {ConstructError} Usage error when `fromPath` is missing, the provider is unknown, or a target file already has real content.
 */
export async function importVertical(root, name, feature, layers, fromPath, { llm, llmOptions, onStep } = {}) {
  const totalStart = startTimer();
  const fromAbs = path.resolve(fromPath);
  if (!fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isFile()) {
    throw new ConstructError(`Source file not found: ${fromPath}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  // An unknown provider is a mistake in the command, not a per-file failure —
  // reject it before scaffolding anything (callLlm would throw the same
  // USAGE_ERROR, but only after files were already written).
  if (llm && !PROVIDERS[llm]) {
    throw new ConstructError(`Unknown --llm provider "${llm}". Supported: ${Object.keys(PROVIDERS).join(', ')}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  // #519: refuse to scaffold over a target file that already holds real
  // content — checked before anything is written, same as the two checks
  // above, so a re-run (or a plan re-applied by mistake) never silently
  // discards work already done on this unit.
  const collisions = existingRealFiles(root, name, feature, layers);
  if (collisions.length) {
    throw new ConstructError(
      `Refusing to import "${name}" into feature "${feature}" — ${collisions.length} target file(s) already exist with real content (not just an unfilled import stub): ${collisions.map((f) => path.relative(root, f)).join(', ')}. Remove them first (or import under a different name) if you really mean to redo this unit; nothing was written.`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  onStep?.({ phase: 'scaffolding', detail: { unit: name, feature, layers } });
  const scaffoldStart = startTimer();
  const files = generateVertical(root, name, feature, layers);
  const scaffoldSeconds = elapsedSeconds(scaffoldStart);
  const oldContent = llm ? fs.readFileSync(fromAbs, 'utf8') : null;
  const fills = [];

  // Per-file timing (#166): a breadcrumb write is trivial, but an LLM fill
  // is exactly the step whose cost varies wildly and is worth seeing
  // per-file, not just as one lump for the whole unit -- `llmSeconds` is 0
  // for the no-`llm` breadcrumb path (nothing to distinguish it from).
  const fileTimings = [];
  let cancelled = false;
  const filledSiblings = []; // files of this unit already filled, in layer order (#601 follow-up)
  for (const file of files) {
    const stubContent = fs.readFileSync(file, 'utf8');
    if (!llm) {
      fs.writeFileSync(file, breadcrumb(fromAbs, file) + stubContent);
      fileTimings.push({ file, llmSeconds: 0 });
      continue;
    }
    // #599 -- once cancelled, every remaining file is left as its scaffolded stub + breadcrumb (a
    // valid file, never a partial write) without spending another model call.
    if (cancelled || llmOptions?.signal?.aborted) {
      cancelled = true;
      fs.writeFileSync(file, breadcrumb(fromAbs, file) + stubContent);
      fills.push({ file, status: 'cancelled', reason: 'cancelled', attempts: 0 });
      fileTimings.push({ file, llmSeconds: 0 });
      continue;
    }
    const layer = layerFromGeneratedFile(file);
    onStep?.({ phase: 'filling', detail: { unit: name, file: path.relative(root, file), layer, index: files.indexOf(file) + 1, total: files.length } });
    const prompt = buildPortPrompt({
      layer,
      relFile: path.relative(root, file),
      stubContent,
      oldContent,
      oldRelPath: path.relative(path.dirname(file), fromAbs).split(path.sep).join('/'),
      siblings: filledSiblings,
    });
    const fillStart = startTimer();
    const outcome = await requestFileText(llm, prompt, llmOptions);
    const llmSeconds = elapsedSeconds(fillStart);
    fileTimings.push({ file, llmSeconds });
    if (outcome.status === 'filled') {
      fs.writeFileSync(file, outcome.code + '\n');
      filledSiblings.push({ relFile: path.relative(root, file), content: outcome.code });
      // #522 -- the ported logic itself may have brought inline conditional/loop JSX along with
      // it; if so, point at the deterministic extraction block rather than leaving it for a human
      // (or a future LLM call) to hand-fix.
      const fixCommand = extractExpressionHint(root, file, layer);
      fills.push({ file, status: 'filled', attempts: outcome.attempts, ...(fixCommand ? { fixCommand } : {}) });
      continue;
    }
    // The model's output was rejected (#144) or the call failed (#141) — leave
    // the scaffolded stub as a valid file, with the same breadcrumb the no-llm
    // path writes, so the file is still discoverable.
    fs.writeFileSync(file, breadcrumb(fromAbs, file) + stubContent);
    if (outcome.status === 'cancelled') cancelled = true;
    fills.push({ file, status: outcome.status, reason: outcome.reason, attempts: outcome.attempts });
  }
  return {
    source: fromAbs,
    files,
    cancelled,
    llmFilled: fills.some((f) => f.status === 'filled'),
    fills,
    timings: { scaffoldSeconds, files: fileTimings, totalSeconds: elapsedSeconds(totalStart) },
  };
}

/** #275 — deterministically repair a plan's layer sets in place, and report
 * what was repaired as `[{ unit, added: [...] }]`.
 *
 * A unit listing `controller` without `page` is unbuildable: the controller
 * stub composes a same-named page (see generators.mjs's LAYER_PREREQUISITES),
 * so the page has to be part of the same unit. Plans come from an LLM's
 * analysis of old code and vary run to run — #146's route-import demo hit
 * exactly this intermittently — and adding the missing page is the only
 * correct repair, so this normalises rather than rejecting: no judgement is
 * involved, the wizard prints the (already-normalised) plan for human
 * approval before anything is written, and a plan file that happened to work
 * because the page already existed on disk keeps working.
 *
 * The opposite choice is deliberate one level down: `generateVertical` REJECTS
 * the same combination, because there the layer list is what a human explicitly
 * typed as `--layers`, and silently adding a layer they didn't ask for would be
 * worse than telling them. */
export function normalizePlanLayers(plan) {
  const adjustments = [];
  for (const unit of plan?.units || []) {
    if (!Array.isArray(unit?.layers)) continue;
    const present = new Set(unit.layers);
    const added = [];
    for (const layer of unit.layers) {
      for (const requires of LAYER_PREREQUISITES[layer] || []) {
        if (present.has(requires)) continue;
        present.add(requires);
        added.push(requires);
      }
    }
    if (!added.length) continue;
    // Keep the canonical build order rather than appending — the plan is shown
    // to a human, and generateVertical would reorder it anyway.
    unit.layers = LAYER_ORDER.filter((l) => present.has(l)).concat(unit.layers.filter((l) => !LAYER_ORDER.includes(l)));
    adjustments.push({ unit: unit.name, added });
  }
  return adjustments;
}

/** Shape-check a plan object (from a file, or an LLM's analysis response) —
 * shared by the file-based `importPlan` and the interactive route wizard, so
 * both reject the same malformed shapes with the same message. Never throws
 * on content it merely disagrees with (e.g. an unrecognized layer name) —
 * that's `construct validate`'s job once the plan is executed; this only
 * checks the plan is structurally usable at all.
 *
 * It does, however, normalise an unbuildable layer set (see
 * `normalizePlanLayers`) — repairing the plan before anything is written,
 * rather than letting it fail mid-build. Returns the (possibly repaired)
 * plan; `plan.layerAdjustments` is set when anything was repaired. */
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
  const adjustments = normalizePlanLayers(plan);
  if (adjustments.length) {
    plan.layerAdjustments = adjustments;
    console.warn(
      `Note: ${adjustments
        .map((a) => `unit "${a.unit}" needed ${a.added.map((l) => `"${l}"`).join(', ')} added to its layers`)
        .join('; ')} — a controller composes a same-named page, so the page is part of the same unit. Added automatically; nothing is written yet.`,
    );
  }
  return plan;
}

/**
 * Execute an already-validated plan object — the deterministic half of
 * importing a non-Construct feature. The plan itself (which old files map to
 * which logical units/layers) is judgment, produced by whichever LLM
 * analyzed the old feature and approved by a human; this function only ever
 * runs `importVertical` once per already-decided unit, in the order given.
 * `{ llm }` applies uniformly to every unit (writes ported logic instead of
 * a breadcrumb) if given.
 *
 * @param {string} root Project root.
 * @param {{feature:string, units:{name:string, layers:string[], from:string}[]}} plan A validated import plan.
 * @param {{llm?: string, llmOptions?: object}} [options] Applied to every unit.
 * @returns {Promise<{feature:string, results:object[]}>} One result per unit, in plan order.
 */
export async function executeImportPlan(root, plan, { llm, llmOptions, onStep } = {}) {
  const { feature, units } = plan;
  const results = [];
  // Sequential (not Promise.all) — deliberately mirrors the old synchronous
  // for-loop's one-unit-at-a-time behavior/ordering, and avoids hammering a
  // local Ollama instance (or any provider) with N concurrent requests for
  // one plan.
  for (const unit of units) {
    const result = { name: unit.name, ...(await importVertical(root, unit.name, feature, unit.layers, unit.from, { llm, llmOptions, onStep })) };
    results.push(result);
    if (result.cancelled) break; // #599 -- a cancel stops the whole plan, not just the current file
  }
  return { feature, results, cancelled: results.some((r) => r.cancelled) };
}

/**
 * Load a plan from a JSON file, validate its shape, and execute it.
 * Plan shape: `{ feature: string, units: [{ name, layers: string[], from }] }`.
 *
 * @param {string} root Project root.
 * @param {string} planPath JSON plan file.
 * @param {{llm?: string, llmOptions?: object}} [options] Applied to every unit.
 * @returns {Promise<{feature:string, results:object[]}>} One result per unit.
 * @throws {ConstructError} Usage error when the plan cannot be read or has the wrong shape.
 *
 * @example
 * await importPlan(root, 'plan.json');
 */
export async function importPlan(root, planPath, { llm, llmOptions } = {}) {
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8'));
  } catch (e) {
    throw new ConstructError(`Could not read/parse plan at ${planPath}: ${e.message}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  validatePlanShape(plan, planPath);
  return executeImportPlan(root, plan, { llm, llmOptions });
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
export async function analyzeRoute(routeDirs, featureName, { llm = 'claude', llmOptions } = {}) {
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
  return runAnalysis(fileMap, featureName, llm, `analysis of ${dirs.join(', ')}`, llmOptions);
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

/**
 * Analyze an explicit list of already-resolved absolute file paths — the
 * counterpart to analyzeRoute for callers (the route-tracing wizard) that
 * already know exactly which files matter, rather than "everything under
 * this directory."
 *
 * @param {string[]} absPaths Absolute paths of the files to analyze.
 * @param {string} featureName Feature the analysis is for.
 * @param {{llm?: string}} [options] Provider that performs the analysis (default `'claude'`).
 * @returns {Promise<object>} The analysis.
 * @throws {ConstructError} Usage error when no files are given.
 */
export async function analyzeFiles(absPaths, featureName, { llm = 'claude', llmOptions } = {}) {
  if (!absPaths.length) {
    throw new ConstructError('No files to analyze.', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const fileMap = labelFiles(absPaths.map((p) => path.resolve(p)));
  return runAnalysis(fileMap, featureName, llm, `analysis of ${absPaths.length} traced file(s)`, llmOptions);
}

/** Shared core: given a { label -> absolute path } map, build the prompt,
 * call the LLM, and validate the response into a plan whose every unit's
 * `from` is resolved back to a real absolute path. */
async function runAnalysis(fileMap, featureName, llm, sourceDescription, llmOptions) {
  const files = [...fileMap.entries()].map(([relPath, abs]) => ({ relPath, content: fs.readFileSync(abs, 'utf8') }));
  const { prompt, omitted } = buildAnalysisPrompt(featureName, files);
  if (omitted.length) {
    console.warn(
      `Warning: ${omitted.length} file(s) were too long to fit in this analysis and were left out (or partially cut): ${omitted.join(', ')}. Consider running import --route again scoped to just those, or splitting the analysis.`,
    );
  }
  const raw = await callLlm(llm, prompt, llmOptions);
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
