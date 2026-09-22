// Deterministic commit messages for Cockpit saves (#283).
//
// Every save in the Cockpit commits; this module decides what that commit is CALLED. It is the
// deterministic half of the feature and therefore lives in core (open source) — the trigger, the
// coalescing window and the settings UI live in `ui/` (see ui/server/src/autoCommit.mjs).
//
// Pure: JSON in, JSON out, read-only (it never runs git and never writes anything), no console
// output, never throws (errors are structured `{ok:false, error}`), NO LLM — not optionally, not
// as a fallback. Same tree + same inputs -> byte-identical message. That is the point: a commit
// message is exactly the kind of work CLAUDE.md's Vision test says must be a deterministic block
// rather than a token spend that drifts every time it runs, and a commit must not depend on a
// model being up.
//
// WHERE THE FACTS COME FROM — nothing here recomputes impact:
//   * `impactFromChangedFiles` (packages/engine/impact.mjs, #288) is called ONCE per message, seeded with
//     the changed files exactly as PR health (#285) seeds it. The counted headline is the report's
//     `direction: "seed"` rows (the files the save actually wrote); the wider-impact line and the
//     warnings are the remaining rows of that SAME report. Filtering matters: analyzeImpact always
//     adds the seeds' own direct dependencies as `direction: "down"` context rows, so counting
//     `report.features` verbatim would claim the save touched files it never opened.
//   * Per-file prose is the report's own `purpose` field (facts.mjs: leading comment, JSDoc, or a
//     layer-derived sentence) — already computed, no extra parse.
//   * The narrative sentence is `summarizeUnit` (packages/engine/unitSummary.mjs) — one call, so a commit
//     costs at most one extra project parse on top of the impact report.
//   * `planTouches` (src/plan.mjs, #286) supplies the branch slug and the planned/unplanned split
//     when the session started from a plan.
//
// THE SERIAL. `<prefix>-<session-id>-<serial>` on the first line. The serial is monotonic WITHIN A
// BRANCH and derived from that branch's own commit subjects, so there is no stored counter and
// nothing for parallel sessions to race on. Consequences, stated deliberately rather than
// discovered later: serials from different session branches interleave in `main` after a merge and
// are not globally ascending (the serial identifies a commit within its session, not a global
// position); rewriting history renumbers; and a number that is baked into a message does not follow
// its commit through a cherry-pick or squash. It is a label, not an identity.
import path from 'node:path';
import crypto from 'node:crypto';
import { impactFromChangedFiles } from './impact.mjs';
import { summarizeUnit } from './unitSummary.mjs';
import { planTouches } from '../../src/plan.mjs';
import { joinEnglishList } from '../../src/prose.mjs';

export const SCHEMA_VERSION = 1;
/** Zero-padding for the serial: `0007`. Wider serials are not truncated, only un-padded numbers grow. */
export const SERIAL_DIGITS = 4;
/** Slug length cap, so `git branch` output and a PR list stay readable. */
export const MAX_SLUG = 40;
/** Soft cap on the subject line — the git convention, applied by trimming the unit list, never mid-word. */
export const SUBJECT_LIMIT = 72;
/** How many changed files get their own line in the body before the rest are counted instead. */
export const MAX_FILE_LINES = 12;
/** Commit granularity modes. The trigger implements them; they are named here so core and ui agree. */
export const COMMIT_MODES = ['coalesce', 'every-save', 'manual'];
/** Default coalescing window (#283: "start at 30s, configurable"). */
export const DEFAULT_COALESCE_MS = 30_000;
/** What the Cockpit uses when the user has not configured anything. Auto-commit is ON by default. */
export const DEFAULT_COMMIT_CONFIG = Object.freeze({
  enabled: true,
  mode: 'coalesce',
  coalesceMs: DEFAULT_COALESCE_MS,
  messagePrefix: 'CON',
  branchPrefix: 'cockpit',
  branchSuffix: '',
});

const fail = (code, message, extra = {}) => ({ schemaVersion: SCHEMA_VERSION, ok: false, error: { code, message, ...extra } });
const uniqSorted = (xs) => [...new Set(xs)].sort();

// ---- session identity ---------------------------------------------------------------------------

