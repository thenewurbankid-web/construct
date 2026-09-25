// #628 (part of epic #616) -- the render proof of the `wizard` shape, as a generated node test (proof.mjs writes and locks it, `construct test proof`
// runs it). It shows the flow the shape wrote BEHAVES, with no browser and no server, in two halves:
//
//   the machine   every transition path of the XState machine, walked with `getNextSnapshot` from a snapshot resolved in each state: NEXT through
//                 every step (blocked while the step is invalid), BACK, SUBMIT only on the last step and only when every step is valid, RESET from
//                 every state, the answer of the service (SUCCEEDED, FAILED), and a table that says what EVERY state does with EVERY event. A
//                 failure names the transition and the state: `The transition NEXT from "details" with nothing typed: the "details" state is
//                 wrong, the machine reaches "review".`
//   the screen    the page shows the step of the state (its progress, its legend, its fields), the buttons follow the step, the sending and complete
//                 screens, the message of a failed submit, the controller's first step, and the service (a stubbed fetch, or its local store).
//
// proof.mjs owns the file, the header and the helpers every proof shares; it passes them in as `kit`, so this file needs nothing from it.
import { sourceFlag } from './proof-screens.mjs';
import { dealFields } from './shape-wizard.mjs';
import { inputFieldsOf } from './shape-form.mjs';
import { kebab, labelOf } from './shape-kit.mjs';

const sampleValue = (f) => (f.type === 'boolean' ? true : f.type === 'number' ? '12.5' : `${f.name} 1`);
const typedValue = (f) => (f.type === 'boolean' ? true : f.type === 'number' ? 12.5 : `${f.name} 1`);
const shownValue = (f) => (f.type === 'boolean' ? 'Yes' : String(sampleValue(f)));

/**
 * What every state of the wizard's machine should do with every event, as rows `[from, event, values, to]` (`values` is `valid` or `empty`: what
 * is typed when the event arrives). Written from the rules of the flow, not read off the machine, so the proof compares two accounts of it: NEXT
 * goes on only when the step's own fields are filled, BACK goes one step back, SUBMIT works only on the last step and only when every step is
 * filled, RESET starts again (except while submitting), SUCCEEDED and FAILED matter only while submitting. Pure.
 *
 * @param {{ name: string }[]} steps The steps in order.
 * @param {{ name: string, fields: { name: string, type: string }[] }[]} dealt The steps with the fields each holds (`dealFields`).
 * @returns {[string, string, 'valid'|'empty', string][]} The rows, state by state.
 *
 * @example
 * transitionRows([{ name: 'a' }, { name: 'b' }], [{ name: 'a', fields: [{ name: 'x', type: 'string' }] }, { name: 'b', fields: [] }]).filter((r) => r[1] === 'NEXT' && r[0] === 'a'); // => [['a', 'NEXT', 'valid', 'b'], ['a', 'NEXT', 'empty', 'a']]
 */
export function transitionRows(steps, dealt) {
  const names = steps.map((s) => s.name);
  const checked = (i) => dealt[i].fields.some((f) => f.type !== 'boolean');
  const anyChecked = dealt.some((_, i) => checked(i));
  const rows = [];
  for (const from of [...names, 'submitting', 'submitted']) {
    const i = names.indexOf(from);
    const isStep = i >= 0;
    const last = i === names.length - 1;
    const push = (event, values, to) => rows.push([from, event, values, to]);
    if (isStep && !last) {
      push('NEXT', 'valid', names[i + 1]);
      push('NEXT', 'empty', checked(i) ? from : names[i + 1]);
    } else push('NEXT', 'valid', from);
    push('BACK', 'valid', isStep && i > 0 ? names[i - 1] : from);
    if (last) {
      push('SUBMIT', 'valid', 'submitting');
      push('SUBMIT', 'empty', anyChecked ? from : 'submitting');
    } else push('SUBMIT', 'valid', from);
    push('RESET', 'valid', from === 'submitting' ? from : names[0]);
    push('SUCCEEDED', 'valid', from === 'submitting' ? 'submitted' : from);
    push('FAILED', 'valid', from === 'submitting' ? names.at(-1) : from);
  }
  return rows;
}

const stepsFlag = (ctx) => ` --steps ${ctx.request.steps}`;

