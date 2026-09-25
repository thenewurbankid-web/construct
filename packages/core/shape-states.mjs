// #622 (part of epic #616, builds on the typed state unions of #570) -- what a screen shows while it loads, when there is nothing to show and when it fails,
// as ONE closed question with four stable answers. The list, detail and dashboard shapes always had these states in their typed state union; the
// question decides how each one is SHOWN, per screen, and the units and the proof are generated to match:
//
//   default     every state has a short message from one notice component (loading, the empty or not-found message, the error with role="alert"):
//               what a screen of these shapes has always been, so an unanswered question and an old plan write the same bytes.
//   custom      every state has a component of its own (`<Name>Loading`, `<Name>Empty` or `<Name>NotFound`, `<Name>Failed`), starting with the same text and
//               role, for you to restyle without touching the screen's logic.
//   skip-empty  loading and error keep their message; the empty (or not-found) state shows nothing. Offered for list and detail. A warning.
//   skip-all    no state has a view: the screen shows only its heading while it loads, when empty and on an error. A warning.
//
// The state union itself never changes (no illegal state becomes possible): a skip removes a VIEW, and the plan and the proof say so. The form and the
// wizard are not asked: their states are the steps of a machine, not a fetch that can be pending, empty or failed.
//
//   readStates(value, shape)       the states of a request: nothing is `default`, an unknown one (or one the shape cannot have) is refused
//   viewsOf(states, shape)         what each state shows: 'notice' | 'custom' | 'skip' (an empty view a dashboard has none of is `null`)
//   stateNames(Name, shape)        the identifiers of the custom state components
//   statesOffer(request)           the closed question `q-states` (chooser-summary shape: options with stable ids, the rules' default, chosen)
//
// Nothing here calls a model or the network. The templates that use the views sit beside the shapes (shapes.mjs, shape-detail.mjs,
// shape-dashboard.mjs); the proofs adapt in proof.mjs, proof-screens.mjs, proof-dashboard.mjs and proof-browser.mjs.
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { importLine, lines } from './shape-kit.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

/** The shapes a states question is asked for: the ones that fetch and so can be loading, empty (or not found) and failed. */
export const STATES_SHAPES = Object.freeze(['list', 'detail', 'dashboard']);

/** The id of the closed question about a screen's state views (`q-states`; `q-states-<name>` when a plan has several screens). */
export const STATES_QUESTION_ID = 'q-states';

/** What an unspecified `states` means: `default`, the views every screen of these shapes had before the question existed. */
export const DEFAULT_STATES = 'default';

/**
 * The four answers, each as what the loading, empty and error states show: `notice` (the shared notice component), `custom` (a component of its own)
 * or `skip` (no view). Ids are words (an answer's option id is letters and hyphens only) and never change. A test keeps this equal to the enum of the
 * `--states` argument in plan.mjs and to schemas/plan.v1.json.
 *
 * @type {Readonly<Record<'default'|'custom'|'skip-empty'|'skip-all', { loading: string, empty: string, error: string }>>}
 */
export const STATES_TABLE = Object.freeze({
  default: Object.freeze({ loading: 'notice', empty: 'notice', error: 'notice' }),
  custom: Object.freeze({ loading: 'custom', empty: 'custom', error: 'custom' }),
  'skip-empty': Object.freeze({ loading: 'notice', empty: 'skip', error: 'notice' }),
  'skip-all': Object.freeze({ loading: 'skip', empty: 'skip', error: 'skip' }),
});

/** The ids of `STATES_TABLE`, in the order they are offered (the default first). */
export const STATES_IDS = Object.freeze(Object.keys(STATES_TABLE));

/** The word for the state a shape shows when there is nothing: a list is empty, a detail screen has not found its item, a dashboard has no such state. */
const EMPTY_WORD = Object.freeze({ list: 'empty', detail: 'not found', dashboard: null });