/**
 * A new session id: a short random hash, deliberately NOT a timestamp. Parallel agents start within
 * the same second on this project routinely, so a timestamp both collides and leaks wall-clock into
 * every commit subject.
 *
 * @returns {string} `bytes * 2` random hex characters.
 * @param {number} [bytes] entropy in bytes (2 -> 4 hex chars)
 *  
 *
 * @example
 * newSessionId(); // => 'a3f7'
 */
export function newSessionId(bytes = 2) {
  return crypto.randomBytes(Math.max(1, bytes)).toString('hex');
}

/**
 * lowercase, `[a-z0-9-]` only, runs collapsed, trimmed to `max` chars without a trailing dash.
 *
 * @param {string} text Text to slugify.
 * @param {{max?: number}} [options] Maximum length.
 * @returns {string} The slug (`[a-z0-9-]` only).
 *
 * @example
 * slugify('ProductsPage'); // => 'products-page'
 */
export function slugify(text, { max = MAX_SLUG } = {}) {
  const s = String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip diacritics left by NFKD
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2') // ProductsPage -> Products-Page
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.length > max ? s.slice(0, max).replace(/-+$/, '') : s;
}

const unitLabel = (p) => path.basename(String(p)).replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');

/** `billing` + `billingRules` -> `billing-rules`, not `billing-billing-rules`. */
function slugJoin(...parts) {
  const seen = new Set();
  const words = parts.flatMap((p) => slugify(p).split('-')).filter(Boolean).filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
  return slugify(words.join('-'));
}

/**
 * The session branch slug, first match wins (#283's naming decision):
 *   1. the plan or ticket title, slugified — best case, the branch says what the work IS;
 *   2. the feature + unit first touched (`billing-invoice-layer`);
 *   3. the feature alone, when one save touched several units;
 *   4. the date, only if nothing above can be determined.
 *
 * @param {object} [input]
 * @param {string} [input.planTitle] Plan or ticket title.
 * @param {object} [input.plan] The plan (its touched features and files are used).
 * @param {object} [input.impact] An impact report.
 * @param {string[]} [input.changedFiles] Files changed in the save.
 * @param {Date} [input.now] Clock, for the date fallback.
 * @returns {{slug: string, source: 'plan-title'|'plan'|'unit'|'feature'|'file'|'date'}}
 */
export function deriveSlug({ planTitle, plan, impact, changedFiles = [], now = new Date() } = {}) {
  const titled = slugify(planTitle);
  if (titled) return { slug: titled, source: 'plan-title' };

  if (plan) {
    const touches = planTouches(plan);
    const feature = touches.features[0];
    const file = touches.files[0];
    if (feature && file) return { slug: slugJoin(feature, unitLabel(file.path)), source: 'plan' };
    if (feature) return { slug: slugify(feature), source: 'plan' };
  }

  const counted = impact?.available ? impact.features : [];
  if (counted.length === 1 && counted[0].files.length === 1) {
    return { slug: slugJoin(counted[0].name, unitLabel(counted[0].files[0].path)), source: 'unit' };
  }
  if (counted.length >= 1) return { slug: slugify(counted[0].name), source: 'feature' };

  if (changedFiles.length) return { slug: slugify(unitLabel(changedFiles[0])), source: 'file' };
  return { slug: now.toISOString().slice(0, 10), source: 'date' };
}

/**
 * `<prefix>/<slug>-<session-id><suffix>` — e.g. `cockpit/billing-invoice-layer-a3f7`.
 * Prefix and suffix are the user's (either may be empty); the id is ours and is what guarantees the
 * name never collides with an existing branch. The name is fixed once created: later saves in the
 * same session may touch other features, and renaming mid-session breaks anything already pointing
 * at the branch. The name says where the session started; the commits say the rest.
 *
 * @param {object} [parts] `{prefix?, slug?, sessionId?, suffix?}`.
 * @returns {string} The branch name.
 *
 * @example
 * sessionBranchName({ prefix: 'cockpit', slug: 'billing-invoice-layer', sessionId: 'a3f7' }); // => 'cockpit/billing-invoice-layer-a3f7'
 */
