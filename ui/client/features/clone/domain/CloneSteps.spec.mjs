import test from 'node:test';
import assert from 'node:assert/strict';
import { CLONE_STEPS, nextCloneStep, previousCloneStep } from './CloneSteps.ts';
import { canLeaveCloneStep, cloneRefusalStep } from './CloneStepRules.ts';
import { cloneReducer, initialCloneState } from '../workflows/Clone.ts';

const answers = { input: 'octo/shop', name: '', branch: null, token: '', isPrivate: false };

test('three questions in order: link, private, bring it in', () => {
  assert.deepEqual(CLONE_STEPS.map((s) => s.id), ['link', 'private', 'confirm']);
  assert.equal(nextCloneStep('link'), 'private');
  assert.equal(nextCloneStep('confirm'), 'confirm');
  assert.equal(previousCloneStep('private'), 'link');
});

test('Next needs a usable answer: a link it understands, an answer to "Is it private?", no bad folder or branch', () => {
  assert.equal(canLeaveCloneStep('link', { ...answers, input: '' }, false), false);
  assert.equal(canLeaveCloneStep('link', { ...answers, input: 'not a link at all' }, false), false);
  assert.equal(canLeaveCloneStep('link', answers, false), true);
  assert.equal(canLeaveCloneStep('link', answers, true), false, 'nothing moves while a copy runs');
  assert.equal(canLeaveCloneStep('private', { ...answers, isPrivate: null }, false), false);
  assert.equal(canLeaveCloneStep('private', answers, false), true);
  assert.equal(canLeaveCloneStep('private', { ...answers, isPrivate: true, token: 'has space' }, false), false);
  assert.equal(canLeaveCloneStep('private', { ...answers, isPrivate: true, token: 'ghp_x' }, false), true);
  assert.equal(canLeaveCloneStep('confirm', answers, false), true);
  assert.equal(canLeaveCloneStep('confirm', { ...answers, name: '../x' }, false), false);
  assert.equal(canLeaveCloneStep('confirm', { ...answers, branch: 'bad..branch' }, false), false);
});

test('a refusal belongs to the question it is about', () => {
  assert.equal(cloneRefusalStep('GitHub is not connected (or the connection expired). Connect GitHub for private repositories, or paste an access token.'), 'private');
  assert.equal(cloneRefusalStep('A folder named "shop" already exists in the workspace. Choose another name or open the existing one.'), 'confirm');
  assert.equal(cloneRefusalStep('Could not look up example.invalid.'), 'link');
});

test('the reducer: steps, "not private" drops a typed token, a refusal moves to its question', () => {
  let s = cloneReducer(initialCloneState, { type: 'SET_INPUT', input: 'octo/shop' });
  s = cloneReducer(s, { type: 'NEXT' });
  assert.equal(s.step, 'private');
  s = cloneReducer(s, { type: 'SET_PRIVATE', isPrivate: true });
  s = cloneReducer(s, { type: 'SET_TOKEN', token: 'ghp_secret' });
  s = cloneReducer(s, { type: 'SET_PRIVATE', isPrivate: false });
  assert.equal(s.token, '', 'a token is never kept once it is not going to be used');
  s = cloneReducer(s, { type: 'NEXT' });
  assert.equal(s.step, 'confirm');
  s = cloneReducer(s, { type: 'START' });
  s = cloneReducer(s, { type: 'REFUSED', error: 'Use either your GitHub login or a pasted access token, not both.' });
  assert.equal(s.step, 'private');
  assert.equal(s.starting, false);
  s = cloneReducer(s, { type: 'BACK' });
  assert.equal(s.step, 'link');
  assert.equal(s.input, 'octo/shop', 'answers are kept');
});