/**
 * The text of the render proof of a wizard: the machine (every state, every event, every path) and the screen (a step per state, the buttons, the
 * sending and complete screens, a failed submit, the controller's first step) and the service (a stubbed fetch: the typed values POSTed, a 500, a
 * network failure, the AbortSignal; or, for the local source, the save into the store with no network and a cancelled request).
 *
 * @param {object} ctx The proof context (shape context plus `errorText`).
 * @param {{ feature: string }} request The proof request.
 * @param {string} relPath The project-relative path of the proof file, for its run line.
 * @param {import('./proof-screens.mjs').ProofKit & { openapiServiceTests: string[] }} kit The shared header and helpers.
 * @returns {string} The file text, ending with a newline.
 *
 * @example
 * wizardProofText(ctx, { feature: 'signup' }, 'features/signup/tests/generated/SignupScreen.proof.test.ts', kit).includes('every state decides every event');
 */
export function wizardProofText(ctx, request, relPath, kit) {
  const { names, steps } = ctx;
  const { lit } = kit;
  const Name = names.Name;
  const local = ctx.source === 'local';
  const inputs = inputFieldsOf(ctx.fields);
  const dealt = dealFields(ctx.fields, steps);
  const stepNames = steps.map((s) => s.name);
  const first = stepNames[0];
  const last = stepNames.at(-1);
  const anyChecked = inputs.some((f) => f.type !== 'boolean');
  const blockAt = dealt.findIndex((d) => d.fields.some((f) => f.type !== 'boolean')); // the first step that can be invalid
  const prefix = kebab(Name);
  // One bad value for each field that is checked, on the step that holds it: a blank string, a text that is not a number, a blank number.
  const bads = dealt.flatMap((d) => d.fields.filter((f) => f.type !== 'boolean').flatMap((f) => (f.type === 'number' ? [[d.name, f.name, 'abc'], [d.name, f.name, '  ']] : [[d.name, f.name, '']])));
  const command = `construct create proof ${Name} --feature ${request.feature} --shape wizard --entity ${names.Entity} --fields ${ctx.request.fields}${stepsFlag(ctx)}${sourceFlag(ctx)}`;
  const objectOf = (pick) => `{ ${inputs.map((f) => `${f.name}: ${typeof pick(f) === 'string' ? lit(pick(f)) : pick(f)}`).join(', ')} }`;
  const rows = transitionRows(steps, dealt);
  const button = (label, hidden, disabled) => `<button type="button"${hidden ? ' hidden=""' : ''}${disabled ? ' disabled=""' : ''}>${label}</button>`;
  const progressOf = (i) => `<p aria-live="polite">Step ${i + 1} of ${steps.length}: ${steps[i].label}</p>`;
  const stepChecks = steps.map((s, i) => {
    const held = dealt[i].fields;
    const fieldChecks = held.map((f) => [`${prefix}-${kebab(f.name)}`, labelOf(f.name), f.type === 'number' ? 'number' : f.type === 'boolean' ? 'checkbox' : 'text']);
    const reviewLines = held.length ? [] : inputs.map((f) => `<div><dt>${labelOf(f.name)}</dt><dd>${shownValue(f)}</dd></div>`);
    return { name: s.name, progress: progressOf(i), legend: `<legend>${s.label}</legend>`, fields: fieldChecks, review: reviewLines, isFirst: i === 0, isLast: i === steps.length - 1 };
  });
  const localServiceTests = [
    `test(${lit(`${Name} service: a submit is saved into the local store, with no network`)}, async () => {`,
    "  await withFetch(async () => { throw new Error('the local store must not use the network'); }, async () => {",
    "    expectState('The service given the typed values', 'submitted', (await send(TYPED)).status);",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} store: saving adds one row with a fresh id and leaves the rows it is given alone`)}, () => {`,
    `  const rows = ${ctx.store.seed}({});`,
    '  const before = JSON.stringify(rows);',
    `  const saved = ${ctx.store.op}({ rows, input: TYPED });`,
    "  expectState('The store given one more row', String(rows.length + 1), String(saved.length));",
    "  assert.equal(JSON.stringify(rows), before, 'the rows it was given are unchanged');",
    "  assert.equal(new Set(saved.map((row) => String(row.id))).size, saved.length, 'every row has its own id');",
    "  assert.deepEqual(Object.fromEntries(Object.entries(saved[saved.length - 1]).filter(([key]) => key !== 'id')), TYPED, 'the new row holds the typed values');",
    '});',
    '',
    `test(${lit(`${Name} service: a cancelled request is an error result`)}, async () => {`,
    '  const controller = new AbortController();',
    '  controller.abort();',
    `  expectState('The service given a cancelled request', 'error', (await ${names.submit}({ input: TYPED, signal: controller.signal })).status);`,
    '});',
  ];
  const L = [
    ...kit.header(`shape wizard, kind render`, command),
    `// run: construct test proof ${kit.comment(request.feature)}   (on its own: npx tsx --test ${kit.comment(relPath)})`,
    '//',
    `// Proves the ${ctx.singular} wizard with no browser and no server. The machine: every transition path of its XState machine, walked with`,
    '// getNextSnapshot (NEXT through every step and blocked while a step is invalid, BACK, SUBMIT only on the last step and only when every step',
    '// is valid, RESET from every state, the answer of the service), and a table of what EVERY state does with EVERY event. The screen: the page',
    '// shows the step of the state, the buttons follow the step, the sending and complete screens, a failed submit, the controller\'s first step,',
    ...(local
      ? ['// and the service saving into its local store with no network. A failure names the transition and the state, or the step that is wrong.']
      : ['// and the service POSTing the typed values (fetch is stubbed). A failure names the transition and the state, or the step that is wrong.']),
    '',
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createElement } from 'react';",
    "import { renderToString } from 'react-dom/server';",
    "import { getInitialSnapshot, getNextSnapshot } from 'xstate';",
    `import { ${names.controller} } from '../../controllers/${names.controller}.controller';`,
    ...(local ? [`import { ${ctx.store.op}, ${ctx.store.seed} } from '../../domain/${ctx.store.file}.domain';`] : []),
    `import { ${names.empty}, ${names.stepsOf}, ${names.toInput} } from '../../domain/${Name}.domain';`,
    `import { ${names.describe} } from '../../domain/${Name}Screen.domain';`,
    `import { ${names.fieldsOf}, ${names.validAll}, ${names.validStep} } from '../../domain/${Name}Validity.domain';`,
    `import { ${names.page} } from '../../pages/${names.page}.page';`,
    `import { ${names.submit} } from '../../services/${Name}.service';`,
    `import { ${names.machine} } from '../../workflows/${Name}.workflow';`,
    `import type { ${names.event}, ${names.input}, ${names.state}, ${names.step}, ${names.values} } from '../../types';`,
    '',
    `const STEPS: ${names.step}[] = [${stepNames.map((s) => lit(s)).join(', ')}];`,
    `const EMPTY: ${names.values} = ${objectOf((f) => (f.type === 'boolean' ? false : ''))};`,
    `const VALID: ${names.values} = ${objectOf((f) => sampleValue(f))};`,
    `const TYPED: ${names.input} = ${objectOf((f) => typedValue(f))};`,
    `const ENDPOINT = ${lit(ctx.endpoint)};`,
    `const ERROR_TEXT = ${lit(ctx.errorText)};`,
    '',
    ...kit.expectLines,
    '',
    '/** Like expectShown, for markup: the quotes of attributes are written as apostrophes in the message, so the runner can read its Expected and Received lines. */',
    'function expectMarkup(what: string, html: string, markup: string): void {',
    '  if (html.includes(markup)) return;',
    "  const shown = markup.replace(/\"/g, \"'\");",
    "  const message = what + ' does not show ' + shown + '.\\nExpected: \"' + shown + '\"\\nReceived: \"not shown\"';",
    "  throw new assert.AssertionError({ message, actual: 'not shown', expected: markup, operator: 'includes' });",
    '}',
    '',
    '/** Fails naming the transition and the state: the Expected and Received lines name states, the way the runner classifies them. */',
    'function expectTransition(event: string, from: string, want: string, got: string, note = \'\'): void {',
    '  if (got === want) return;',
    "  const message = 'The transition ' + event + ' from \"' + from + '\"' + note + ': the \"' + want + '\" state is wrong, the machine reaches \"' + got + '\".\\nExpected: \"' + want + '\"\\nReceived: \"' + got + '\"';",
    "  throw new assert.AssertionError({ message, actual: got, expected: want, operator: 'strictEqual' });",
    '}',
    '',
    'function expectNotShown(what: string, html: string, text: string): void {',
    '  if (!html.includes(text)) return;',
    "  const shown = text.replace(/\"/g, \"'\");",
    "  const message = what + ' shows ' + shown + ', which belongs to another step.\\nExpected: \"not shown\"\\nReceived: \"' + shown + '\"';",
    "  throw new assert.AssertionError({ message, actual: text, expected: 'not shown', operator: 'notIncludes' });",
    '}',
    '',
    '/** A snapshot of the machine resting in `state` with `values` typed. */',
    `const rest = (state: string, values: ${names.values}, error: string | null = null) => ${names.machine}.resolveState({ value: state, context: { values, error } });`,
    '/** What the machine does with one event. */',
    `const go = (snapshot: ReturnType<typeof rest>, event: ${names.event}) => getNextSnapshot(${names.machine}, snapshot, event);`,
    "const at = (snapshot: ReturnType<typeof rest>): string => String(snapshot.value);",
    `const eventOf = (type: string): ${names.event} => (type === 'FAILED' ? { type: 'FAILED', message: ERROR_TEXT } : { type }) as ${names.event};`,
    '',
    `test(${lit(`${Name} machine: it starts at the first step with nothing typed`)}, () => {`,
    `  const start = getInitialSnapshot(${names.machine});`,
    `  expectTransition('start', 'nowhere', ${lit(first)}, at(start), ' (the initial state)');`,
    '  assert.deepEqual(start.context.values, EMPTY);',
    '  assert.equal(start.context.error, null);',
    '});',
    '',
    `test(${lit(`${Name} machine: its states are the steps of the domain unit, then submitting and submitted`)}, () => {`,
    `  assert.deepEqual(${names.stepsOf}({}), STEPS);`,
    `  assert.deepEqual(Object.keys(${names.machine}.config.states ?? {}), [...STEPS, 'submitting', 'submitted']);`,
    '});',
    '',
    ...(blockAt >= 0 ? [
      `test(${lit(`${Name} machine: NEXT is blocked while the step is invalid, and goes on once it is valid`)}, () => {`,
      `  expectTransition('NEXT', ${lit(stepNames[blockAt])}, ${lit(stepNames[blockAt])}, at(go(rest(${lit(stepNames[blockAt])}, EMPTY), { type: 'NEXT' })), ' with nothing typed');`,
      `  expectTransition('NEXT', ${lit(stepNames[blockAt])}, ${lit(stepNames[blockAt + 1])}, at(go(rest(${lit(stepNames[blockAt])}, VALID), { type: 'NEXT' })), ' with its fields filled');`,
      `  const bad: [string, string, string][] = [${bads.map((b) => `[${b.map((x) => lit(x)).join(', ')}]`).join(', ')}];`,
      '  bad.forEach(([step, field, value]) => {',
      "    expectTransition('NEXT', step, step, at(go(rest(step, { ...VALID, [field]: value }), { type: 'NEXT' })), ' with a bad ' + field);",
      '  });',
      '});',
      '',
    ] : []),
    `test(${lit(`${Name} machine: the whole flow with everything typed reaches the last step, and BACK goes to the step before with what was typed kept`)}, () => {`,
    '  let snapshot = rest(STEPS[0], EMPTY);',
    ...inputs.map((f) => `  snapshot = go(snapshot, { type: 'CHANGE', field: ${lit(f.name)}, value: VALID.${f.name} });`),
    '  STEPS.slice(1).forEach((step, i) => {',
    "    snapshot = go(snapshot, { type: 'NEXT' });",
    "    expectTransition('NEXT', STEPS[i], step, at(snapshot), ' with everything typed');",
    '  });',
    '  assert.deepEqual(snapshot.context.values, VALID, \'what was typed is kept from step to step\');',
    '  [...STEPS].reverse().slice(0, -1).forEach((step, i) => {',
    "    snapshot = go(snapshot, { type: 'BACK' });",
    "    expectTransition('BACK', step, STEPS[STEPS.length - 2 - i], at(snapshot));",
    '  });',
    '  assert.deepEqual(snapshot.context.values, VALID, \'and BACK keeps it\');',
    '});',
    '',
    `test(${lit(`${Name} machine: SUBMIT is decided only by the last step, and only when every step is valid`)}, () => {`,
    '  STEPS.slice(0, -1).forEach((step) => expectTransition(\'SUBMIT\', step, step, at(go(rest(step, VALID), { type: \'SUBMIT\' })), \' (not the last step)\'));',
    `  expectTransition('SUBMIT', ${lit(last)}, 'submitting', at(go(rest(${lit(last)}, VALID), { type: 'SUBMIT' })), ' with everything typed');`,
    ...(anyChecked ? [`  expectTransition('SUBMIT', ${lit(last)}, ${lit(last)}, at(go(rest(${lit(last)}, EMPTY), { type: 'SUBMIT' })), ' with nothing typed');`] : []),
    '});',
    '',
    `test(${lit(`${Name} machine: a submit that succeeds is done, one that fails goes back to the last step with its message`)}, () => {`,
    `  expectTransition('SUCCEEDED', 'submitting', 'submitted', at(go(rest('submitting', VALID), { type: 'SUCCEEDED' })));`,
    `  const failed = go(rest('submitting', VALID), { type: 'FAILED', message: ERROR_TEXT });`,
    `  expectTransition('FAILED', 'submitting', ${lit(last)}, at(failed));`,
    "  assert.equal(failed.context.error, ERROR_TEXT, 'the message is kept');",
    '  assert.deepEqual(failed.context.values, VALID, \'and what was typed\');',
    '});',
    '',
    `test(${lit(`${Name} machine: RESET starts again from every state, with nothing typed`)}, () => {`,
    "  [...STEPS, 'submitted'].forEach((state) => {",
    "    const reset = go(rest(state, VALID, ERROR_TEXT), { type: 'RESET' });",
    `    expectTransition('RESET', state, ${lit(first)}, at(reset));`,
    "    assert.deepEqual(reset.context.values, EMPTY, 'nothing typed after RESET from ' + state);",
    "    assert.equal(reset.context.error, null);",
    '  });',
    `  expectTransition('RESET', 'submitting', 'submitting', at(go(rest('submitting', VALID), { type: 'RESET' })), ' (a submit in flight is not cut short)');`,
    '});',
    '',
    `test(${lit(`${Name} machine: CHANGE keeps what is typed and clears an old error`)}, () => {`,
    `  const field = ${lit(inputs[0].name)};`,
    `  const changed = go(rest(${lit(first)}, EMPTY, ERROR_TEXT), { type: 'CHANGE', field, value: VALID[field] });`,
    `  expectTransition('CHANGE', ${lit(first)}, ${lit(first)}, at(changed));`,
    "  assert.equal(changed.context.values[field], VALID[field]);",
    "  assert.equal(changed.context.error, null);",
    `  expectTransition('CHANGE', 'submitting', 'submitting', at(go(rest('submitting', EMPTY), { type: 'CHANGE', field, value: VALID[field] })), ' (typing is ignored while submitting)');`,
    '});',
    '',
    `test(${lit(`${Name} machine: every state decides every event (the transition table)`)}, () => {`,
    '  const table: [string, string, string, string][] = [',
    ...rows.map((r) => `    [${r.map((c) => lit(c)).join(', ')}],`),
    '  ];',
    '  table.forEach(([from, event, values, to]) => {',
    "    expectTransition(event, from, to, at(go(rest(from, values === 'valid' ? VALID : EMPTY), eventOf(event))), values === 'empty' ? ' with nothing typed' : '');",
    '  });',
    '});',
    '',
    `test(${lit(`${Name} domain: a step is valid when its own fields are filled, and the typed input is trimmed and numeric`)}, () => {`,
    `  STEPS.forEach((step) => assert.equal(${names.validStep}({ step, values: VALID }), true, 'a step with its fields filled: ' + step));`,
    ...(anyChecked ? [
      `  STEPS.forEach((step) => assert.equal(${names.validStep}({ step, values: EMPTY }), ${names.fieldsOf}({ step }).every((field) => typeof EMPTY[field] === 'boolean'), 'a step with nothing typed is valid only when it has nothing to fill: ' + step));`,
      `  assert.equal(${names.validAll}({ values: EMPTY }), false);`,
      `  const bad: [string, string, string][] = [${bads.map((b) => `[${b.map((x) => lit(x)).join(', ')}]`).join(', ')}];`,
      `  bad.forEach(([step, field, value]) => assert.equal(${names.validStep}({ step: step as ${names.step}, values: { ...VALID, [field]: value } }), false, 'a bad ' + field + ' (' + JSON.stringify(value) + ') blocks the step ' + step));`,
      `  bad.forEach(([, field, value]) => assert.equal(${names.validAll}({ values: { ...VALID, [field]: value } }), false, 'a bad ' + field + ' (' + JSON.stringify(value) + ') blocks the submit'));`,
    ] : []),
    `  assert.equal(${names.validAll}({ values: VALID }), true);`,
    `  assert.deepEqual(${names.fieldsOf}({ step: ${lit(last)} }), [], 'the last step holds no field: it shows them all');`,
    `  assert.deepEqual(STEPS.flatMap((step) => ${names.fieldsOf}({ step })), [${dealt.flatMap((d) => d.fields).map((f) => lit(f.name)).join(', ')}], 'every field is on some step, once');`,
    `  assert.deepEqual(${names.toInput}({ values: VALID }), TYPED, 'the typed values: numbers are numbers, text is trimmed');`,
    `  assert.deepEqual(${names.empty}({}), EMPTY);`,
    '});',
    '',
    `const noop = (): void => {};`,
    `const render = (state: ${names.state}): string => {`,
    '  try {',
    `    return renderToString(createElement(${names.page}, { state, onChange: noop, onBack: noop, onNext: noop, onSubmit: noop, onReset: noop }));`,
    '  } catch (error) {',
    "    return '<crashed: ' + (error instanceof Error ? error.message : String(error)) + '>';",
    '  }',
    '};',
    `/** The screen of a step: the state the domain unit makes of the machine resting there (whether it may go on is what the machine's own guards say). */`,
    `const show = (step: string, values: ${names.values} = VALID, error: string | null = null): string => {`,
    '  const snapshot = rest(step, values, error);',
    `  return render(${names.describe}({ value: step, context: { values, error }, steps: ${names.stepsOf}({}), canGoOn: snapshot.can({ type: 'NEXT' }) || snapshot.can({ type: 'SUBMIT' }) }));`,
    '};',
    '',
    `test(${lit(`${Name} screen: each step shows itself, its progress, its fields and nothing of the others`)}, () => {`,
    '  const checks: [string, string, string, [string, string, string][], string[]][] = [',
    ...stepChecks.map((c) => `    [${lit(c.name)}, ${lit(c.progress)}, ${lit(c.legend)}, [${c.fields.map((f) => `[${f.map((x) => lit(x)).join(', ')}]`).join(', ')}], [${c.review.map((r) => lit(r)).join(', ')}]],`),
    '  ];',
    '  checks.forEach(([step, progress, legend, fields, review]) => {',
    '    const html = show(step);',
    "    expectMarkup('The step \"' + step + '\"', html, progress);",
    "    expectMarkup('The step \"' + step + '\"', html, legend);",
    "    fields.forEach(([id, label, type]) => {",
    "      expectMarkup('The field ' + id + ' of the step \"' + step + '\"', html, '<label for=\"' + id + '\">' + label + '</label>');",
    "      const tag = new RegExp('<input[^>]*\\\\bid=\"' + id + '\"[^>]*>').exec(html)?.[0] ?? '';",
    "      expectMarkup('The input of ' + id, tag, 'type=\"' + type + '\"');",
    '    });',
    "    review.forEach((line) => expectMarkup('The review of the step \"' + step + '\"', html, line));",
    '    checks.filter(([other]) => other !== step).forEach(([other, otherProgress, otherLegend]) => {',
    "      expectNotShown('The step \"' + step + '\"', html, otherProgress);",
    "      expectNotShown('The step \"' + step + '\"', html, otherLegend);",
    '    });',
    '  });',
    '});',
    '',
    `test(${lit(`${Name} screen: Back, Next and Submit follow the step`)}, () => {`,
    '  const buttons: [string, string, string, string][] = [',
    ...stepChecks.map((c) => `    [${lit(c.name)}, ${lit(button('Back', c.isFirst, false))}, ${lit(button('Next', c.isLast, false))}, ${lit(button('Submit', !c.isLast, false))}],`),
    '  ];',
    '  buttons.forEach(([step, back, next, submit]) => {',
    '    const html = show(step);',
    "    expectMarkup('Back on the step \"' + step + '\"', html, back);",
    "    expectMarkup('Next on the step \"' + step + '\"', html, next);",
    "    expectMarkup('Submit on the step \"' + step + '\"', html, submit);",
    '  });',
    ...(anyChecked ? [
      `  const blocked = show(${lit(stepNames[blockAt])}, EMPTY);`,
      `  expectMarkup('Next on the step "${stepNames[blockAt]}" with nothing typed', blocked, ${lit(button('Next', stepChecks[blockAt].isLast, true))});`,
    ] : []),
    '});',
    '',
    `test(${lit(`${Name} screen: the sending screen, the complete screen and a failed submit`)}, () => {`,
    "  const sending = render({ status: 'submitting', values: VALID });",
    "  expectMarkup('The sending screen', sending, '<p role=\"status\">Sending...</p>');",
    "  expectNotShown('The sending screen', sending, '<form');",
    "  const done = render({ status: 'submitted' });",
    `  expectMarkup('The complete screen', done, ${lit(`<p role="status">${labelOf(Name)} complete.</p>`)});`,
    "  expectMarkup('The complete screen', done, 'Start again');",
    `  const failed = show(${lit(last)}, VALID, ERROR_TEXT);`,
    "  expectMarkup('The last step after a failed submit', failed, '<p role=\"alert\">' + ERROR_TEXT + '</p>');",
    `  expectMarkup('The last step after a failed submit', failed, ${lit(stepChecks.at(-1).progress)});`,
    '});',
    '',
    `test(${lit(`${Name} controller: renders the first step first`)}, () => {`,
    `  const html = renderToString(createElement(${names.controller}, {}));`,
    `  assert.equal(html, show(${lit(first)}, EMPTY), 'the controller hands the state of the machine to the page and adds nothing');`,
    `  expectMarkup('The controller on its first render', html, ${lit(stepChecks[0].progress)});`,
    '});',
    '',
    ...kit.fetchLines,
    `const send = (input: ${names.input}) => ${names.submit}({ input, signal: new AbortController().signal });`,
    '',
    ...(local ? localServiceTests : [
      ...kit.openapiServiceTests.map((l) => l.replace('ask()', "send(TYPED)")),
      `test(${lit(`${Name} service: the stubbed submit is called with the typed values`)}, async () => {`,
      '  let call: { url?: unknown; method?: unknown; type?: unknown; body?: unknown } = {};',
      '  const original = globalThis.fetch;',
      "  globalThis.fetch = (async (url: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => { call = { url, method: init?.method, type: init?.headers?.['Content-Type'], body: init?.body }; return respond(201, {})(); }) as unknown as typeof fetch;",
      '  try {',
      "    expectState('The service given the typed values', 'submitted', (await send(TYPED)).status);",
      '  } finally {',
      '    globalThis.fetch = original;',
      '  }',
      "  assert.equal(call.url, ENDPOINT, 'it posts to the endpoint');",
      "  assert.equal(call.method, 'POST');",
      "  assert.equal(call.type, 'application/json');",
      "  assert.deepEqual(JSON.parse(String(call.body)), TYPED, 'the body is the typed values (numbers are numbers)');",
      '});',
      '',
      `test(${lit(`${Name} service: a 500 is an error result`)}, async () => {`,
      '  await withFetch(respond(500, {}), async () => {',
      "    expectState('The service given a 500', 'error', (await send(TYPED)).status);",
      '  });',
      '});',
      '',
      `test(${lit(`${Name} service: a network failure is an error result`)}, async () => {`,
      "  await withFetch(async () => { throw new Error('offline'); }, async () => {",
      "    expectState('The service given a network failure', 'error', (await send(TYPED)).status);",
      '  });',
      '});',
      '',
      `test(${lit(`${Name} service: the caller's AbortSignal reaches fetch`)}, async () => {`,
      '  const controller = new AbortController();',
      '  let seen: unknown;',
      '  const original = globalThis.fetch;',
      '  globalThis.fetch = (async (_url: unknown, init?: { signal?: unknown }) => { seen = init?.signal; return respond(201, {})(); }) as unknown as typeof fetch;',
      '  try {',
      `    await ${names.submit}({ input: TYPED, signal: controller.signal });`,
      '  } finally {',
      '    globalThis.fetch = original;',
      '  }',
      "  assert.equal(seen, controller.signal, 'the service forwards the AbortSignal, so leaving the screen cancels the request');",
      '});',
    ]),
  ];
  return `${L.join('\n')}\n`;
}
