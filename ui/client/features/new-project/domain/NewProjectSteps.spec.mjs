import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_PROJECT_STEPS, nextStep, previousStep } from './NewProjectSteps.ts';
import { canLeaveStep, refusalStep, stepProblem } from './NewProjectStepRules.ts';
import { DEFAULT_FIRST_FEATURE, PROJECT_KINDS, kindLabel } from './ProjectKinds.ts';

const base = { name: 'acme-store', framework: 'line', firstFeature: DEFAULT_FIRST_FEATURE, parentDir: '', creating: false };

test('three questions in order: name, kind, create', () => {
  assert.deepEqual(NEW_PROJECT_STEPS.map((s) => s.id), ['name', 'kind', 'confirm']);
  assert.equal(nextStep('name'), 'kind');
  assert.equal(nextStep('confirm'), 'confirm');
  assert.equal(previousStep('kind'), 'name');
  assert.equal(previousStep('name'), 'name');
});

test('a Line project is the first, recommended kind; the words are plain', () => {
  assert.equal(PROJECT_KINDS[0].id, 'line');
  assert.equal(kindLabel('line'), 'Line project');
  for (const k of PROJECT_KINDS) assert.doesNotMatch(`${k.label} ${k.sentence}`, /single-page|repository|clone|token|Construct project/i);
});

test('Next needs a usable answer on each question', () => {
  assert.equal(canLeaveStep('name', { ...base, name: '' }), false);
  assert.equal(canLeaveStep('name', { ...base, name: 'my shop' }), false);
  assert.equal(canLeaveStep('name', base), true);
  assert.equal(canLeaveStep('kind', base), true);
  assert.equal(canLeaveStep('kind', { ...base, firstFeature: '' }), false);
  assert.equal(canLeaveStep('kind', { ...base, firstFeature: 'a/b' }), false);
  assert.equal(canLeaveStep('kind', { ...base, parentDir: '../x' }), false);
  assert.equal(canLeaveStep('kind', { ...base, framework: 'nextjs', firstFeature: '' }), true, 'the first feature is a Line question only');
  assert.equal(canLeaveStep('confirm', base), true);
  assert.equal(canLeaveStep('confirm', { ...base, creating: true }), false);
  assert.match(stepProblem('name', { ...base, name: 'a/b' }), /no slashes/);
  assert.equal(stepProblem('kind', { ...base, framework: 'react-spa', parentDir: '../x' }), null);
});

test('a refusal belongs to the question it is about', () => {
  assert.equal(refusalStep('There is already something called "shop" in your workspace. Choose another name.'), 'name');
  assert.equal(refusalStep('"a b" is not a project name; use letters, digits, "-" and "_", starting with a letter or digit.'), 'name');
  assert.equal(refusalStep('"a/b" is not a feature name; use letters, digits, "-" and "_", starting with a letter or digit.'), 'kind');
  assert.equal(refusalStep('That folder is outside your workspace; pick a folder inside it.'), 'kind');
  assert.equal(refusalStep('Could not reach the server.'), 'name');
});
