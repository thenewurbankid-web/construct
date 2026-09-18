// Epic #185 / #186 -- the workflow narrator: exact (golden) English for real fixtures.
// Regenerate goldens after an intentional wording change with UPDATE_GOLDEN=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractMachines } from '../src/engine/workflowExtractor.mjs';
import { compileWorkflow } from '../src/engine/workflowGenerator.mjs';
import { narrateMachine, humanize, guardText, delayText } from '../src/engine/workflowNarrator.mjs';

const fx = (name) => new URL(`../fixtures/workflow-graphs/${name}`, import.meta.url);
const checkoutJson = JSON.parse(fs.readFileSync(fx('checkout.json'), 'utf8'));

function golden(name, actual) {
  const file = fx(`golden/${name}`);
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(new URL('.', file), { recursive: true });
    fs.writeFileSync(file, actual);
  }
  assert.equal(actual, fs.readFileSync(file, 'utf8'), `golden mismatch: ${name} (UPDATE_GOLDEN=1 to regenerate after an intentional change)`);
}

const narrateAll = (src) => extractMachines(src).machines.map(narrateMachine);

test('humanize handles camel, Pascal, snake, kebab, UPPER_SNAKE and acronyms', () => {
  assert.equal(humanize('SUBMIT'), 'submit');
  assert.equal(humanize('paymentFailed'), 'payment failed');
  assert.equal(humanize('isLowValue'), 'is low value');
  assert.equal(humanize('REQUEST_REFUND'), 'request refund');
  assert.equal(humanize('AutoCheck'), 'auto check');
  assert.equal(humanize('user-signed-up'), 'user signed up');
  assert.equal(humanize('HTTPRequest'), 'http request');
});

test('guards and delays in words', () => {
  assert.equal(guardText('isLowValue'), 'it is low value');
  assert.equal(guardText('hasError'), 'it has error');
  assert.equal(guardText('amountUnder100'), 'the "amount under 100" condition holds');
  assert.equal(guardText('(inline guard)'), 'a custom condition holds');
  assert.equal(guardText('check(...)'), 'the "check" condition holds');
  assert.equal(delayText(1000), '1 second');
  assert.equal(delayText(5000), '5 seconds');
  assert.equal(delayText(1500), '1.5 seconds');
  assert.equal(delayText(120000), '2 minutes');
  assert.equal(delayText(3600000), '1 hour');
  assert.equal(delayText(250), '250 milliseconds');
});

test('golden: the generated checkout fixture', () => {
  const { source } = compileWorkflow(checkoutJson, { name: 'Checkout' });
  const [n] = narrateAll(source);
  assert.deepEqual(n.states.map((s) => [s.name, s.kind]), [['idle', 'initial'], ['submitting', 'normal'], ['done', 'final']]);
  golden('checkout.txt', n.text);
});

test('golden: refund request (guards, delay, loop, invoke, two end states)', () => {
  const [n] = narrateAll(fs.readFileSync(fx('refund-request.ts'), 'utf8'));
  golden('refund-request.txt', n.text);
  assert.match(n.summary, /can end in \*rejected\* or \*closed\*/);
});

test('golden: nested / mixed machine', () => {
  const [n] = narrateAll(fs.readFileSync(fx('mixed-nested.ts'), 'utf8'));
  golden('mixed-nested.txt', n.text);
  assert.equal(n.states.find((s) => s.path === 'a').kind, 'initial');
  assert.equal(n.states.find((s) => s.path === 'a.a2').kind, 'final');
});

test('an unsupported machine degrades to a graceful message and never throws', () => {
  const src = `const base = {}; export const m = createMachine({ ...base, initial: 'a', states: { a: {} } });`;
  const [n] = narrateAll(src);
  assert.deepEqual(n.states, []);
  assert.match(n.summary, /cannot be explained in plain English: object spread/);
  assert.doesNotThrow(() => narrateMachine({ error: 'boom', id: 'x', states: [], transitions: [] }));
});

test('deterministic: same input twice gives identical output', () => {
  const src = fs.readFileSync(fx('refund-request.ts'), 'utf8');
  assert.deepEqual(narrateAll(src), narrateAll(src));
});