/** Whether a shape's states question has this option (a dashboard has no empty state to skip). */
const offeredFor = (id, shape) => !(id === 'skip-empty' && EMPTY_WORD[shape] === null);

/**
 * The states of a request. Nothing given is `default` (so a plan or a call that predates the question is unchanged); a value that is not one of
 * `STATES_IDS`, a non-default value for a shape that has no such states (form, wizard) and `skip-empty` on a dashboard are usage errors naming the choices.
 *
 * @param {unknown} value The `states` of a request, or `undefined`.
 * @param {string} shape The shape of the request.
 * @returns {'default'|'custom'|'skip-empty'|'skip-all'} The states.
 * @throws {Error} A usage error for an unknown value or one the shape cannot have.
 *
 * @example
 * readStates(undefined, 'list'); // => 'default'
 * readStates('skip-all', 'detail'); // => 'skip-all'
 */
export function readStates(value, shape) {
  if (value === undefined || value === null || value === '') return DEFAULT_STATES;
  if (!Object.hasOwn(STATES_TABLE, value)) throw usage(`Unknown states "${value}". The states are: ${STATES_IDS.join(', ')}.`);
  if (value === DEFAULT_STATES) return value;
  if (!STATES_SHAPES.includes(shape)) throw usage(`--states only applies to the ${STATES_SHAPES.join(', ')} shapes (they fetch, so they can be loading, empty or failed), not to ${shape}.`);
  if (!offeredFor(value, shape)) throw usage(`A ${shape} screen has no empty state, so "${value}" does not apply. The states are: ${STATES_IDS.filter((id) => offeredFor(id, shape)).join(', ')}.`);
  return value;
}

/**
 * What each state of a screen shows for the given answer: `notice`, `custom` or `skip` for `loading` and `error`, and for `empty` too (`null` for a
 * shape that has no empty state).
 *
 * @param {'default'|'custom'|'skip-empty'|'skip-all'} states The states.
 * @param {string} shape The shape.
 * @returns {{ loading: string, empty: string | null, error: string }} The view of each state.
 *
 * @example
 * viewsOf('skip-empty', 'list'); // => { loading: 'notice', empty: 'skip', error: 'notice' }
 * viewsOf('custom', 'dashboard').empty; // => null
 */
export function viewsOf(states, shape) {
  const t = STATES_TABLE[states];
  return { loading: t.loading, empty: EMPTY_WORD[shape] === null ? null : t.empty, error: t.error };
}

/**
 * The identifiers of the custom state components of a screen: `ProductsLoading`, `ProductsEmpty` (`ProductNotFound` for a detail screen) and
 * `ProductsFailed`, each with its props type.
 *
 * @param {string} Name The PascalCase unit name of the screen.
 * @param {string} shape The shape.
 * @returns {{ loading: string, loadingProps: string, empty: string | null, emptyProps: string | null, error: string, errorProps: string }} The identifiers (`empty` is `null` for a dashboard).
 *
 * @example
 * stateNames('Products', 'list').empty; // => 'ProductsEmpty'
 */
export function stateNames(Name, shape) {
  const empty = shape === 'dashboard' ? null : shape === 'detail' ? `${Name}NotFound` : `${Name}Empty`;
  return { loading: `${Name}Loading`, loadingProps: `${Name}LoadingProps`, empty, emptyProps: empty && `${empty}Props`, error: `${Name}Failed`, errorProps: `${Name}FailedProps` };
}

/**
 * The state view of one state as JSX for a template, or `null` when the state is skipped. `notice` is the JSX the shared notice would be
 * (the caller words it), `custom` is the component of its own.
 *
 * @param {{ views: object, stateNames: object | null }} ctx The shape context (`views`, `stateNames`).
 * @param {'loading'|'empty'|'error'} kind The state.
 * @param {string} notice The JSX of the default view of that state.
 * @returns {string | null} The JSX, or `null` when the state has no view.
 *
 * @example
 * stateView(ctx, 'loading', '<ProductsNotice role="status" text="Loading products..." />'); // => that JSX when the states are default
 */
