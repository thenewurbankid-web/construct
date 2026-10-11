// Expressions (System 1 groundwork) -- each line.* plan tool declares `pre` and `post` as expressions over the facts
// (contract.mjs LineExpr, facts.mjs). `pre` is what must hold before the step runs: a failing pre refuses the step in
// one sentence and nothing runs. `post` is what the step promises once it ran: it is part of the step's checks (it
// rides on the "planned files" check, so a step keeps the two checks it always had and a failing post says why).
//
//   conditionsOf(tool, args, layout?) -> {pre, post} | null    concrete JSON exprs for one request
//   DEFAULT_CHECK_EXPRS                                         cp1's two default checks, re-expressed
//   expectFor(tool, args, layout?)                              the default checks with the tool's post folded in
//   checkPre(facts, tool, args, layout?) -> null | sentence     the one-sentence refusal when pre fails
import { evaluate } from './expr.mjs';
import { EXTRACT_TOOLS, extractTarget } from './importV2/extract.mjs';

const P = (...segs) => ({ path: segs });
const I = (...segs) => ({ item: segs });

/**
 * cp1's default checks as expressions over the facts of the step being checked. Their outcome is exactly cp1's:
 * `validate` passes when the writer landed the change (it blocks every NEW error), and `files` when the change was
 * planned and every planned file is there with the planned content.
 */
export const DEFAULT_CHECK_EXPRS = Object.freeze({
  validate: Object.freeze({ and: [P('plan', 'applied'), { eq: [{ count: P('findingsNew') }, 0] }] }),
  files: Object.freeze({ and: [P('plan', 'staged'), { every: [P('plan', 'files'), I('asPlanned')] }] }),
});

/** The feature a feature file belongs to: the folder right under the features root. */
const featureOfFile = (file, featuresRoot) => {
  const root = String(featuresRoot || 'features').replace(/\/+$/, '');
  const f = String(file ?? '');
  return f.startsWith(`${root}/`) ? f.slice(root.length + 1).split('/')[0] : '';
};

/** The tools that declare conditions, and how each builds them from its request. */
const CONDITIONS = Object.freeze({
  /** A new feature item based on a library item: the library item exists and the name is free in the feature. */
  'line.baseOn': ({ libraryId, feature, name }) => {
    const named = { eq: [I('name'), name] };
    return {
      pre: { and: [{ exists: P('library', libraryId) }, { not: { some: [P('features', feature, 'items'), named] } }] },
      post: { some: [P('features', feature, 'items'), { and: [named, { eq: [I('base'), libraryId] }] }] },
    };
  },
  /** A feature item moves into the library: it is in its feature and the library name is free; then the reverse. */
  'line.promote': ({ featureItemId }) => {
    const [feature, kind, name] = String(featureItemId).split('/');
    const isIt = { eq: [I('id'), featureItemId] };
    const libId = `${kind}/${name}`;
    return {
      pre: { and: [{ some: [P('features', feature, 'items'), isIt] }, { not: { exists: P('library', libId) } }] },
      post: { and: [{ exists: P('library', libId) }, { not: { some: [P('features', feature, 'items'), isIt] } }] },
    };
  },
  /** One prop of a feature page: the page is a page item of its feature, before and after. */
  'line.setPageProp': ({ file }, layout) => {
    const page = { some: [P('features', featureOfFile(file, layout?.features), 'items'), { and: [{ eq: [I('file'), file] }, { eq: [I('kind'), 'pages'] }] }] };
    return { pre: { and: [{ exists: P('files', file) }, page] }, post: page };
  },
  /** One code fragment: the file is still the one the fragment was read from (its hash); afterwards it is there. */
  'line.setFragment': ({ file, contentHash }) => ({
    pre: { eq: [P('files', file, 'hash'), contentHash] },
    post: { exists: P('files', file) },
  }),
  /** One typed fix: the finding is reported and offers this fix; afterwards it is no longer reported. */
  'line.fix': ({ findingKey, fixId }) => ({
    pre: { some: [P('findings'), { and: [{ eq: [I('key'), findingKey] }, { in: [fixId, I('fixIds')] }] }] },
    post: { not: { some: [P('findings'), { eq: [I('key'), findingKey] }] } },
  }),
});

/**
 * Import v2's extract steps (importV2/extract.mjs), facts read in the import folder: the new file is not there before
 * the step and is there after it. (Whether the source file holds what to move is the planner's one-sentence refusal.)
 */
const EXTRACT_CONDITIONS = Object.fromEntries(EXTRACT_TOOLS.map((tool) => [tool, (args, layout) => {
  const target = extractTarget(layout, tool, args);
  return { pre: { not: { exists: P('files', target) } }, post: { exists: P('files', target) } };
}]));

/** The tools that declare pre and post. */
export const CONDITION_TOOLS = Object.freeze([...Object.keys(CONDITIONS), ...EXTRACT_TOOLS]);

/**
 * The pre and post expressions of one request, or null for a tool that declares none.
 * @param {string} tool @param {Record<string, unknown>} args @param {{features?: string}} [layout]
 * @returns {{pre: import('./contract.mjs').LineExpr, post: import('./contract.mjs').LineExpr} | null}
 */
export function conditionsOf(tool, args, layout) {
  const build = CONDITIONS[tool] ?? EXTRACT_CONDITIONS[tool];
  return build ? build(/** @type {any} */ (args ?? {}), layout) : null;
}

/**
 * The default checks of a change step, each with its expression; the tool's post joins the `files` check.
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {{features?: string} | undefined} layout
 * @param {readonly {id: string, sentence: string, kind: string}[]} defaults cp1's DEFAULT_EXPECT
 * @returns {{id: string, sentence: string, kind: string, expr?: import('./contract.mjs').LineExpr}[]}
 */
export function expectFor(tool, args, layout, defaults) {
  const post = conditionsOf(tool, args, layout)?.post ?? null;
  return defaults.map((c) => {
    const expr = DEFAULT_CHECK_EXPRS[c.id];
    if (!expr) return { ...c };
    return { ...c, expr: c.id === 'files' && post ? { and: [expr, post] } : expr };
  });
}

/**
 * Before a step runs: null when its pre holds (or it declares none), else the one-sentence refusal.
 * @param {any} facts @param {string} tool @param {Record<string, unknown>} args @param {{features?: string}} [layout]
 * @returns {string|null}
 */
export function checkPre(facts, tool, args, layout) {
  const c = conditionsOf(tool, args, layout);
  if (!c) return null;
  const r = evaluate(facts, c.pre);
  if (r.ok) return null;
  const why = r.failed.map((f) => f.sentence.replace(/[.?!]$/, '')).join('; ');
  return `This step cannot run as the project stands: ${/^[^\s]*[/.]/.test(why) || why.startsWith('"') ? why : why.charAt(0).toLowerCase() + why.slice(1)}.`;
}
