import test from 'node:test';
import assert from 'node:assert/strict';
import { createActor } from 'xstate';
import { formStateOf, initialNewProjectState, newProjectMachine } from './NewProject.ts';

test('#449: starts editing, empty, on nextjs, with no error', () => {
  const actor = createActor(newProjectMachine).start();
  assert.deepEqual(formStateOf(actor.getSnapshot()), initialNewProjectState);
});

test('#449: editing the name or framework clears a previous refusal', () => {
  const actor = createActor(newProjectMachine).start();
  actor.send({ type: 'START' });
  actor.send({ type: 'REFUSED', error: 'already exists' });
  assert.equal(formStateOf(actor.getSnapshot()).error, 'already exists');

  actor.send({ type: 'SET_NAME', name: 'demo' });
  assert.deepEqual(formStateOf(actor.getSnapshot()), { name: 'demo', framework: 'nextjs', creating: false, error: null });

  actor.send({ type: 'REFUSED', error: 'again' });
  actor.send({ type: 'SET_FRAMEWORK', framework: 'react-spa' });
  assert.deepEqual(formStateOf(actor.getSnapshot()), { name: 'demo', framework: 'react-spa', creating: false, error: null });
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
