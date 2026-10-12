// The primitives' contract, survey and library agree with each other: contract ids come from the vocabulary, every
// covered cluster exists in the survey, every built component is a Line library item, and the survey holds
// descriptors only, from permissive sources.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRIMITIVES, PRIMITIVE_NAMES, contractProblems, primitive, primitiveForCluster } from '../contract.mjs';
import * as vocab from '../vocabulary.mjs';
import { CLUSTERS, clusterOf } from '../clusters.mjs';
import { loadSurvey } from '../coverage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.join(HERE, '..', 'library', 'components');
const survey = loadSurvey();

test('the contract is sound: vocabulary ids, a default state, every event wired to a prop', () => {
  assert.deepEqual(contractProblems(PRIMITIVES, vocab), []);
});

test('the contract holds a core set of 30 to 40 primitives, each with an ARIA story', () => {
  assert.ok(PRIMITIVES.length >= 30 && PRIMITIVES.length <= 40, `${PRIMITIVES.length} primitives`);
  for (const p of PRIMITIVES) {
    assert.ok(p.a11y.length > 0, `${p.name} lists its accessibility guarantees`);
    assert.ok(p.parts.length > 0, `${p.name} lists its parts`);
    for (const id of p.covers) assert.ok(CLUSTERS.some((c) => c.id === id), `${p.name} covers the unknown cluster ${id}`);
  }
  assert.equal(primitive('Button')?.role, 'button');
  assert.equal(primitive('Nope'), null);
  assert.equal(primitiveForCluster('toggle')?.name, 'Button');
});

test('a contract with a bad state, event or prop is reported in plain sentences', () => {
  const bad = [{ ...PRIMITIVES[0], name: 'X', states: [{ id: 'sparkly', means: '' }], events: [{ id: 'press', prop: 'onTap', payload: '', when: '' }] }];
  const problems = contractProblems(bad, vocab);
  assert.ok(problems.some((p) => p.includes('"sparkly"')));
  assert.ok(problems.some((p) => p.includes('onTap')));
  assert.ok(problems.some((p) => p.includes('no default state')));
});

test('the vocabulary maps library prop names onto canonical states and events', () => {
  assert.equal(vocab.stateOf('isDisabled'), 'disabled');
  assert.equal(vocab.stateOf('error'), 'invalid');
  assert.equal(vocab.stateOf('isSelected', 'switch'), 'checked');
  assert.equal(vocab.stateOf('isSelected', 'tabs'), 'selected');
  assert.equal(vocab.eventOf('onPress'), 'press');
  assert.equal(vocab.eventOf('onClose', 'tag'), 'remove');
  assert.equal(vocab.eventOf('onClose', 'dialog'), 'openChange');
  assert.equal(vocab.eventOf('onAnimationEnd'), 'lifecycle');
  assert.equal(vocab.eventOf('value'), null);
  assert.deepEqual(vocab.describeProps(['disabled', 'onCheckedChange', 'onPointerDown'], 'checkbox'), { states: ['default', 'disabled'], events: ['change'], ignored: ['onPointerDown'] });
  assert.equal(clusterOf('Modal')?.id, 'dialog');
  assert.equal(clusterOf('IconButton')?.id, 'iconButton');
});

test('every built primitive is a Line library item with its level, and nothing in the library is unknown', () => {
  const files = fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.tsx'));
  assert.ok(files.length >= 15, `${files.length} components built`);
  for (const f of files) {
    const name = f.replace(/\.tsx$/, '');
    assert.ok(PRIMITIVE_NAMES.includes(name), `${f} has a contract entry`);
    const src = fs.readFileSync(path.join(COMPONENTS, f), 'utf8');
    assert.match(src.split('\n')[0], new RegExp(`^// @line-level ${primitive(name).level}$`), `${f} starts with its @line-level`);
    assert.match(src, new RegExp(`export function ${name}\\(`), `${f} exports ${name}`);
  }
});

test('the survey holds descriptors from eight permissive sources, two of them held out', () => {
  assert.equal(survey.sources.length, 8);
  for (const s of survey.sources) {
    assert.ok(s.permissive, `${s.id} is permissive (${s.licence.spdx})`);
    assert.ok(s.components > 10, `${s.id} has components`);
  }
  assert.deepEqual(survey.sources.filter((s) => s.heldOut).map((s) => s.id), ['chakra', 'mantine']);
  const keys = new Set(survey.components.flatMap((c) => Object.keys(c)));
  for (const k of keys) assert.ok(['lib', 'name', 'cluster', 'role', 'parts', 'states', 'events', 'passThroughEvents', 'props', 'wraps'].includes(k), `descriptor key ${k}`);
  // Held-out sources never shape the clusters: every cluster's states come from training components only.
  const training = survey.components.filter((c) => !['chakra', 'mantine'].includes(c.lib));
  for (const cl of survey.clusters) {
    const fromTraining = new Set(training.filter((c) => c.cluster === cl.id).flatMap((c) => c.states));
    for (const s of cl.states) assert.ok(fromTraining.has(s), `${cl.id}.${s} comes from a training source`);
  }
});

test('the library and the kits type-check under strict TypeScript', () => {
  const tsc = path.join(HERE, '..', '..', '..', 'node_modules', '.bin', 'tsc');
  const r = spawnSync(tsc, ['-p', path.join(HERE, '..', 'tsconfig.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
