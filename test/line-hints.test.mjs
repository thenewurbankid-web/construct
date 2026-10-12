// #885: every refusal a builder can meet is said in the owner's one shape (hints.mjs): (1) what was wrong, quoting the
// bad value; (2) the rule in one clause; (3) numbered choices f1..fn with the exact step, recommended first, and (4) how
// to apply one; a code with no fix gives a concrete correct call instead. One table: every code, both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { REFUSAL_FIXES } from '../packages/engine/line/refusals.mjs';
import { PLAN_REFUSAL_CODES } from '../packages/engine/line/contract.mjs';
import { REFUSAL_HINTS, TOOL_EXAMPLES, hintOf, shapeRefusal, stepText } from '../packages/engine/line/hints.mjs';

/** Every code: the builder modules' (refusals.mjs), the plan protocol's, the plan service's and a plan store's. */
const CODES = [...new Set([...Object.keys(REFUSAL_FIXES), ...PLAN_REFUSAL_CODES, 'NEEDS_FIX', 'NO_QUESTION', 'BAD_OPTION', 'PLAN_CONFLICT'])].sort();
const BAD = 'zz-bad-value';
const STEPS = [{ tool: 'line.addRoute', args: { route: '/', page: 'features/home/pages/HomePage.tsx' } }, { tool: 'line.leaveAsIs', args: { stepId: 's1' } }];
/** A request that carries the bad value in every field the code's hint names. */
const reqFor = (code) => {
  const fields = hintOf(code)?.fields ?? ['file'];
  const args = Object.fromEntries(fields.map((f) => [f, BAD]));
  return code === 'UNKNOWN_TOOL' ? { tool: BAD, args: {} } : code === 'UNKNOWN_FIX' ? { fix: BAD } : code === 'NO_QUESTION' ? { answer: BAD } : code === 'BAD_OPTION' ? { answer: 'q1', option: BAD }
    : code === 'NOT_RETRYABLE' ? { tool: 'line.setCode', args: { retry: { of: BAD } } } : code === 'BAD_ARGS' ? { tool: 'line.createFeature', args: { points: BAD } } : { tool: 'line.setCode', args };
};
const sentenceFor = (code) => (code === 'BAD_ARGS' ? 'The arguments do not fit line.createFeature: points must be a JSON list.' : 'Line could not do this. The second sentence says more.');
const NO_PATHS = /fixes\[|options\[|\[\]\.step/;

test('every refusal code has a hint: its rule in one clause', () => {
  for (const code of CODES) {
    const h = hintOf(code);
    assert.ok(h, `${code} has a hint`);
    assert.match(h.rule, /^[a-z"A-Z].{8,}[^.]$/, `${code}: one clause, no full stop: ${h.rule}`);
  }
  for (const code of Object.keys(REFUSAL_HINTS)) assert.doesNotMatch(REFUSAL_HINTS[code].rule, NO_PATHS);
});

for (const code of CODES) {
  test(`${code}: wrong (quoting the bad value), rule, and a correct call when there is no fix`, () => {
    const req = reqFor(code);
    const s = shapeRefusal({ code, sentence: sentenceFor(code), ...req, tools: Object.keys(TOOL_EXAMPLES) });
    const lines = s.text.split('\n');
    assert.ok(lines[0].startsWith(`Refused (${code}): `), lines[0]);
    if (hintOf(code)?.fields || ['UNKNOWN_TOOL', 'UNKNOWN_FIX', 'NO_QUESTION', 'BAD_OPTION', 'NOT_RETRYABLE', 'BAD_ARGS'].includes(code)) assert.ok(lines[0].includes(BAD), `${code} quotes the bad value: ${lines[0]}`);
    assert.equal(lines[1], `Rule: ${hintOf(code).rule}.`);
    assert.deepEqual(s.choices, []);
    assert.equal(s.apply, null);
    const call = lines.at(-1);
    const m = /^A correct call: (?:([\w.]+) (\{.*\})|(\{.*\}))$/.exec(call);
    assert.ok(m, `${code} ends with a concrete correct call: ${call}`);
    assert.doesNotThrow(() => JSON.parse(m[2] ?? m[3]), call);
    assert.doesNotMatch(s.text, NO_PATHS);
  });

  test(`${code}: with typed fixes, numbered choices with their exact steps and how to apply one`, () => {
    const s = shapeRefusal({ code, sentence: `${sentenceFor(code)} Add fixes[0].step (or another of fixes[].step) instead.`, ...reqFor(code), fixes: STEPS.map((step, i) => ({ ref: `f${i + 1}`, id: `X/${i}`, step })) });
    const lines = s.text.split('\n');
    assert.ok(lines[0].startsWith(`Refused (${code}): `));
    assert.equal(lines[1], `Rule: ${hintOf(code).rule}.`);
    assert.equal(lines[2], 'Choices, recommended first:');
    assert.equal(lines[3], `  f1: ${stepText(STEPS[0])}`);
    assert.ok(lines.includes(`  f2: ${stepText(STEPS[1])}`));
    assert.equal(lines.at(-1), 'To apply one, send {"fix":"f1"}.');
    assert.deepEqual(s.choices.map((c) => [c.ref, c.recommended]), [['f1', true], ['f2', false]]);
    assert.doesNotMatch(s.text, NO_PATHS);
  });
}

const project = () => {
  const parent = fs.realpathSync(makeTempDir('line-hints-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'home' });
  assert.equal(r.ok, true, r.sentence);
  return { root: /** @type {string} */ (r.dir), done: () => fs.rmSync(parent, { recursive: true, force: true }) };
};
const svcOf = (root) => createLinePlanService({ root, commands: null, trace: null, records: null });

test('plan service: every refusal carries the shaped text; a fix ref sent as a tool name gets the offered fixes back (r2 R1)', async () => {
  const { root, done } = project();
  try {
    fs.writeFileSync(path.join(root, 'features/home/pages/HomePage.tsx'), 'export function HomePage() { return null; }\n');
    const svc = svcOf(root);
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/', page: 'home/HomePage' }, why: 'Serve home.' }, 'agent'));
    assert.equal(r.code, 'UNKNOWN_ITEM');
    assert.match(r.text, /^Refused \(UNKNOWN_ITEM\): "home\/HomePage" is not a feature page file\.\nRule: /);
    assert.match(r.text, /\n {2}f1: line\.addRoute \{"route":"\/","page":"features\/home\/pages\/HomePage\.tsx"\}/);
    const asTool = /** @type {any} */ (await svc.addStep({ tool: 'fixes[0].step', args: {} }, 'agent'));
    assert.equal(asTool.code, 'UNKNOWN_TOOL');
    assert.match(asTool.text, /\(you sent tool "fixes\[0\]\.step"\)/);
    assert.match(asTool.text, /f1: line\.addRoute/);
    assert.match(asTool.text, /To apply one, send \{"fix":"f1"\}\.$/);
    const picked = /** @type {any} */ (await svc.addStep({ fix: 'f1' }, 'agent'));
    assert.equal(picked.ok, true, picked.text);
    const unknown = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoutes', args: {} }, 'agent'));
    assert.match(unknown.text, /A correct call: line\.addRoute \{"route":"\/cart"/);
  } finally { done(); }
});
