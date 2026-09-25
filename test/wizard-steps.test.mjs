// #659 (part of epic #616) -- the wizard's step count as a closed question, `q-steps`: two | three | four steps, each a FIXED list of step names, default
// three (`details,review,done`), stable ids, offered only for the wizard shape, carried through planFromBlocks to `--steps` on every unit and on the proof,
// recorded as a decision trace like q-shape/q-source. The Requirement API, the MCP tool and the screen have their own tests; the chain with a real
// browser is test/proof-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFromBlocks } from '../packages/core/placement.mjs';
import { validatePlan } from '../packages/core/plan.mjs';
import { choicesFromWiring, wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { shapeContext } from '../packages/core/shapes.mjs';
import { DEFAULT_STEPS, STEPS_QUESTION_ID, STEP_TABLE, parseSteps, stepsOffer } from '../packages/core/shape-wizard.mjs';
import { placed, shapeProject, run } from '../test-utils/shapeChain.mjs';

const WIZARD = 'A user wants a step by step signup';
const LIST = 'A user wants to see a list of products';

const planOf = (dir, sentence, shape, answers = {}, options = {}) => {
  const blocks = placed(sentence, { answers: { 'q-shape': shape } }).blocks;
  return planFromBlocks(blocks, { feature: 'signup', root: dir, decisions: [], answers: { 'q-source': 'endpoint', ...answers }, ...options });
};
const unitSteps = (planned) => [...new Set(planned.plan.steps.filter((s) => s.flow === 'create.unit').map((s) => s.args.steps))];

test('the table is fixed: two, three and four steps, each a valid --steps value, three is the default and the old default', () => {
  assert.deepEqual(Object.entries(STEP_TABLE).map(([id, e]) => [id, e.count, e.steps]), [['two', 2, 'details,done'], ['three', 3, 'details,review,done'], ['four', 4, 'details,options,review,done']]);
  assert.equal(STEP_TABLE.three.steps, DEFAULT_STEPS, 'unanswered means what every wizard plan had before the question');
  for (const e of Object.values(STEP_TABLE)) assert.equal(parseSteps(e.steps).length, e.count, 'the names parse, and the count is the count');
  assert.equal(STEPS_QUESTION_ID, 'q-steps');
});

test('stepsOffer: three options with stable ids, default three (first), an answer chooses, a bad one is refused, custom steps are not asked', () => {
  const asked = stepsOffer({ unit: 'Signup' });
  assert.deepEqual([asked.question.id, asked.question.default, asked.question.chosen, asked.steps, asked.refused], ['q-steps', 'three', null, DEFAULT_STEPS, null]);
  assert.deepEqual(asked.question.options.map((o) => [o.id, o.enabled]), [['three', true], ['two', true], ['four', true]]);
  assert.deepEqual(asked.question.options.map((o) => o.label), ['3 steps: details, review, done', '2 steps: details, done', '4 steps: details, options, review, done']);
  assert.ok(asked.question.options.every((o) => o.why.length > 0 && o.why.length <= 120), 'a fixed size');
  assert.deepEqual([asked.question.unit, asked.question.shape, asked.question.suggestion.option, asked.question.suggestion.provider], ['Signup', 'wizard', 'three', 'rules']);
  assert.equal(asked.question.question, 'How many steps should the "Signup" wizard have?');
  const four = stepsOffer({ unit: 'Signup', answer: { option: 'four', by: 'person' } });
  assert.deepEqual([four.steps, four.question.chosen, four.refused], ['details,options,review,done', 'four', null]);
  assert.equal(stepsOffer({ unit: 'Signup', answer: 'two' }).steps, 'details,done', 'a plain option id is an answer too');
  const bad = stepsOffer({ unit: 'Signup', answer: 'seven' });
  assert.deepEqual([bad.steps, bad.question.chosen], [DEFAULT_STEPS, null], 'never silently replaced: the default stays and the answer is refused');
  assert.match(bad.refused, /"q-steps" has no option "seven" here\. Options: three, two, four\./);
  assert.equal(stepsOffer({ unit: 'Signup', answer: '__proto__' }).refused !== null, true, 'a name that is on every object is not an option');
  assert.equal(stepsOffer({ unit: 'Signup', current: 'address,payment' }), null, 'steps of a direct caller that are not in the table are kept, not asked');
  assert.equal(stepsOffer({ unit: 'Signup', current: STEP_TABLE.four.steps }).question.default, 'four', 'the blocks already ask for four: that is the default');
  assert.deepEqual(stepsOffer({ unit: 'Signup', current: '' }).question.default, 'three');
});

test('a wizard plan asks q-steps beside q-source; unanswered it is three steps and nobody chose; the other shapes are not asked', () => {
  const dir = shapeProject();
  const planned = planOf(dir, WIZARD, 'wizard');
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(planned.offers.map((o) => [o.id, o.chosen]), [['q-source', 'endpoint'], ['q-steps', null], ['q-dependency', null], ['q-verify', null]]);
  assert.equal(planned.offers.find((o) => o.id === 'q-steps').default, 'three');
  assert.deepEqual(unitSteps(planned), [DEFAULT_STEPS], 'every unit and the proof carry the same steps');
  assert.equal(planned.plan.steps.find((s) => s.flow === 'create.proof').args.steps, DEFAULT_STEPS);
  assert.equal(planned.decisions.some((d) => d.question === 'q-steps'), false, 'unanswered: nobody chose');
  assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
  const list = planOf(dir, LIST, 'list');
  assert.equal(list.offers.some((o) => o.id === 'q-steps'), false, 'only the wizard is asked how many steps it has');
  assert.equal(list.plan.steps.some((s) => s.args.steps !== undefined), false);
});

test('answering q-steps changes the steps of every unit and of the proof, deterministically, and the plan still validates', () => {
  const dir = shapeProject();
  for (const [option, steps] of [['two', 'details,done'], ['three', DEFAULT_STEPS], ['four', 'details,options,review,done']]) {
    const answer = { option, by: 'person' };
    const planned = planOf(dir, WIZARD, 'wizard', { 'q-steps': answer });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(unitSteps(planned), [steps], option);
    assert.deepEqual([...new Set(planned.plan.steps.filter((s) => s.flow === 'create.proof').map((s) => s.args.steps))], [steps], `${option}: the proof carries them`);
    assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-steps'), [{ question: 'q-steps', option, by: 'person' }]);
    assert.equal(planned.offers.find((o) => o.id === 'q-steps').chosen, option);
    assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
    assert.deepEqual(planOf(dir, WIZARD, 'wizard', { 'q-steps': answer }), planned, `${option}: the same answers make the same plan`);
  }
  const attributed = planOf(dir, WIZARD, 'wizard', { 'q-steps': { option: 'two', by: 'decision-model', provider: 'rules' } });
  assert.deepEqual(attributed.decisions.at(-1), { question: 'q-steps', option: 'two', by: 'decision-model', provider: 'rules' }, 'who decided is recorded');
});

test('a wrong option is a typed plan error naming the choices, not a silent default', () => {
  const planned = planOf(shapeProject(), WIZARD, 'wizard', { 'q-steps': 'seven' });
  assert.equal(planned.ok, false);
  assert.deepEqual(planned.errors.map((e) => [e.code, e.path]), [['PLAN_STEPS_UNAVAILABLE', 'answers.q-steps']]);
  assert.match(planned.errors[0].message, /Options: three, two, four/);
});

test('the answer is a decision trace of its own: requirement.plan.steps, the question as offered, the attribution', () => {
  assert.deepEqual(['q-steps', 'q-steps-signup', 'q-stepsx'].map(wiringChooserId), ['requirement.plan.steps', 'requirement.plan.steps', 'requirement.plan.other']);
  const planned = planOf(shapeProject(), WIZARD, 'wizard', { 'q-steps': { option: 'four', by: 'person' } });
  const [choice] = choicesFromWiring(planned).filter((c) => c.chooser.id === 'requirement.plan.steps');
  assert.deepEqual([choice.chosen, choice.by, choice.summary.id, choice.summary.options.map((o) => o.id), choice.summary.chosen], ['four', 'person', 'q-steps', ['three', 'two', 'four'], null], 'the question as it was offered: chosen is null');
  assert.equal(choicesFromWiring(planOf(shapeProject(), WIZARD, 'wizard')).some((c) => c.chooser.id === 'requirement.plan.steps'), false, 'an unanswered question records nothing');
});

test('every count writes a wizard that the shape accepts: --steps of the table, through the CLI, one component per step', () => {
  const dir = shapeProject();
  let n = 0;
  for (const { count, steps } of Object.values(STEP_TABLE)) {
    n += 1;
    const ctx = shapeContext(dir, { shape: 'wizard', name: `Signup${n}`, feature: 'shop', entity: `Signup${n}`, fields: 'id:string,name:string,age:number', steps });
    assert.equal(ctx.steps.length, count);
    const made = run(['create', 'layer', `Signup${n}`, '--feature', 'shop', '--layers', 'domain,service,workflow,hook,component,page,controller', '--shape', 'wizard', '--entity', `Signup${n}`, '--fields', 'id:string,name:string,age:number', '--steps', steps, '--source', 'endpoint'], dir);
    assert.equal(made.status, 0, made.stderr);
    assert.equal((made.stdout.match(/Step\.component\.tsx/g) ?? []).length >= count, true, `${count} steps: a step component for each`);
  }
});
