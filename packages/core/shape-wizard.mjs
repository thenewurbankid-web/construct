// #628 (part of epic #616) -- the `wizard` shape: a multi-step flow backed by a real state machine in the workflow layer. Its unit names, its
// `types.ts` declarations and the typed template of every file (domain, service, workflow, hook, component, page + expression, controller).
// Registered in shapes.mjs, which owns the request, the checks and the writing. Every unit is built with the factory of its layer and named
// `Name.layer.ext` (READ-004).
//
//   construct create layer Signup --feature signup --layers domain,service,workflow,hook,component,page,controller \
//     --shape wizard --steps details,review,done --entity Signup --fields id:string,name:string
//
// The machine is XState (`setup(...).createMachine(...)`), one state per step plus `submitting` and `submitted`. Events: NEXT and BACK move
// between steps, CHANGE keeps what is typed, SUBMIT is decided only by the last step, RESET starts again, and SUCCEEDED and FAILED are the
// answer of the submit service, sent by the hook. Two guards read a pure domain unit: `stepIsValid` (a step's own fields are filled, so NEXT is
// blocked until they are) and `everyStepIsValid` (SUBMIT). Every non-final state decides every event, so a state never silently ignores one
// (WORKFLOW-004 holds with the flag on). The hook runs the machine with `getNextSnapshot` in tracked state, so the machine is pure and the
// same transitions can be walked without a browser; the page shows the step of the state, one component per step; no routing between steps.
import { cap, importLine, kebab, labelOf, lines, lowerFirst, operationComment, rowText, sampleRows, ts, words } from './shape-kit.mjs';
import { inputFieldsOf } from './shape-form.mjs';

/** The steps of a wizard when `--steps` names none: enter the details, review them, then the last step, where the flow is submitted. */
export const DEFAULT_STEPS = 'details,review,done';

/**
 * The wizard's step count as a closed question (#659, part of #616): `q-steps`, three options with stable ids, each a FIXED list of step names so the
 * plan stays deterministic (the fields are dealt to every step but the last, which shows them all and submits). Ids are words because an answer's
 * option id is letters and hyphens only.
 *
 * @type {Readonly<Record<'two'|'three'|'four', { count: number, steps: string }>>}
 */
export const STEP_TABLE = Object.freeze({
  two: Object.freeze({ count: 2, steps: 'details,done' }),
  three: Object.freeze({ count: 3, steps: DEFAULT_STEPS }),
  four: Object.freeze({ count: 4, steps: 'details,options,review,done' }),
});

/** The id of the closed question about a wizard's step count (`q-steps`; `q-steps-<name>` when a plan has several wizards). */
export const STEPS_QUESTION_ID = 'q-steps';

/** What an unanswered `q-steps` uses: three steps (`details,review,done`), the wizard every plan had before the question existed. */
export const DEFAULT_STEP_OPTION = 'three';

/** Fewest and most steps a wizard has: a step is a component file, and one step is a form. */
export const MIN_STEPS = 2;
export const MAX_STEPS = 6;

/** The words a wizard is asked for with (the lexicon knows them): a unit or a noun of a card that carries one is offered the wizard shape. */
export const WIZARD_WORDS = Object.freeze(['wizard', 'step', 'steps', 'multi-step', 'step by step', 'signup', 'checkout', 'onboard', 'onboarding']);

/** The names a step cannot have: they are states of the machine of their own. */
const RESERVED = Object.freeze(['submitting', 'submitted']);

const usage = (message) => new Error(message);

/**
 * Read a `--steps` value: step names separated by commas (`details,review,done`), lower-case letters and digits with `-` between words, unique,
 * two to six of them, none called `submitting` or `submitted` (states of the machine of their own). Nothing given means `details,review,done`.
 *
 * @param {string|undefined} text The steps, or nothing for the default.
 * @returns {{ name: string, label: string, pascal: string }[]} The steps in order: the name (a state of the machine), the label a person reads and the PascalCase name of the step component.
 * @throws {Error} An error naming the first problem, for the CLI and the plan runner.
 *
 * @example
 * parseSteps('address,payment').map((s) => s.label); // => ['Address', 'Payment']
 */