export function stateView(ctx, kind, notice) {
  const view = ctx.views?.[kind] ?? 'notice';
  if (view === 'skip') return null;
  if (view === 'notice') return notice;
  return kind === 'error' ? `<${ctx.stateNames.error} message={state.message} />` : `<${ctx.stateNames[kind]} />`;
}

/**
 * Whether any of a screen's states still uses the shared notice component (when none does, the notice file is not written).
 *
 * @param {{ views?: Record<string, string|null> }} ctx The shape context.
 * @returns {boolean} `true` when at least one state shows the notice.
 */
export const usesNotice = (ctx) => Object.values(ctx.views ?? { loading: 'notice' }).some((v) => v === 'notice');

/**
 * The files of the shared notice or of the custom state components, for a shape's component layer: the notice file when a state uses it (`noticeFile` is
 * the shape's own template), and one file per state for `custom`. Every file is `{ folder, base, content }`.
 *
 * @param {object} ctx The shape context (`names`, `views`, `stateNames`, `plural`, `singular`, `heading`).
 * @param {(ctx: object) => string} noticeFile The shape's template of the notice component.
 * @returns {{ folder: string, base: string, content: string }[]} The component files.
 */
export function stateComponentFiles(ctx, noticeFile) {
  const files = [];
  if (usesNotice(ctx)) files.push({ folder: 'components', base: `${ctx.names.notice}.component.tsx`, content: noticeFile(ctx) });
  if (ctx.stateNames) {
    const s = ctx.stateNames;
    const of = (name, content) => ({ folder: 'components', base: `${name}.component.tsx`, content });
    files.push(of(s.loading, loadingFile(ctx)));
    if (s.empty) files.push(of(s.empty, emptyFile(ctx)));
    files.push(of(s.error, errorFile(ctx)));
  }
  return files;
}

/**
 * The text a screen shows for its loading state (the same words the default notice uses, so the proof reads one text).
 *
 * @param {{ request: { shape: string }, singular: string, plural: string }} ctx The shape context.
 * @returns {string} `Loading <things>...`, or `Loading <thing>...` for a detail screen.
 */
export const loadingText = (ctx) => (ctx.request.shape === 'detail' ? `Loading ${ctx.singular}...` : `Loading ${ctx.plural}...`);

/**
 * The text of the empty or not-found state.
 *
 * @param {{ request: { shape: string }, singular: string, plural: string }} ctx The shape context.
 * @returns {string} `No <things> yet.`, or `<Thing> not found.` for a detail screen.
 */
export const emptyText = (ctx) => (ctx.request.shape === 'detail' ? `${ctx.singular.charAt(0).toUpperCase()}${ctx.singular.slice(1)} not found.` : `No ${ctx.plural} yet.`);

function loadingFile(ctx) {
  const { stateNames: s } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `/** What the ${ctx.request.shape === 'detail' ? ctx.singular : ctx.plural} screen shows while it loads. Yours to change; keep role="status" so a screen reader announces it. */`,
    `export const ${s.loading} = defineComponent<Record<string, never>>('${s.loading}', () => <p role="status">${loadingText(ctx)}</p>);`,
  );
}

function emptyFile(ctx) {
  const { stateNames: s } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `/** What the ${ctx.request.shape === 'detail' ? ctx.singular : ctx.plural} screen shows when ${ctx.request.shape === 'detail' ? `there is no such ${ctx.singular}` : 'there is nothing to list'}. Yours to change; keep role="status". */`,
    `export const ${s.empty} = defineComponent<Record<string, never>>('${s.empty}', () => <p role="status">${emptyText(ctx)}</p>);`,
  );
}