export function sessionBranchName({ prefix = '', slug = '', sessionId = '', suffix = '' } = {}) {
  const p = slugify(prefix, { max: 30 });
  const s = slugify(slug) || 'session';
  const sfx = String(suffix || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
  const stem = `${s}-${sessionId}${sfx}`;
  return p ? `${p}/${stem}` : stem;
}

// ---- the serial ---------------------------------------------------------------------------------

/**
 * `CON-a3f7-0007`, or `a3f7-0007` when the user's prefix is empty.
 *
 * @param {object} parts `{prefix?, sessionId, serial}`.
 * @returns {string} The zero-padded serial label.
 *
 * @example
 * serialLabel({ prefix: 'CON', sessionId: 'a3f7', serial: 7 }); // => 'CON-a3f7-0007'
 */
export function serialLabel({ prefix = '', sessionId, serial }) {
  const p = String(prefix || '').trim();
  return `${p ? `${p}-` : ''}${sessionId}-${String(serial).padStart(SERIAL_DIGITS, '0')}`;
}

/**
 * The serial in a commit subject, or null. Matched on the SESSION ID rather than the prefix, so a
 * user who changes their prefix mid-session does not silently restart the numbering at 1.
 *
 * @param {string} subject A commit subject.
 * @param {{sessionId?: string}} [options] Session whose numbering to read.
 * @returns {number|null} The serial, or `null` when the subject has none for this session.
 */
export function parseSerial(subject, { sessionId } = {}) {
  if (typeof subject !== 'string' || !sessionId) return null;
  const m = subject.match(new RegExp(`^(?:\\S*-)?${sessionId.replace(/[^A-Za-z0-9]/g, '')}-(\\d{1,9}):`));
  return m ? Number(m[1]) : null;
}

/**
 * Next serial for a session, from that branch's own commit subjects (newest-first or oldest-first,
 * it does not matter — the max is taken). Monotonic with gaps, never gapless: gapless needs an
 * allocator and a shared resource, which is exactly what branch-scoping removed.
 *
 * @param {string[]} subjects Commit subjects of the session branch, one per entry.
 * @param {{sessionId?: string}} [options] Session whose numbering to continue.
 * @returns {number} One more than the highest serial seen, or 1.
 */
export function nextSerialFrom(subjects, { sessionId } = {}) {
  const seen = (Array.isArray(subjects) ? subjects : []).map((s) => parseSerial(s, { sessionId })).filter((n) => Number.isInteger(n) && n > 0);
  return seen.length ? Math.max(...seen) + 1 : 1;
}

// ---- impact, consumed (not recomputed) ------------------------------------------------------------

/**
 * Turn an impact report (#288) into the counts a commit message states.
 *
 * Counted = the report's `direction: "seed"` rows, i.e. the files this save wrote. Everything else
 * in the report is the blast radius and is reported separately as "wider impact" — never folded
 * into "N features, M layers", which must describe what the save DID.
 *
 * @returns {any} `{available, features, featureCount, layerCount, fileCount, layers, wider, warnings, preexisting, reason?}`: the counts a commit message states; `available: false` (with `reason`) when the report is missing or failed.
 * @param {object} report an `analyzeImpact` / `impactFromChangedFiles` result
 * @param {{preexisting?: string[]}} [opts] files carried in from before the session; listed, never counted
 */
export function commitImpact(report, { preexisting = [] } = {}) {
  if (!report || !report.ok) {
    return { available: false, reason: report?.error?.message || 'No impact report.', features: [], featureCount: 0, layerCount: 0, fileCount: 0, layers: [], wider: { files: 0, features: 0 }, warnings: [], preexisting: uniqSorted(preexisting) };
  }
  const carried = new Set(preexisting);
  const seeds = report.files.filter((r) => r.direction === 'seed' && !carried.has(r.path));
  const byScope = new Map();
  for (const r of seeds) {
    const name = r.feature || r.scope;
    if (!byScope.has(name)) byScope.set(name, { name, kind: r.feature ? 'feature' : r.scopeKind, files: [], layers: [] });
    const g = byScope.get(name);
    g.files.push({ path: r.path, layer: r.layer || 'unclassified', purpose: r.purpose || '' });
    if (!g.layers.includes(r.layer || 'unclassified')) g.layers.push(r.layer || 'unclassified');
  }
  const features = [...byScope.values()]
    .map((g) => ({ ...g, files: g.files.sort((a, b) => a.path.localeCompare(b.path)), layers: g.layers.sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const layers = uniqSorted(seeds.map((r) => r.layer || 'unclassified'));

  const seedPaths = new Set(seeds.map((r) => r.path));
  const widerRows = report.files.filter((r) => r.direction === 'up' && !seedPaths.has(r.path));
  const widerFeatures = uniqSorted(widerRows.map((r) => r.feature || r.scope)).filter((n) => !byScope.has(n));

  return {
    available: true,
    features,
    featureCount: features.length,
    // "M layers" is the total across features (the sketch's `2 features, 5 layers` counts
    // page+controller+hook+domain+service), not the number of distinct layer names.
    layerCount: features.reduce((n, f) => n + f.layers.length, 0),
    distinctLayers: layers.length,
    layers,
    fileCount: seeds.length,
    wider: { files: widerRows.length, features: widerFeatures.length, featureNames: widerFeatures.slice(0, 5) },
    warnings: report.warnings.filter((w) => w.severity !== 'info').map((w) => ({ code: w.code, severity: w.severity, message: w.message })),
    preexisting: uniqSorted(preexisting),
  };
}

// ---- the message ----------------------------------------------------------------------------------

const VERBS = { add: 'add', update: 'update', delete: 'remove' };

function verbFor(changes, files) {
  const kinds = new Set(files.map((p) => changes[p] || 'update'));
  if (kinds.size === 1) return VERBS[[...kinds][0]] || 'update';
  return 'update';
}

function trimSubject(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > limit * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,]+$/, '')}…`;
}

/** The human half of the subject line — deterministic, derived from the counted rows. */
function subjectSummary(impact, { changedFiles, changes }) {
  const verb = verbFor(changes, changedFiles);
  if (!impact.available || !impact.features.length) {
    const names = changedFiles.map(unitLabel);
    return names.length ? `${verb} ${joinEnglishList(names.slice(0, 3))}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : `${verb} the working tree`;
  }
  if (impact.features.length === 1) {
    const f = impact.features[0];
    const names = f.files.map((x) => unitLabel(x.path));
    const shown = joinEnglishList(names.slice(0, 3));
    return `${f.name}: ${verb} ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
  }
  // Several features never fit "who did what" on 72 columns, so the subject names the features and
  // leaves the per-feature layer list to the body rather than truncating something half-legible.
  const names = impact.features.map((f) => f.name);
  const head = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  return `${head}: ${verb} ${impact.fileCount} file${impact.fileCount === 1 ? '' : 's'} in ${impact.layerCount} layer${impact.layerCount === 1 ? '' : 's'}`;
}

/** `2 features, 5 layers, 7 files` — the counted totals, as one phrase. */
function countsPhrase(impact) {
  const p = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `${p(impact.featureCount, 'feature')}, ${p(impact.layerCount, 'layer')}, ${p(impact.fileCount, 'file')}`;
}

/** The counts phrase plus the aligned per-feature layer list, exactly as the ticket sketches it. */
function countsBlock(impact) {
  if (!impact.available) return [`Impact counts unavailable: ${impact.reason}`];
  if (!impact.features.length) return ['0 features, 0 layers — nothing classifiable changed'];
  const width = Math.max(...impact.features.map((f) => f.name.length)) + 1; // +1 for the colon
  return [
    countsPhrase(impact),
    ...impact.features.map((f) => `  ${(`${f.name}:`).padEnd(width)} ${f.layers.join(', ')}`),
  ];
}

/**
 * One deterministic narrative sentence, from Construct's own summarizer. A single `summarizeUnit`
 * call: the changed file itself when a save touched exactly one, otherwise the feature that
 * dominates the save. Never an LLM, so it works with the network and the model both off.
 */
function narrative(root, impact, changedFiles, registry) {
  const ref = impact.available && impact.features.length
    ? (impact.features.length === 1 && impact.features[0].files.length === 1
      ? `file:${impact.features[0].files[0].path}`
      : `${impact.features[0].kind === 'feature' ? 'feature' : 'package'}:${impact.features[0].name}`)
    : changedFiles.length === 1 ? `file:${changedFiles[0]}` : null;
  if (!ref) return null;
  const s = summarizeUnit(root, ref, { detail: 'brief', ...(registry ? { registry } : {}) });
  return s.ok && s.summary ? { ref, text: s.summary } : null;
}

/** Which of the changed files the plan said would be touched, and which it did not (#286). */
function planSplit(plan, changedFiles) {
  if (!plan) return null;
  const touches = planTouches(plan);
  const planned = new Set(touches.files.map((f) => f.path));
  const inPlan = changedFiles.filter((p) => planned.has(p));
  const offPlan = changedFiles.filter((p) => !planned.has(p));
  return { planned: inPlan, unplanned: offPlan, planFeatures: touches.features };
}

/**
 * Build the whole commit message for one Cockpit save.
 *
 * @param {string} root project root
 * @param {object} opts
 * @param {string[]} opts.changedFiles project-relative paths this save wrote (the counted set)
 * @param {string[]} [opts.preexisting] files carried onto the session branch from a dirty tree —
 *   committed alongside, listed in the body, and deliberately NOT counted, so the impact block
 *   never claims work the session did not do
 * @param {Object<string,'add'|'update'|'delete'>} [opts.changes] per-path change kind (default update)
 * @param {string} opts.sessionId  short random hash for this session
 * @param {number} opts.serial     from `nextSerialFrom(subjectsOnBranch)`
 * @param {string} [opts.prefix]   user's message prefix; may be empty
 * @param {object} [opts.plan]     a Construct plan (#286), when the session started from one
 * @param {string} [opts.planTitle]
 * @param {number} [opts.depth]    importer hops for the wider-impact line (default: impact.mjs's)
 * @returns {{schemaVersion:number, ok:true, subject:string, body:string, message:string, label:string, impact:object, report:object}}
 *   or `{ok:false, error}`. Never throws, never writes, never calls a model.
 */
export function buildCommitMessage(root, opts = {}) {
  try {
    const { sessionId, serial, prefix = '', plan = null, planTitle = '', changes = {}, depth, registry } = opts;
    const changedFiles = uniqSorted((opts.changedFiles || []).filter((p) => typeof p === 'string' && p.trim()));
    const preexisting = uniqSorted((opts.preexisting || []).filter((p) => typeof p === 'string' && p.trim()));
    if (!changedFiles.length && !preexisting.length) return fail('INVALID_ARGUMENT', 'changedFiles is required: a commit message describes files that changed.');
    if (!sessionId || !/^[A-Za-z0-9]+$/.test(String(sessionId))) return fail('INVALID_ARGUMENT', 'sessionId must be a short alphanumeric hash (see newSessionId()).');
    if (!Number.isInteger(serial) || serial < 1) return fail('INVALID_ARGUMENT', 'serial must be a positive integer (see nextSerialFrom()).');

    const seedFiles = changedFiles.length ? changedFiles : preexisting;
    const report = impactFromChangedFiles(root, seedFiles, { ...(depth === undefined ? {} : { depth }), ...(registry ? { registry } : {}) });
    const impact = commitImpact(report, { preexisting: changedFiles.length ? preexisting : [] });

    const label = serialLabel({ prefix, sessionId, serial });
    const subject = trimSubject(`${label}: ${subjectSummary(impact, { changedFiles: seedFiles, changes })}`, SUBJECT_LIMIT);

    const lines = [...countsBlock(impact), ''];

    const counted = impact.available ? impact.features.flatMap((f) => f.files) : seedFiles.map((p) => ({ path: p, layer: '', purpose: '' }));
    if (counted.length) {
      lines.push('Changed');
      for (const f of counted.slice(0, MAX_FILE_LINES)) {
        lines.push(`  ${f.path}${f.layer ? ` (${f.layer})` : ''}${f.purpose ? ` — ${f.purpose}` : ''}`);
      }
      if (counted.length > MAX_FILE_LINES) lines.push(`  ...and ${counted.length - MAX_FILE_LINES} more file(s)`);
      lines.push('');
    }

    const n = narrative(root, impact, seedFiles, registry);
    if (n) lines.push('Summary', `  ${n.text}`, '');

    if (impact.available && impact.wider.files) {
      lines.push(`Wider impact: ${impact.wider.files} other file(s) import what changed${impact.wider.features ? `, in ${impact.wider.features} other feature(s): ${impact.wider.featureNames.join(', ')}` : ''}.`, '');
    }
    if (impact.warnings.length) {
      lines.push('Warnings');
      for (const w of impact.warnings.slice(0, 5)) lines.push(`  ${w.code} (${w.severity}): ${w.message}`);
      lines.push('');
    }
    if (preexisting.length && changedFiles.length) {
      lines.push(`Carried in from before this session (committed, not counted above): ${preexisting.length} file(s)`);
      for (const p of preexisting.slice(0, MAX_FILE_LINES)) lines.push(`  ${p}`);
      if (preexisting.length > MAX_FILE_LINES) lines.push(`  ...and ${preexisting.length - MAX_FILE_LINES} more`);
      lines.push('');
    }
    const split = planSplit(plan, changedFiles);
    if (split) {
      lines.push(`Plan: ${split.planned.length} of ${changedFiles.length} changed file(s) are in the plan${split.unplanned.length ? `; ${split.unplanned.length} unplanned: ${split.unplanned.slice(0, 3).join(', ')}${split.unplanned.length > 3 ? ', ...' : ''}` : ''}.`, '');
    }

    lines.push(
      `Construct-Session: ${sessionId}`,
      `Construct-Serial: ${serial}`,
      `Construct-Impact: ${impact.available ? countsPhrase(impact) : 'unavailable'}`,
      'Construct-Summary: deterministic (construct summarize + impact); no LLM',
    );

    const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    return { schemaVersion: SCHEMA_VERSION, ok: true, label, subject, body, message: `${subject}\n\n${body}\n`, impact, report };
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

/** Machine-readable usage note, same shape as the other core APIs. */
export function commitMessageApiManifest() {
  return {
    schemaVersion: SCHEMA_VERSION,
    purpose: 'Deterministic commit messages for Cockpit saves: a branch-scoped serial, impact counts consumed from packages/engine/impact.mjs, and prose from packages/engine/unitSummary.mjs. No LLM, offline, byte-identical for the same tree.',
    calls: {
      newSessionId: '(bytes?) -> short random hex (never a timestamp)',
      slugify: '(text, {max?}) -> branch-safe slug',
      deriveSlug: '({planTitle?, plan?, impact?, changedFiles?, now?}) -> {slug, source}',
      sessionBranchName: '({prefix, slug, sessionId, suffix}) -> "<prefix>/<slug>-<id><suffix>"',
      serialLabel: '({prefix, sessionId, serial}) -> "CON-a3f7-0007"',
      parseSerial: '(subject, {sessionId}) -> number|null',
      nextSerialFrom: '(subjects[], {sessionId}) -> number (monotonic within the branch, gaps allowed)',
      commitImpact: '(impactReport, {preexisting?}) -> counted features/layers/files + wider impact',
      buildCommitMessage: '(root, {changedFiles, preexisting?, changes?, sessionId, serial, prefix?, plan?, planTitle?, depth?}) -> {subject, body, message, impact}',
    },
    modes: COMMIT_MODES,
    defaults: DEFAULT_COMMIT_CONFIG,
    trailers: ['Construct-Session', 'Construct-Serial', 'Construct-Impact', 'Construct-Summary'],
    exceptions: [
      'Serials are monotonic within a branch, not globally: after a merge into main they interleave and are not ascending. That is intended — the serial identifies a commit within its session.',
      'Rewriting history (rebase/squash) renumbers, and a cherry-picked commit keeps a serial that no longer matches its new branch. The serial is a label, not an identity.',
      'Impact counts describe the files the save wrote (the report\'s seed rows). Files carried onto the session branch from a dirty working tree are committed and listed but never counted.',
      'A file the unit registry cannot resolve (e.g. a deleted path) is dropped from the counts; the message still builds and says so.',
    ],
    errorCodes: ['INVALID_ARGUMENT', 'INTERNAL_ERROR'],
  };
}