export function parseSteps(text) {
  const spec = text === undefined || text === null || String(text).trim() === '' ? DEFAULT_STEPS : String(text);
  const names = spec.split(',').map((p) => p.trim()).filter(Boolean);
  for (const name of names) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) throw usage(`Step "${name}" must be lower-case letters and digits, with - between words (for example payment-details).`);
    if (RESERVED.includes(name)) throw usage(`Step "${name}" is a state of the wizard's machine already; give the step another name.`);
  }
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw usage(`Step "${dup}" is listed twice.`);
  if (names.length < MIN_STEPS || names.length > MAX_STEPS) throw usage(`A wizard has ${MIN_STEPS} to ${MAX_STEPS} steps (got ${names.length}); a single step is a form.`);
  return names.map((name) => ({ name, label: labelOf(name), pascal: words(name).map(cap).join('') }));
}

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);
const capText = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * The closed question about a wizard's step count (chooser-summary shape: `{ id, question, options: [{ id, label, enabled, why }], default, chosen,
 * unit, shape, suggestion }`): `three` (the default, first: `details,review,done`), `two` or `four`, each a fixed list of step names (`STEP_TABLE`), so
 * the plan stays deterministic. The step names are never free text. An unanswered question uses `three`, so it never holds a plan back; an answer
 * naming an option that is not offered is `refused`, never silently replaced. A block that already carries steps of its own that are not one of
 * the table (a direct caller's `--steps address,payment`) is not asked: it returns `null`, and those steps stay. Pure.
 *
 * @param {{ unit: string, current?: string, answer?: string | { option: string } }} request The wizard's unit name, the steps the block already carries (nothing, or one of the table, is asked), and an answer to `q-steps`.
 * @returns {{ question: object, steps: string, refused: string | null } | null} The question, the steps the plan uses (the answer, else the block's own, else the default) and why an answer was refused (else `null`); `null` when the block's own steps are custom.
 *
 * @example
 * stepsOffer({ unit: 'Signup' }).question.options.map((o) => o.id); // => ['three', 'two', 'four']
 * stepsOffer({ unit: 'Signup', answer: 'four' }).steps; // => 'details,options,review,done'
 */
export function stepsOffer(request) {
  const own = request.current === undefined || request.current === '' ? null : Object.entries(STEP_TABLE).find(([, e]) => e.steps === request.current)?.[0] ?? undefined;
  if (own === undefined) return null;
  const fallback = own ?? DEFAULT_STEP_OPTION;
  // The default is the first option, so the rules-only decision provider (the first enabled option) suggests it, like q-source and q-verify.
  const order = [fallback, ...Object.keys(STEP_TABLE).filter((id) => id !== fallback)];
  const options = order.map((id) => [id, STEP_TABLE[id]]).map(([id, e]) => ({
    id,
    label: `${e.count} steps: ${e.steps.split(',').join(', ')}`,
    enabled: true,
    why: capText(`${e.steps.split(',').map(labelOf).join(', ')}. The fields are dealt to every step but the last, which shows them all and submits.`, 120),
  }));
  const given = answerOf(request.answer)?.option;
  const known = Object.hasOwn(STEP_TABLE, given ?? '');
  const used = known ? given : fallback;
  const question = {
    id: STEPS_QUESTION_ID,
    question: capText(`How many steps should the "${request.unit}" wizard have?`, 160),
    options, default: fallback, chosen: known ? given : null, unit: request.unit, shape: 'wizard',
    suggestion: { option: fallback, reason: capText(own ? `The blocks ask for ${STEP_TABLE[own].count} steps.` : `Three steps (${STEP_TABLE.three.steps.split(',').join(', ')}) are the usual flow: enter, look over, finish.`, 200), provider: 'rules' },
  };
  return { question, steps: STEP_TABLE[used].steps, refused: given !== undefined && !known ? `"${STEPS_QUESTION_ID}" has no option ${JSON.stringify(given)} here. Options: ${order.join(', ')}.` : null };
}

/**
 * Deal the input fields of a wizard to its steps: the fields go to the steps in order, one after another and round again, over every step but
 * the last (the last step is the one that shows everything and submits it, so it has no input of its own). Pure.
 *
 * @param {{ name: string, type: string }[]} fields The parsed `--fields`.
 * @param {{ name: string }[]} steps The steps from `parseSteps`.
 * @returns {{ name: string, fields: { name: string, type: string }[] }[]} Each step with the fields it holds, in step order; the last step holds none.
 *
 * @example
 * dealFields([{ name: 'id', type: 'string' }, { name: 'a', type: 'string' }, { name: 'b', type: 'string' }], [{ name: 'one' }, { name: 'two' }]).map((s) => s.fields.length); // => [2, 0]
 */
export function dealFields(fields, steps) {
  const inputs = inputFieldsOf(fields);
  const holders = Math.max(1, steps.length - 1);
  return steps.map((step, i) => ({ name: step.name, fields: i < holders ? inputs.filter((_, k) => k % holders === i) : [] }));
}

/**
 * The identifiers of a wizard shape, from its unit name and its entity: `Signup` and `Signup` give `useSignup`, `signupMachine`, `SignupWorkflow`,
 * `SignupPage`, `SignupState` and `SignupInput`. The unit name may equal the entity name (the wizard of a signup is called Signup).
 *
 * @param {string} Name The PascalCase unit name of the screen (`Signup`).
 * @param {string} Entity The PascalCase entity it submits (`Signup`).
 * @returns {Record<string, string>} Every generated identifier, by role.
 *
 * @example
 * wizardNames('Signup', 'Signup').machine; // => 'signupMachine'
 */
export function wizardNames(Name, Entity) {
  return {
    Name, Entity,
    input: `${Entity}Input`, values: `${Name}Values`, step: `${Name}Step`, context: `${Name}Context`, event: `${Name}Event`, state: `${Name}State`, result: `${Name}Result`,
    stepsOf: `steps${Name}`, fieldsOf: `fieldsOf${Name}Step`, empty: `empty${Name}`, validStep: `is${Name}StepValid`, validAll: `is${Name}Valid`, toInput: `input${Name}`, describe: `describe${Name}`,
    submit: `submit${Name}`,
    workflow: `${Name}Workflow`, machine: `${lowerFirst(Name)}Machine`,
    hook: `use${Name}`,
    page: `${Name}Page`, pageProps: `${Name}PageProps`, controller: `${Name}Controller`,
    expression: `${Name}ByStep`, expressionProps: `${Name}ByStepProps`,
    field: `${Name}Field`, fieldProps: `${Name}FieldProps`, frame: `${Name}Frame`, frameProps: `${Name}FrameProps`,
    notice: `${Name}Notice`, noticeProps: `${Name}NoticeProps`, again: `${Name}Again`, againProps: `${Name}AgainProps`,
  };
}

/**
 * The component name of a step (`SignupDetailsStep`) and its props (`SignupDetailsStepProps`).
 *
 * @param {{ names: { Name: string } }} ctx The shape context (`names.Name`, the unit name).
 * @param {{ pascal: string }} step A step from `parseSteps`.
 * @returns {{ name: string, props: string }} The component's name and the name of its props interface.
 *
 * @example
 * stepComponent({ names: { Name: 'Signup' } }, { pascal: 'Details' }).name; // => 'SignupDetailsStep'
 */
export const stepComponent = (ctx, step) => ({ name: `${ctx.names.Name}${step.pascal}Step`, props: `${ctx.names.Name}${step.pascal}StepProps` });

/** What a person types for a field: text for a string or a number, a tick for a boolean. */
const valueType = (f) => (f.type === 'boolean' ? 'boolean' : 'string');
const emptyValue = (f) => (f.type === 'boolean' ? 'false' : "''");
const typedValue = (f) => (f.type === 'string' ? `values.${f.name}.trim()` : f.type === 'number' ? `Number(values.${f.name})` : `values.${f.name}`);
const idOf = (ctx, f) => `${kebab(ctx.names.Name)}-${kebab(f.name)}`;
const union = (steps) => steps.map((s) => `'${s.name}'`).join(' | ');

/**
 * The declarations the wizard shape adds to the feature's `types.ts`: the entity, its typed input, what is typed, the steps, the context and the
 * events of the machine, the state of the screen and the answer of the service. `shapes.mjs` appends the ones the file does not declare yet.
 *
 * @param {object} ctx The shape context (`names`, `fields`, `steps`, `singular`).
 * @returns {{ declares: string, text: string }[]} Each declaration and the name it declares.
 *
 * @example
 * wizardTypes(ctx).map((b) => b.declares); // => ['Signup', 'SignupInput', 'SignupValues', 'SignupStep', 'SignupContext', 'SignupEvent', 'SignupState', 'SignupResult']
 */
export function wizardTypes(ctx) {
  const { names, singular, steps } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  return [
    { declares: names.Entity, text: lines(`/** One ${singular}, as the local store holds it: the wizard's typed values and the id the store gives it. */`, `export interface ${names.Entity} {`, ctx.fields.map((f) => `  ${f.name}: ${ts(f)};`), '}') },
    { declares: names.input, text: lines(`/** The values of a ${singular} as the wizard submits them, typed. */`, `export interface ${names.input} {`, inputs.map((f) => `  ${f.name}: ${ts(f)};`), '}') },
    { declares: names.values, text: lines(`/** What a person has typed in the ${singular} wizard: text for a string or a number field, a tick for a yes or no field. */`, `export interface ${names.values} {`, inputs.map((f) => `  ${f.name}: ${valueType(f)};`), '}') },
    { declares: names.step, text: lines(`/** The steps of the ${singular} wizard, in order: each is a state of its machine. */`, `export type ${names.step} = ${union(steps)};`) },
    { declares: names.context, text: lines(`/** What the ${singular} machine holds besides the step it is in: what is typed, and the message of a failed submit. */`, `export interface ${names.context} {`, `  values: ${names.values};`, '  error: string | null;', '}') },
    {
      declares: names.event,
      text: lines(
        `/** What can happen to the ${singular} machine: a person acts (CHANGE, NEXT, BACK, SUBMIT, RESET) or the submit service answers (SUCCEEDED, FAILED). */`,
        `export type ${names.event} =`, `  | { type: 'CHANGE'; field: keyof ${names.values}; value: string | boolean }`, `  | { type: 'NEXT' }`, `  | { type: 'BACK' }`, `  | { type: 'SUBMIT' }`, `  | { type: 'RESET' }`, `  | { type: 'SUCCEEDED' }`, `  | { type: 'FAILED'; message: string };`,
      ),
    },
    {
      declares: names.state,
      text: lines(
        `/** What the ${singular} wizard shows: a step (with its progress, what is typed and whether it may go on), the submit in flight, or done. */`,
        `export type ${names.state} =`,
        `  | { status: 'step'; step: ${names.step}; progress: string; values: ${names.values}; isFirst: boolean; isLast: boolean; valid: boolean; error: string | null }`,
        `  | { status: 'submitting'; values: ${names.values} }`, `  | { status: 'submitted' };`,
      ),
    },
    { declares: names.result, text: lines(`/** What the ${singular} service answers: submitted, or an error with its message. */`, `export type ${names.result} =`, `  | { status: 'submitted' }`, `  | { status: 'error'; message: string };`) },
  ];
}

/** @returns {string} The check of one field of the values, as an expression: filled, and a number where it is one. A yes or no field always passes. */
const filledCheck = (f) => (f.type === 'string' ? `values.${f.name}.trim() !== ''` : f.type === 'number' ? `values.${f.name}.trim() !== '' && Number.isFinite(Number(values.${f.name}))` : 'true');

/** @returns {string} `domain/<Name>.domain.ts`: the steps, the empty values and the typed input (a domain file holds at most three units, MODULE-001: the validity and the screen are files of their own). */
function domainFile(ctx) {
  const { names, singular, steps } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  return lines(
    importLine('defineDomain'), `import type { ${names.input}, ${names.step}, ${names.values} } from '../types';`, '',
    `/** The steps of the ${singular} wizard, in order: the states of its machine. Pure. */`,
    `export const ${names.stepsOf} = defineDomain<Record<string, never>, readonly ${names.step}[]>('${names.stepsOf}', () => [${steps.map((s) => `'${s.name}'`).join(', ')}]);`, '',
    `/** The ${singular} wizard with nothing typed. Pure. */`,
    `export const ${names.empty} = defineDomain<Record<string, never>, ${names.values}>('${names.empty}', () => ({ ${inputs.map((f) => `${f.name}: ${emptyValue(f)}`).join(', ')} }));`, '',
    `/** The typed values of a ${singular} from what is typed: text trimmed, numbers as numbers. Pure. */`,
    `export const ${names.toInput} = defineDomain<{ values: ${names.values} }, ${names.input}>('${names.toInput}', ({ values }) => ({ ${inputs.map((f) => `${f.name}: ${typedValue(f)}`).join(', ')} }));`,
  );
}

/** @returns {string} `domain/<Name>Validity.domain.ts`: which fields each step holds, and whether a step, and every step, is valid. */
function validityFile(ctx) {
  const { names, singular, steps } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  const dealt = dealFields(ctx.fields, steps);
  return lines(
    importLine('defineDomain'), `import type { ${names.step}, ${names.values} } from '../types';`, '',
    `/** The fields a step of the ${singular} wizard holds: the fields are dealt to the steps in order, and the last step shows them all and holds none. Pure. */`,
    `export const ${names.fieldsOf} = defineDomain<{ step: ${names.step} }, (keyof ${names.values})[]>('${names.fieldsOf}', ({ step }) => {`,
    `  const held: Record<${names.step}, (keyof ${names.values})[]> = {`, dealt.map((d) => `    '${d.name}': [${d.fields.map((f) => `'${f.name}'`).join(', ')}],`), '  };',
    '  return held[step];', '});', '',
    `/** Whether the fields of one step are filled: a string is required, a number is required and must be a number, a yes or no field always passes. A step with no field is always valid. Pure. */`,
    `export const ${names.validStep} = defineDomain<{ step: ${names.step}; values: ${names.values} }, boolean>('${names.validStep}', ({ step, values }) => {`,
    `  const filled: Record<keyof ${names.values}, boolean> = {`, inputs.map((f) => `    ${f.name}: ${filledCheck(f)},`), '  };',
    `  return ${names.fieldsOf}({ step }).every((field) => filled[field]);`, '});', '',
    `/** Whether every step of the ${singular} wizard is valid: what SUBMIT needs. Pure. */`,
    `export const ${names.validAll} = defineDomain<{ values: ${names.values} }, boolean>('${names.validAll}', ({ values }) => {`,
    `  const every: ${names.step}[] = [${steps.map((s) => `'${s.name}'`).join(', ')}];`,
    `  return every.every((step) => ${names.validStep}({ step, values }));`, '});',
  );
}

/** @returns {string} `domain/<Name>Screen.domain.ts`: what the wizard shows for a state of its machine. */
function screenFile(ctx) {
  const { names, singular, steps } = ctx;
  return lines(
    importLine('defineDomain'), `import type { ${names.context}, ${names.state}, ${names.step} } from '../types';`, '',
    `/** What the ${singular} wizard shows for a state of its machine, its context and its steps: the step (with its progress, and whether it may go on: \`canGoOn\` is what the machine's own guards say), the submit in flight, or done. Pure. */`,
    `export const ${names.describe} = defineDomain<{ value: string; context: ${names.context}; steps: readonly ${names.step}[]; canGoOn: boolean }, ${names.state}>('${names.describe}', ({ value, context, steps, canGoOn }) => {`,
    `  if (value === 'submitting') return { status: 'submitting', values: context.values };`,
    `  if (value === 'submitted') return { status: 'submitted' };`,
    `  const labels: Record<${names.step}, string> = {`, steps.map((s) => `    '${s.name}': '${s.label}',`), '  };',
    '  const index = Math.max(0, steps.findIndex((step) => step === value));',
    '  const step = steps[index];',
    '  return {', `    status: 'step', step, progress: \`Step \${index + 1} of \${steps.length}: \${labels[step]}\`, values: context.values, isFirst: index === 0, isLast: index === steps.length - 1,`,
    '    valid: canGoOn, error: context.error,', '  };', '});',
  );
}

/** @returns {string} `services/<Name>.service.ts`: POST the typed values as JSON; a bad status or a failed request is an error result. */
function serviceFile(ctx) {
  const { names, endpoint, singular } = ctx;
  return lines(
    importLine('defineService'), `import type { ${names.input}, ${names.result} } from '../types';`, operationComment(ctx.operation), '',
    `/** Submits a ${singular}: POSTs the typed values as JSON to ${endpoint}. Forwards the caller's AbortSignal and answers with a typed result: a bad status or a failed request is an error result, never a throw. */`,
    `export const ${names.submit} = defineService('${names.submit}', async ({ input, signal }: { input: ${names.input}; signal: AbortSignal }): Promise<${names.result}> => {`,
    '  try {',
    `    const response = await fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });`,
    `    if (!response.ok) return { status: 'error', message: \`The server answered \${response.status}.\` };`,
    `    return { status: 'submitted' };`,
    '  } catch (error) {',
    `    return { status: 'error', message: error instanceof Error ? error.message : 'The request failed.' };`,
    '  }', '});',
  );
}

/** @returns {string} `domain/<Name>Store.domain.ts` (the `local` source): the seed rows and the pure save of one more row, whose id is the next one. */
function storeFile(ctx) {
  const { names, store, singular } = ctx;
  const idField = ctx.fields.find((f) => f.name === 'id');
  const nextId = idField.type === 'number' ? 'rows.length + 1' : `\`${kebab(names.Entity)}-\${rows.length + 1}\``;
  return lines(
    importLine('defineDomain'), `import type { ${names.Entity}, ${names.input} } from '../types';`, '',
    `/** The seed rows of the local ${singular} store: what it holds before anything is submitted. Pure. */`,
    `export const ${store.seed} = defineDomain<Record<string, never>, ${names.Entity}[]>('${store.seed}', () => [`,
    sampleRows(names.Entity, ctx.fields).map((row) => `  ${rowText(row)},`), ']);', '',
    `/** Saves a ${singular}: the rows plus one more, given the next id (the server's job once there is one). Does not change the rows it is given. Pure. */`,
    `export const ${store.op} = defineDomain<{ rows: readonly ${names.Entity}[]; input: ${names.input} }, ${names.Entity}[]>('${store.op}', ({ rows, input }) => [`,
    `  ...rows,`, `  { id: ${nextId}, ...input },`, ']);',
  );
}

/** @returns {string} `services/<Name>.service.ts` (the `local` source): the same typed result as the network service, saving into the store in memory. */
function localServiceFile(ctx) {
  const { names, store, singular } = ctx;
  return lines(
    importLine('defineService'), `import { ${store.op}, ${store.seed} } from '../domain/${store.file}.domain';`, `import type { ${names.Entity}, ${names.input}, ${names.result} } from '../types';`, '',
    `/** The ${singular} rows of the local store: the seed rows, then whatever was submitted, held in memory. It is this screen's whole backend until a real source replaces it. */`,
    `let rows: ${names.Entity}[] = ${store.seed}({});`, '',
    `/** Submits a ${singular} to the local store and answers with the same typed result as a network source. Takes the caller's AbortSignal like one: a cancelled request is an error result, never a throw. */`,
    `export const ${names.submit} = defineService('${names.submit}', async ({ input, signal }: { input: ${names.input}; signal: AbortSignal }): Promise<${names.result}> => {`,
    `  if (signal.aborted) return { status: 'error', message: 'The request was cancelled.' };`,
    `  rows = ${store.op}({ rows, input });`, `  return { status: 'submitted' };`, '});',
  );
}

/** The events of the machine, in the order every state lists them. */
export const WIZARD_EVENTS = Object.freeze(['CHANGE', 'NEXT', 'BACK', 'SUBMIT', 'RESET', 'SUCCEEDED', 'FAILED']);

/** @returns {string} `workflows/<Name>.workflow.ts`: the XState machine (one state per step, submitting, submitted), the guards that read the domain, and the workflow unit. */
function workflowFile(ctx) {
  const { names, singular, steps } = ctx;
  const first = steps[0].name;
  const last = steps.at(-1).name;
  // Every state lists every event: a transition, or `{}` (ignored on purpose), so WORKFLOW-004 holds and nobody has to guess what a state does with an event.
  const state = (key, own) => [
    `    '${key}': {`, '      on: {',
    ...WIZARD_EVENTS.map((event) => `        ${event}: ${own[event] ?? (event === 'CHANGE' ? "{ actions: 'change' }" : '{}')},`),
    '      },', '    },',
  ];
  const stepStates = steps.map((s, i) => state(s.name, {
    ...(i < steps.length - 1 ? { NEXT: `{ guard: { type: 'stepIsValid', params: { step: '${s.name}' } }, target: '${steps[i + 1].name}' }` } : {}),
    ...(i > 0 ? { BACK: `'${steps[i - 1].name}'` } : {}),
    ...(i === steps.length - 1 ? { SUBMIT: "{ guard: 'everyStepIsValid', target: 'submitting' }" } : {}),
    RESET: i === 0 ? "{ actions: 'reset' }" : `{ target: '${first}', actions: 'reset' }`,
  }));
  return lines(
    `import { assign, setup } from 'xstate';`, importLine('defineWorkflow'),
    `import { ${names.empty} } from '../domain/${names.Name}.domain';`, `import { ${names.validAll}, ${names.validStep} } from '../domain/${names.Name}Validity.domain';`, `import type { ${names.context}, ${names.event}, ${names.step} } from '../types';`, '',
    `/** The ${singular} wizard as a state machine: one state per step (${steps.map((s) => s.name).join(', ')}), then submitting and submitted. NEXT goes on only while the step is valid, BACK goes back, SUBMIT is decided only by the last step (and only when every step is valid), RESET starts again; SUCCEEDED and FAILED are the answer of the submit service. Every state decides every event. Pure: the hook runs it. */`,
    `export const ${names.machine} = setup({`,
    `  types: { context: {} as ${names.context}, events: {} as ${names.event} },`,
    '  guards: {',
    `    stepIsValid: ({ context }, params: { step: ${names.step} }) => ${names.validStep}({ step: params.step, values: context.values }),`,
    `    everyStepIsValid: ({ context }) => ${names.validAll}({ values: context.values }),`,
    '  },',
    '  actions: {',
    `    change: assign({ values: ({ context, event }) => (event.type === 'CHANGE' ? { ...context.values, [event.field]: event.value } : context.values), error: () => null }),`,
    `    fail: assign({ error: ({ event }) => (event.type === 'FAILED' ? event.message : null) }),`,
    `    reset: assign({ values: () => ${names.empty}({}), error: () => null }),`,
    '  },',
    '}).createMachine({',
    `  id: '${kebab(names.Name)}',`, `  initial: '${first}',`,
    `  context: { values: ${names.empty}({}), error: null },`,
    '  states: {',
    stepStates.flat(),
    state('submitting', { CHANGE: '{}', SUCCEEDED: "'submitted'", FAILED: `{ target: '${last}', actions: 'fail' }` }),
    state('submitted', { CHANGE: '{}', RESET: `{ target: '${first}', actions: 'reset' }` }),
    '  },', '});', '',
    `/** The ${singular} workflow unit: calling it gives the machine, and the hook runs it that way. \`${names.machine}\` is exported as well because the every-path test generator (\`construct generate tests\`) reads an exported machine. */`,
    `export const ${names.workflow} = defineWorkflow('${names.workflow}', () => ${names.machine});`,
  );
}

/** @returns {string} `hooks/use<Name>.state.ts`: the machine run with getNextSnapshot in tracked state, the submit effect, and the handlers. */
function hookFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    `import { useEffect } from 'react';`, `import { getInitialSnapshot, getNextSnapshot } from 'xstate';`, importLine('useTrackedState'),
    `import { ${names.stepsOf}, ${names.toInput} } from '../domain/${names.Name}.domain';`, `import { ${names.describe} } from '../domain/${names.Name}Screen.domain';`, `import { ${names.submit} } from '../services/${names.Name}.service';`, `import { ${names.workflow} } from '../workflows/${names.Name}.workflow';`,
    `import type { ${names.event}, ${names.state}, ${names.values} } from '../types';`, '',
    `const MACHINE = ${names.workflow}({});`, `const INITIAL = getInitialSnapshot(MACHINE);`, '',
    `/** Runs the ${singular} wizard: its machine in tracked state (\`send\` gives it an event), the \`${names.state}\` it shows, and one handler per event. When the machine is submitting, the submit service is called and its answer is sent back as SUCCEEDED or FAILED; the request is aborted when the screen goes away. */`,
    `export function ${names.hook}() {`,
    `  const [snapshot, setSnapshot] = useTrackedState('${lowerFirst(names.Name)}', INITIAL);`,
    `  const send = (event: ${names.event}) => setSnapshot((current) => getNextSnapshot(MACHINE, current, event));`,
    '  useEffect(() => {',
    `    if (snapshot.value !== 'submitting') return undefined;`,
    '    const controller = new AbortController();',
    `    ${names.submit}({ input: ${names.toInput}({ values: snapshot.context.values }), signal: controller.signal }).then((result) => {`,
    '      if (controller.signal.aborted) return;',
    `      setSnapshot((current) => getNextSnapshot(MACHINE, current, result.status === 'submitted' ? { type: 'SUCCEEDED' } : { type: 'FAILED', message: result.message }));`,
    '    });', '    return () => controller.abort();', '  }, [snapshot.value]);', '',
    `  const canGoOn = snapshot.can({ type: 'NEXT' }) || snapshot.can({ type: 'SUBMIT' });`,
    `  const state: ${names.state} = ${names.describe}({ value: String(snapshot.value), context: snapshot.context, steps: ${names.stepsOf}({}), canGoOn });`,
    `  const change = (field: keyof ${names.values}, value: string | boolean) => send({ type: 'CHANGE', field, value });`,
    `  const back = () => send({ type: 'BACK' });`, `  const next = () => send({ type: 'NEXT' });`, `  const submit = () => send({ type: 'SUBMIT' });`, `  const reset = () => send({ type: 'RESET' });`,
    '  return { state, send, change, back, next, submit, reset };', '}',
  );
}

/** @returns {string} `components/<Name>Field.component.tsx`: a label and the input it is given. */
function fieldFile(ctx) {
  const { names } = ctx;
  return lines(
    `import type { ReactNode } from 'react';`, importLine('defineComponent'), '',
    `export interface ${names.fieldProps} {`, '  id: string;', '  label: string;', '  children?: ReactNode;', '}', '',
    `/** One field of a step: its label and its input. */`,
    `export const ${names.field} = defineComponent<${names.fieldProps}>('${names.field}', ({ id, label, children }) => (`,
    '  <div>', '    <label htmlFor={id}>{label}</label>', '    {children}', '  </div>', '));',
  );
}

/** The JSX of the input of one field: text, number or checkbox, controlled from `values`. */
function inputLines(ctx, f) {
  const id = idOf(ctx, f);
  const label = labelOf(f.name);
  if (f.type === 'boolean') {
    return [`    <${ctx.names.field} id="${id}" label="${label}">`, `      <input id="${id}" name="${f.name}" type="checkbox" checked={values.${f.name}} onChange={(event) => onChange('${f.name}', event.target.checked)} />`, `    </${ctx.names.field}>`];
  }
  return [`    <${ctx.names.field} id="${id}" label="${label}">`, `      <input id="${id}" name="${f.name}" type="${f.type === 'number' ? 'number' : 'text'}"${f.type === 'number' ? ' step="any"' : ''} value={values.${f.name}} onChange={(event) => onChange('${f.name}', event.target.value)} />`, `    </${ctx.names.field}>`];
}

/** The value of one field as text on the review step: a yes or no field reads Yes or No. */
const reviewValue = (f) => (f.type === 'boolean' ? `values.${f.name} ? 'Yes' : 'No'` : `values.${f.name}`);

/** @returns {string} `components/<Name><Step>Step.component.tsx`: the fields of a step, or, for a step with none, everything typed so far. */
function stepFile(ctx, step, held) {
  const { names } = ctx;
  const c = stepComponent(ctx, step);
  const inputs = inputFieldsOf(ctx.fields);
  if (held.length) {
    return lines(
      importLine('defineComponent'), `import { ${names.field} } from './${names.field}.component';`, `import type { ${names.values} } from '../types';`, '',
      `export interface ${c.props} {`, `  values: ${names.values};`, `  onChange: (field: keyof ${names.values}, value: string | boolean) => void;`, '}', '',
      `/** The "${step.label}" step: the fields it holds. */`,
      `export const ${c.name} = defineComponent<${c.props}>('${c.name}', ({ values, onChange }) => (`,
      '  <fieldset>', `    <legend>${step.label}</legend>`, held.flatMap((f) => inputLines(ctx, f).map((l) => `  ${l}`)), '  </fieldset>', '));',
    );
  }
  return lines(
    importLine('defineComponent'), `import type { ${names.values} } from '../types';`, '',
    `export interface ${c.props} {`, `  values: ${names.values};`, '}', '',
    `/** The "${step.label}" step: everything typed so far, to look over. */`,
    `export const ${c.name} = defineComponent<${c.props}>('${c.name}', ({ values }) => (`,
    '  <fieldset>', `    <legend>${step.label}</legend>`, `    <dl aria-label="${step.label}: what you entered">`,
    inputs.flatMap((f) => [`      <div>`, `        <dt>${labelOf(f.name)}</dt>`, `        <dd>{${reviewValue(f)}}</dd>`, '      </div>']),
    '    </dl>', '  </fieldset>', '));',
  );
}

/** @returns {string} `components/<Name>Frame.component.tsx`: the progress, the step it is given, and the Back, Next and Submit buttons. */
function frameFile(ctx) {
  const { names } = ctx;
  return lines(
    `import type { ReactNode } from 'react';`, importLine('defineComponent'), '',
    `export interface ${names.frameProps} {`, '  progress: string;', '  isFirst: boolean;', '  isLast: boolean;', '  valid: boolean;', '  onBack: () => void;', '  onNext: () => void;', '  onSubmit: () => void;', '  children?: ReactNode;', '}', '',
    `/** The frame of a step: where the person is (progress), the step itself, and the buttons: Back (not on the first step), Next (not on the last, and off until the step is valid) and Submit (only on the last, and off until every step is valid). */`,
    `export const ${names.frame} = defineComponent<${names.frameProps}>('${names.frame}', ({ progress, isFirst, isLast, valid, onBack, onNext, onSubmit, children }) => {`,
    '  const prevent = (event: { preventDefault: () => void }) => {', '    event.preventDefault();', '  };',
    '  return (',
    '    <form noValidate onSubmit={prevent}>', '      <p aria-live="polite">{progress}</p>', '      {children}',
    '      <button type="button" hidden={isFirst} onClick={onBack}>Back</button>',
    '      <button type="button" hidden={isLast} disabled={!valid} onClick={onNext}>Next</button>',
    '      <button type="button" hidden={!isLast} disabled={!valid} onClick={onSubmit}>Submit</button>',
    '    </form>', '  );', '});',
  );
}

/** @returns {string} `components/<Name>Notice.component.tsx`: a short message. */
function noticeFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.noticeProps} {`, `  role: 'status' | 'alert';`, '  text: string;', '}', '',
    `/** A short message about the ${singular} wizard: sending, complete or an error. */`,
    `export const ${names.notice} = defineComponent<${names.noticeProps}>('${names.notice}', ({ role, text }) => <p role={role}>{text}</p>);`,
  );
}

/** @returns {string} `components/<Name>Again.component.tsx`: the button that starts the wizard again after a submit. */
function againFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.againProps} {`, '  onClick: () => void;', '}', '',
    `/** The button that starts the ${singular} wizard again once it was submitted. */`,
    `export const ${names.again} = defineComponent<${names.againProps}>('${names.again}', ({ onClick }) => <button type="button" onClick={onClick}>Start again</button>);`,
  );
}

const handlers = (names) => [`  onChange: (field: keyof ${names.values}, value: string | boolean) => void;`, '  onBack: () => void;', '  onNext: () => void;', '  onSubmit: () => void;'];

/** @returns {string} `expressions/<Name>ByStep.expression.tsx`: the branches: submitting, submitted (its children), else the step of the state, framed. */
function expressionFile(ctx) {
  const { names, singular, steps } = ctx;
  const dealt = dealFields(ctx.fields, steps);
  const components = steps.map((s) => stepComponent(ctx, s));
  const body = (i) => {
    const props = dealt[i].fields.length ? ' values={state.values} onChange={onChange}' : ' values={state.values}';
    return `<${names.frame} {...frame}>{notice}<${components[i].name}${props} /></${names.frame}>`;
  };
  return lines(
    importLine('defineExpression'),
    `import { ${names.frame} } from '../components/${names.frame}.component';`, `import { ${names.notice} } from '../components/${names.notice}.component';`,
    components.map((c) => `import { ${c.name} } from '../components/${c.name}.component';`),
    `import type { ${names.state}, ${names.values} } from '../types';`, '',
    `export interface ${names.expressionProps} {`, `  state: ${names.state};`, handlers(names), '}', '',
    `/** Decides what the ${singular} wizard shows: a sending notice while it submits, its children once submitted, else the step of the state inside its frame (with the message of a failed submit above it). */`,
    `export const ${names.expression} = defineExpression<${names.expressionProps}>('${names.expression}', ({ state, onChange, onBack, onNext, onSubmit, children }) => {`,
    `  if (state.status === 'submitting') return <${names.notice} role="status" text="Sending..." />;`,
    `  if (state.status === 'submitted') return <>{children}</>;`,
    `  const notice = state.error === null ? null : <${names.notice} role="alert" text={state.error} />;`,
    '  const frame = { progress: state.progress, isFirst: state.isFirst, isLast: state.isLast, valid: state.valid, onBack, onNext, onSubmit };',
    steps.slice(0, -1).map((s, i) => `  if (state.step === '${s.name}') return ${body(i)};`),
    `  return ${body(steps.length - 1)};`, '});',
  );
}

/** @returns {string} `pages/<Name>Page.page.tsx`: the heading and the wizard, from props. */
function pageFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('definePage'),
    `import { ${names.again} } from '../components/${names.again}.component';`, `import { ${names.notice} } from '../components/${names.notice}.component';`, `import { ${names.expression} } from '../expressions/${names.expression}.expression';`, `import type { ${names.state}, ${names.values} } from '../types';`, '',
    `export interface ${names.pageProps} {`, `  state: ${names.state};`, handlers(names), '  onReset: () => void;', '}', '',
    `/** The ${singular} wizard screen, from props: a heading, and the step of the state (or the sending and complete screens). */`,
    `export const ${names.page} = definePage<${names.pageProps}>('${names.page}', ({ state, onChange, onBack, onNext, onSubmit, onReset }) => (`,
    '  <main>', `    <h1>${labelOf(names.Name)}</h1>`, `    <${names.expression} state={state} onChange={onChange} onBack={onBack} onNext={onNext} onSubmit={onSubmit}>`,
    `      <${names.notice} role="status" text="${labelOf(names.Name)} complete." />`, `      <${names.again} onClick={onReset} />`, `    </${names.expression}>`, '  </main>', '));',
  );
}

/** @returns {string} `controllers/<Name>Controller.controller.tsx`: the hook wired to the page, no logic of its own. */
function controllerFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    importLine('defineController'), `import { ${names.hook} } from '../hooks/${names.hook}.state';`, `import { ${names.page} } from '../pages/${names.page}.page';`, '',
    `/** Wires the ${singular} wizard hook to the ${singular} wizard page: no logic of its own. */`,
    `export const ${names.controller} = defineController<Record<string, never>>('${names.controller}', () => {`,
    `  const { state, change, back, next, submit, reset } = ${names.hook}();`,
    `  return <${names.page} state={state} onChange={change} onBack={back} onNext={next} onSubmit={submit} onReset={reset} />;`, '});',
  );
}

/**
 * The wizard shape's definition: the layers it writes, what each imports, and the files of each layer (`{ folder, base, content }`).
 * Registered as `SHAPES.wizard` in shapes.mjs.
 */
export const WIZARD_SHAPE = Object.freeze({
  summary: 'A multi-step flow run by a state machine: a step per component, Next and Back guarded by the step, one Submit on the last step, and a submit service.',
  layers: Object.freeze(['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller']),
  requires: Object.freeze({ service: ['domain'], workflow: ['domain'], hook: ['workflow', 'service', 'domain'], component: ['domain'], page: ['component', 'domain'], controller: ['hook', 'page'] }),
  names: wizardNames,
  types: wizardTypes,
  files: (ctx) => {
    const dealt = dealFields(ctx.fields, ctx.steps);
    return {
      domain: [
        { folder: 'domain', base: `${ctx.names.Name}.domain.ts`, content: domainFile(ctx) },
        { folder: 'domain', base: `${ctx.names.Name}Validity.domain.ts`, content: validityFile(ctx) },
        { folder: 'domain', base: `${ctx.names.Name}Screen.domain.ts`, content: screenFile(ctx) },
        ...(ctx.source === 'local' ? [{ folder: 'domain', base: `${ctx.store.file}.domain.ts`, content: storeFile(ctx) }] : []),
      ],
      service: [{ folder: 'services', base: `${ctx.names.Name}.service.ts`, content: ctx.source === 'local' ? localServiceFile(ctx) : serviceFile(ctx) }],
      workflow: [{ folder: 'workflows', base: `${ctx.names.Name}.workflow.ts`, content: workflowFile(ctx) }],
      hook: [{ folder: 'hooks', base: `${ctx.names.hook}.state.ts`, content: hookFile(ctx) }],
      component: [
        { folder: 'components', base: `${ctx.names.field}.component.tsx`, content: fieldFile(ctx) },
        { folder: 'components', base: `${ctx.names.frame}.component.tsx`, content: frameFile(ctx) },
        ...ctx.steps.map((s, i) => ({ folder: 'components', base: `${stepComponent(ctx, s).name}.component.tsx`, content: stepFile(ctx, s, dealt[i].fields) })),
        { folder: 'components', base: `${ctx.names.notice}.component.tsx`, content: noticeFile(ctx) },
        { folder: 'components', base: `${ctx.names.again}.component.tsx`, content: againFile(ctx) },
      ],
      page: [
        { folder: 'pages', base: `${ctx.names.page}.page.tsx`, content: pageFile(ctx) },
        { folder: 'expressions', base: `${ctx.names.expression}.expression.tsx`, content: expressionFile(ctx) },
      ],
      controller: [{ folder: 'controllers', base: `${ctx.names.controller}.controller.tsx`, content: controllerFile(ctx) }],
    };
  },
});