function errorFile(ctx) {
  const { stateNames: s } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${s.errorProps} {`, '  message: string;', '}', '',
    `/** What the ${ctx.request.shape === 'detail' ? ctx.singular : ctx.plural} screen shows when the request fails: the message of the failure. Yours to change; keep role="alert" so a failure is announced. */`,
    `export const ${s.error} = defineComponent<${s.errorProps}>('${s.error}', ({ message }) => <p role="alert">{message}</p>);`,
  );
}

/**
 * The import lines a shape's expression or page needs for its state views (the notice when a state uses it, the custom components of the given states).
 *
 * @param {object} ctx The shape context.
 * @param {('loading'|'empty'|'error')[]} kinds The states the file renders.
 * @returns {string[]} The import lines (none for a file whose states are all skipped).
 */
export function stateImports(ctx, kinds) {
  const views = kinds.filter((k) => ctx.views?.[k] !== null && ctx.views?.[k] !== undefined).map((k) => [k, ctx.views[k]]);
  const out = [];
  if (views.some(([, v]) => v === 'notice')) out.push(`import { ${ctx.names.notice} } from '../components/${ctx.names.notice}.component';`);
  for (const [k, v] of views) if (v === 'custom') out.push(`import { ${ctx.stateNames[k]} } from '../components/${ctx.stateNames[k]}.component';`);
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------- the proof

/**
 * What a person sees for each state, for the proof: `shown` when the state has a view, `nothing` when it was skipped. The proof asserts the same thing
 * the screen does, so a skipped state is proven to show nothing rather than left unproven.
 *
 * @param {{ views?: object }} ctx The proof context.
 * @returns {{ loading: 'shown'|'nothing', empty: 'shown'|'nothing', error: 'shown'|'nothing' }} What each state shows.
 *
 * @example
 * proofViews({ views: { loading: 'skip', empty: 'notice', error: 'custom' } }); // => { loading: 'nothing', empty: 'shown', error: 'shown' }
 */
export function proofViews(ctx) {
  const v = ctx.views ?? { loading: 'notice', empty: 'notice', error: 'notice' };
  const of = (view) => (view === 'skip' ? 'nothing' : 'shown');
  return { loading: of(v.loading), empty: of(v.empty), error: of(v.error) };
}

/**
 * The comment that stands where the Playwright flow of a skipped state would be: a browser cannot tell "not yet" from "nothing", so the render proof (which
 * asserts the screen shows only its heading) owns a skipped state.
 *
 * @param {string} state The state, in the words of the proof (`empty`, `not-found`, `error`).
 * @returns {string[]} One comment line.
 *
 * @example
 * skippedInBrowser('error')[0].startsWith('// The error state has no view'); // => true
 */
export const skippedInBrowser = (state) => [`// The ${state} state has no view (q-states: skipped on purpose): the screen shows only its heading. The render proof asserts that; a browser cannot tell "not yet" from "nothing", so there is no flow for it here.`];

/**
 * The `--states` flag of a proof's regenerating command (nothing for the default, so an old proof regenerates the same bytes).
 *
 * @param {{ states?: string }} ctx The shape context.
 * @returns {string} ` --states <id>`, or an empty string.
 *
 * @example
 * statesFlag({ states: 'skip-all' }); // => ' --states skip-all'
 */
export const statesFlag = (ctx) => (ctx.states && ctx.states !== DEFAULT_STATES ? ` --states ${ctx.states}` : '');

// ----------------------------------------------------------------------------------------------------------------------- the question

const LIMITS = Object.freeze({ question: 160, label: 60, why: 120, reason: 200 });
const cap = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);

/** The warning a skipping answer carries (plan warnings, and the Approve bar of the Requirement screen). */
function warningOf(states, shape, unit) {
  const empty = EMPTY_WORD[shape];
  if (states === 'skip-empty') return `The ${unit} screen has no view for its ${empty} state: ${shape === 'detail' ? 'a missing item' : 'an empty list'} shows only the heading.`;
  if (states === 'skip-all') return `The ${unit} screen has no view for any state: while it loads${empty ? `, when ${empty === 'empty' ? 'it is empty' : 'the item is not found'}` : ''} and when it fails, it shows only the heading, so a failure is silent.`;
  return null;
}

/**
 * The closed question about how a screen shows its states (chooser-summary shape: `{ id, question, options: [{ id, label, enabled, why }], default,
 * chosen, unit, shape, suggestion }`): `default` (first, so the rules-only decision provider, which takes the first enabled option, suggests it),
 * `custom`, `skip-empty` (not for a dashboard, which has no empty state) and `skip-all`. The default is `default` unless the block already carries a
 * known answer of its own (`current`). An unanswered question uses the default, so it never holds a plan back; an answer naming an option that is not
 * offered is `refused`, never silently replaced. The shapes without fetch states (form, wizard) are not asked: it returns `null`. Pure.
 *
 * @param {{ unit: string, shape: string, current?: string, answer?: string | { option: string } }} request The screen's unit name, its shape, the states the block already carries, and an answer to `q-states`.
 * @returns {{ question: object, states: string, warning: string | null, refused: string | null } | null} The question, the states the plan uses, the warning of a skipping answer (else `null`), and why an answer was refused (else `null`); `null` for a shape that is not asked.
 *
 * @example
 * statesOffer({ unit: 'Products', shape: 'list' }).question.options.map((o) => o.id); // => ['default', 'custom', 'skip-empty', 'skip-all']
 * statesOffer({ unit: 'Products', shape: 'list', answer: 'skip-all' }).warning !== null; // => true
 */
export function statesOffer(request) {
  if (!STATES_SHAPES.includes(request.shape)) return null;
  const empty = EMPTY_WORD[request.shape];
  const own = Object.hasOwn(STATES_TABLE, request.current ?? '') && offeredFor(request.current, request.shape) ? request.current : null;
  const fallback = own ?? DEFAULT_STATES;
  const say = (id) => ({
    default: { label: 'Default views, a short message for each state', why: `One notice component shows the loading message${empty ? `, the ${empty} message` : ''} and the error (role alert). Nothing to write.` },
    custom: { label: 'A component of your own for each state', why: 'Each state gets its own component, starting with the same text and role, for you to restyle. The screen stays as it is.' },
    'skip-empty': { label: `Skip the ${empty} view (a warning)`, why: `Loading and error keep their message; ${request.shape === 'detail' ? 'a missing item' : 'an empty list'} shows only the heading.` },
    'skip-all': { label: 'Skip every state view (a warning)', why: 'No state has a view: the screen shows only its heading while it loads and on an error. The typed states stay.' },
  })[id];
  const order = [fallback, ...STATES_IDS.filter((id) => id !== fallback && offeredFor(id, request.shape))];
  const options = order.map((id) => ({ id, label: cap(say(id).label, LIMITS.label), enabled: true, why: cap(say(id).why, LIMITS.why) }));
  const given = answerOf(request.answer)?.option;
  const known = order.includes(given);
  const used = known ? given : fallback;
  const what = request.shape === 'dashboard' ? 'while loading and on an error' : `while loading, when ${empty === 'empty' ? 'empty' : 'the item is not found'} and on an error`;
  const question = {
    id: STATES_QUESTION_ID,
    question: cap(`What should the "${request.unit}" screen show ${what}?`, LIMITS.question),
    options, default: fallback, chosen: known ? given : null, unit: request.unit, shape: request.shape,
    suggestion: { option: fallback, reason: cap(own ? `The blocks ask for "${own}".` : 'Every state gets a view, so the screen is never blank while it loads, when there is nothing to show or when it fails.', LIMITS.reason), provider: 'rules' },
  };
  return {
    question, states: used, warning: warningOf(used, request.shape, request.unit),
    refused: given !== undefined && !known ? `"${STATES_QUESTION_ID}" has no option ${JSON.stringify(given)} here. Options: ${order.join(', ')}.` : null,
  };
}
