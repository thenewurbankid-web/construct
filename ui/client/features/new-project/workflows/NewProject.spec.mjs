import test from 'node:test';
import assert from 'node:assert/strict';
import { createActor } from 'xstate';
import { formStateOf, initialNewProjectState, newProjectMachine } from './NewProject.ts';

test('#449: starts editing on the name question, empty, as a Line project (recommended) with first feature home, with no error', () => {
  const actor = createActor(newProjectMachine).start();
  assert.deepEqual(formStateOf(actor.getSnapshot()), initialNewProjectState);
});

test('#449: editing the name or framework clears a previous refusal', () => {
  const actor = createActor(newProjectMachine).start();
  actor.send({ type: 'START' });
  actor.send({ type: 'REFUSED', error: 'already exists' });
  assert.equal(formStateOf(actor.getSnapshot()).error, 'already exists');

  actor.send({ type: 'SET_NAME', name: 'demo' });
  assert.deepEqual(formStateOf(actor.getSnapshot()), { step: 'name', name: 'demo', framework: 'line', firstFeature: 'home', parentDir: '', creating: false, error: null });

  actor.send({ type: 'REFUSED', error: 'again' });
  actor.send({ type: 'SET_FRAMEWORK', framework: 'react-spa' });
  assert.deepEqual(formStateOf(actor.getSnapshot()), { step: 'name', name: 'demo', framework: 'react-spa', firstFeature: 'home', parentDir: '', creating: false, error: null });
});

test('#449: starting creation flips "creating" until a refusal sends it back to editing', () => {
  const actor = createActor(newProjectMachine).start();
  actor.send({ type: 'SET_NAME', name: 'demo' });
  actor.send({ type: 'START' });
  assert.equal(formStateOf(actor.getSnapshot()).creating, true);

  actor.send({ type: 'REFUSED', error: 'refused' });
  const state = formStateOf(actor.getSnapshot());
  assert.equal(state.creating, false);
  assert.equal(state.error, 'refused');
  assert.equal(state.name, 'demo', 'the name typed before creating started is not lost');
});

test('#449: the server accepting the request reaches the final "created" state', () => {
  const actor = createActor(newProjectMachine).start();
  actor.send({ type: 'SET_NAME', name: 'demo' });
  actor.send({ type: 'START' });
  actor.send({ type: 'CREATED' });
  assert.equal(actor.getSnapshot().status, 'done');
  assert.equal(formStateOf(actor.getSnapshot()).creating, false);
});

test('cu7: a Line project also takes a first feature and a folder; editing either clears a refusal', () => {
  const actor = createActor(newProjectMachine).start();
  actor.send({ type: 'SET_FRAMEWORK', framework: 'line' });
  actor.send({ type: 'START' });
  actor.send({ type: 'REFUSED', error: 'taken' });
  actor.send({ type: 'SET_FEATURE', firstFeature: 'catalog' });
  assert.equal(formStateOf(actor.getSnapshot()).error, null);
  actor.send({ type: 'SET_PARENT', parentDir: 'clients' });
  assert.deepEqual(formStateOf(actor.getSnapshot()), { step: 'name', name: '', framework: 'line', firstFeature: 'catalog', parentDir: 'clients', creating: false, error: null });
});

test('the questions: Next moves on only with a usable answer, Back goes back, answers are kept', () => {
  const actor = createActor(newProjectMachine).start();
  const state = () => formStateOf(actor.getSnapshot());
  actor.send({ type: 'NEXT' });
  assert.equal(state().step, 'name', 'no name yet: Next does nothing');
  actor.send({ type: 'SET_NAME', name: 'my shop' });
  actor.send({ type: 'NEXT' });
  assert.equal(state().step, 'name', 'a bad name: Next does nothing');
  actor.send({ type: 'SET_NAME', name: 'acme-store' });
  actor.send({ type: 'NEXT' });
  assert.equal(state().step, 'kind');
  actor.send({ type: 'NEXT' });
  assert.equal(state().step, 'confirm', 'Line project with first feature home is ready');
  actor.send({ type: 'NEXT' });
  assert.equal(state().step, 'confirm', 'the last question stays (Create starts it)');
  actor.send({ type: 'BACK' });
  actor.send({ type: 'BACK' });
  assert.equal(state().step, 'name');
  assert.equal(state().name, 'acme-store');
  actor.send({ type: 'GO', step: 'confirm' });
  assert.equal(state().step, 'confirm');
});

test('a refusal shows on the question it belongs to: a taken name on the name, a bad folder on the kind', () => {
  const actor = createActor(newProjectMachine).start();
  const state = () => formStateOf(actor.getSnapshot());
  actor.send({ type: 'SET_NAME', name: 'shop' });
  actor.send({ type: 'GO', step: 'confirm' });
  actor.send({ type: 'START' });
  actor.send({ type: 'REFUSED', error: 'There is already something called "shop" in that folder; choose another name.' });
  assert.equal(state().step, 'name');
  actor.send({ type: 'GO', step: 'confirm' });
  actor.send({ type: 'START' });
  actor.send({ type: 'REFUSED', error: 'That folder does not exist in your workspace; pick another folder.' });
  assert.equal(state().step, 'kind');
  assert.match(state().error, /does not exist/);
});
